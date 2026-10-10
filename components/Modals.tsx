'use client';
import { ROLES, can, roleError, roleLabel, type Role } from '@/lib/roles';
import { useCallback, useEffect, useState } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import { BLOCK_TYPES } from '@/lib/blockTypes';
import { Icon, Wire } from './icons';
import type { Asset, Ws } from './Library';

export function Modal({ children, onClose, wide, className }: { children: React.ReactNode; onClose: () => void; wide?: boolean; className?: string }) {
  return (
    <div className={'modal' + (wide ? ' wide' : '') + (className ? ' ' + className : '')} role="dialog" aria-modal="true">
      <button className="x" type="button" aria-label="Close" onClick={onClose}><Icon.Close /></button>
      {children}
    </div>
  );
}

export function BlockTypePicker({ from, count = 0, onPick }: { from?: Asset | null; count?: number; onPick: (t: string) => void }) {
  const types = Object.entries(BLOCK_TYPES).filter(([, t]) => !t.legacy && ((!from && !count) || t.fields.some((d) => d.type === 'image')));
  return (
    <>
      <h2>{count ? (count === 1 ? 'What kind of block?' : `Make ${count} blocks`) : from ? `Make “${from.name}” a block` : 'New block'}</h2>
      <p className="tip" style={{ marginBottom: 14 }}>
        {count
          ? `Each image is added to your assets and used as the main image of a new block. ${count === 1 ? '' : 'Add copy to each block afterwards.'}`
          : from
          ? from.kind === 'product' ? 'Pick the kind of block. The product’s image and copy go in; the product stays in Products.' : 'Pick the kind of block. The image goes in as its main image; add copy, then save. The image stays in your assets.'
          : 'Pick the shape of the content. You fill it with copy and images here; Claude turns it into a component in whichever Figma design system you choose.'}
      </p>
      <div className="types">
        {types.map(([k, t]) => (
          <button key={k} className="type" type="button" onClick={() => onPick(k)}>
            <Wire type={k} /><b>{t.name}</b><span>{t.note}</span>
          </button>
        ))}
      </div>
    </>
  );
}

export function HelpFigma() {
  return (
    <>
      <h2>Using assets in Figma</h2>
      <ol>
        <li><b>Drag any image</b> from the library straight onto your Figma canvas.</li>
        <li><b>Want it email-ready?</b> Open it, pick an email size or remove the background, then drag the preview into Figma.</li>
        <li><b>Replacing an image in a design?</b> Copy it, select the layer in Figma and press <kbd>⌘</kbd> <kbd>⇧</kbd> <kbd>R</kbd>.</li>
        <li><b>Need a component?</b> Open a block and copy the request for Claude. With the Mise and Figma connectors on, Claude builds it in the design system you choose.</li>
      </ol>
    </>
  );
}

export function HelpFeed() {
  return (
    <>
      <h2>Product feed format</h2>
      <p className="tip" style={{ marginBottom: 12 }}>Import a CSV with one product per row. Google Merchant Center exports work as they are. Recognised columns:</p>
      <ul>
        <li><b>id</b>, pid, sku or item_id (required)</li>
        <li><b>title</b> or name</li>
        <li><b>price</b> or sale_price</li>
        <li><b>link</b> or url</li>
      </ul>
      <p className="tip">Re-importing updates existing products by PID. Then drop product photos named by PID, like <code>10482.jpg</code>, and each one attaches to its product. Automatic feed sync is coming next.</p>
    </>
  );
}

export function Members({ supabase, ws, userId, toast, enterprise = false }: { supabase: SupabaseClient; ws: Ws; userId: string; toast: (m: string) => void; enterprise?: boolean }) {
  const [members, setMembers] = useState<{ user_id: string; role: string; email: string }[]>([]);
  const [invites, setInvites] = useState<{ id: string; email: string; role: string }[]>([]);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<Role>('editor');
  const [busy, setBusy] = useState(false);
  const admin = can.admin(ws.role);
  const owner = can.owner(ws.role);

  const load = useCallback(async () => {
    const { data: m } = await supabase.from('workspace_members').select('user_id, role').eq('workspace_id', ws.id);
    const ids = (m || []).map((r: any) => r.user_id);
    const { data: p } = ids.length ? await supabase.from('profiles').select('id, email').in('id', ids) : { data: [] as any[] };
    const emails = Object.fromEntries((p || []).map((r: any) => [r.id, r.email]));
    const order = ROLES.map((r) => r.id as string);
    setMembers((m || []).map((r: any) => ({ ...r, email: emails[r.user_id] || 'Unknown' })).sort((x, y) => order.indexOf(x.role) - order.indexOf(y.role) || x.email.localeCompare(y.email)));
    if (admin) {
      const { data: i } = await supabase.from('workspace_invites').select('id, email, role').eq('workspace_id', ws.id).is('accepted_at', null);
      setInvites(i || []);
    }
  }, [supabase, ws.id, admin]);
  useEffect(() => { load(); }, [load]);

  async function invite(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    const res = await fetch('/api/invites', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ workspaceId: ws.id, email, role: enterprise ? role : 'editor' }) });
    const json = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) { toast(json.error || 'Couldn’t send the invite.'); return; }
    toast(json.existing ? `${email} already has an account. They'll see ${ws.name} next time they open Mise.` : `Invite sent to ${email}`);
    setEmail('');
    load();
  }

  async function change(uid: string, to: string) {
    const { error } = await supabase.rpc('set_member_role', { p_ws: ws.id, p_user: uid, p_role: to });
    if (error) { toast(roleError(error.message) || error.message); return; }
    toast(`Now ${roleLabel(to).toLowerCase()}`);
    load();
  }

  async function remove(uid: string) {
    const { error } = await supabase.from('workspace_members').delete().eq('workspace_id', ws.id).eq('user_id', uid);
    if (error) toast('Couldn’t remove them.'); else load();
  }

  async function cancel(id: string) {
    await supabase.from('workspace_invites').delete().eq('id', id);
    load();
  }

  // Owners can set any role; admins any role below owner, and can't change an owner.
  // Without Enterprise, brands have owners and editors.
  const offered = enterprise ? ROLES : ROLES.filter((r) => r.id === 'owner' || r.id === 'editor');
  const choices = (current: string) => offered.filter((r) => owner || (r.id !== 'owner' && current !== 'owner'));
  const editable = (m: { user_id: string; role: string }) => admin && m.user_id !== userId && (owner || m.role !== 'owner');

  return (
    <>
      <h2>Team for {ws.name}</h2>
      <div className="rows">
        {members.map((m) => (
          <div className="row" key={m.user_id}>
            <span className="grow">{m.email}{m.user_id === userId ? ' (you)' : ''}</span>
            {editable(m) ? (
              <select className="in role-pick" value={m.role} onChange={(e) => change(m.user_id, e.target.value)} aria-label={`Role for ${m.email}`}>
                {choices(m.role).map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
              </select>
            ) : <span className="muted">{roleLabel(m.role)}</span>}
            {editable(m) && <button className="btn quiet" type="button" onClick={() => remove(m.user_id)}>Remove</button>}
          </div>
        ))}
        {invites.map((i) => (
          <div className="row" key={i.id}>
            <span className="grow">{i.email}</span><span className="muted">Invited · {roleLabel(i.role)}</span>
            <button className="btn quiet" type="button" onClick={() => cancel(i.id)}>Cancel</button>
          </div>
        ))}
      </div>
      {admin ? (
        <form className="inline" onSubmit={invite}>
          <input className="in" type="email" required placeholder="teammate@company.com" value={email} onChange={(e) => setEmail(e.target.value)} />
          {enterprise && <select className="in role-pick" value={role} onChange={(e) => setRole(e.target.value as Role)} aria-label="Role">
            {ROLES.filter((r) => r.id !== 'owner').map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
          </select>}
          <button className="primary" type="submit" disabled={busy}>{busy ? 'Sending…' : 'Invite'}</button>
        </form>
      ) : (
        <p className="tip">Only admins and owners can invite people to this brand.</p>
      )}
      {enterprise ? (
        <dl className="role-key">
          {ROLES.map((r) => <div key={r.id}><dt>{r.label}</dt><dd>{r.blurb}</dd></div>)}
        </dl>
      ) : (
        <p className="tip">Owners manage billing and the brand; editors do everything else. Admin, contributor and viewer roles, approvals by role and an activity log are on Enterprise. <a href="https://calendar.notion.so/meet/matthayes/3363f4yal" target="_blank" rel="noreferrer">Book a call</a></p>
      )}
      <p className="tip">Everyone is free: Mise is priced per brand, not per person.</p>
    </>
  );
}

export function Connector({ supabase, toast, full }: { supabase: SupabaseClient; toast: (m: string) => void; full?: boolean }) {
  const [keys, setKeys] = useState<any[]>([]);
  const [fresh, setFresh] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [app, setApp] = useState<'claude' | 'code'>('claude');

  const load = useCallback(async () => {
    const { data } = await supabase.from('api_keys').select('id, name, prefix, created_at, last_used_at').order('created_at', { ascending: false });
    setKeys(data || []);
  }, [supabase]);
  useEffect(() => { load(); }, [load]);

  async function create() {
    setBusy(true);
    const res = await fetch('/api/keys', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: app === 'code' ? 'Claude Code' : 'Claude' }) });
    const json = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) { toast(json.error || 'Couldn’t create a link.'); return; }
    setFresh(json.url);
    load();
  }

  async function revoke(id: string) {
    await supabase.from('api_keys').delete().eq('id', id);
    load();
    toast('Link turned off');
  }

  const copy = async (t: string) => { try { await navigator.clipboard.writeText(t); toast('Copied'); } catch { toast(t); } };
  const when = (d?: string) => (d ? new Date(d).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : 'Never');
  const link = fresh || '<your Mise link>';
  const cmdMise = `claude mcp add -s user --transport http mise "${link}"`;
  const cmdFigma = 'claude mcp add --transport http figma https://mcp.figma.com/mcp';
  // A brief for Claude Code with the link already in it, so the agent can do the whole setup itself.
  const brief = fresh ? [
    'Set up the Mise connector for me in Claude Code.',
    '',
    `1. Run: claude mcp add -s user --transport http mise "${fresh}"`,
    '   If "mise" already exists, run claude mcp remove -s user mise first, then add it again.',
    '2. Run claude mcp list and check that mise shows as Connected. If it shows failed or needs authentication, tell me to create a new link in Mise › Settings › Claude.',
    '3. Ask me whether I design in Figma. If yes, run: claude mcp add -s user --transport http figma https://mcp.figma.com/mcp and tell me to sign in to Figma through /mcp after restarting.',
    '4. Tell me to restart Claude Code (type /exit, then run claude again). To test, I can then say "show me my Mise brand kit".',
  ].join('\n') : '';
  const Cmd = ({ text }: { text: string }) => (
    <div className="cmd"><code>{text}</code><button className="btn quiet" type="button" onClick={() => copy(text)}>Copy</button></div>
  );

  return (
    <div className={full ? 'connect' : ''}>
      {full ? <div className="head"><h1>Connect Claude</h1></div> : <h2>Claude connector</h2>}
      <p className="tip cn-lede">Mise gives Claude your brand kit and assets, makes new images, video and designs on brand, and saves everything back to your library. Connect it once, then it all happens in a chat. Design in Figma? Connect that too and Claude can build there as well.</p>

      <div className="seg" role="group" aria-label="App">
        <button type="button" aria-pressed={app === 'claude'} onClick={() => setApp('claude')}>Claude (web and desktop)</button>
        <button type="button" aria-pressed={app === 'code'} onClick={() => setApp('code')}>Claude Code</button>
      </div>

      <ol className="cn-steps">
        <li>
          <b>Create your Mise link</b>
          {fresh ? (
            <>
              <div className="label">Your link (shown once, keep it private)</div>
              <div className="keybox">{fresh}</div>
              <div className="actions"><button className="primary" type="button" onClick={() => copy(fresh)}>Copy link</button><button className="btn quiet" type="button" onClick={() => setFresh(null)}>Hide</button></div>
            </>
          ) : (
            <div className="actions"><button className="primary" type="button" disabled={busy} onClick={create}>{busy ? 'Creating…' : keys.length ? 'Create a new link' : 'Create my link'}</button></div>
          )}
        </li>
        {app === 'claude' ? (
          <>
            <li><b>Add it to Claude</b><span>In Claude, open <a href="https://claude.ai/settings/connectors" target="_blank" rel="noreferrer">Settings → Connectors</a> → <em>Add custom connector</em>. Name it <em>Mise</em> and paste your link.</span></li>
            <li><b>Optional: add Figma</b><span>If you design in Figma, add the <em>Figma</em> connector from the directory in the same place and sign in, so Claude can build in your Figma files too. You don’t need it: Mise makes images, video and designs itself.</span></li>
            <li><b>Start a new chat</b><span>Connectors load when a chat starts. Then pick anything from the prompt library on the Create page.</span></li>
          </>
        ) : (
          <>
            <li>
              <b>Add Mise</b>
              {fresh ? (
                <>
                  <span>Easiest: copy this setup brief and paste it into Claude Code. Your link is already in it, so Claude adds Mise and checks it’s connected.</span>
                  <div className="actions"><button className="primary" type="button" onClick={() => copy(brief)}>Copy setup brief</button></div>
                  <span>Or run this in your terminal yourself:</span>
                </>
              ) : (
                <span>Create a link above and a setup brief for Claude Code appears here, with your link already in it. Or run this in your terminal (your link fills in once you create it):</span>
              )}
              <Cmd text={cmdMise} />
            </li>
            <li><b>Optional: add Figma</b><span>If you design in Figma, add it too, then sign in through <code>/mcp</code>:</span><Cmd text={cmdFigma} /></li>
            <li><b>Restart Claude Code</b><span>Type <code>/exit</code>, then run <code>claude</code> again: connectors load when a session starts.</span></li>
            <li><b>Ask for something</b><span>Start <code>claude</code> and paste a prompt from the Create page. The prompts also show up in Claude Code’s <code>/</code> menu under Mise.</span></li>
          </>
        )}
      </ol>

      {keys.length > 0 && (
        <>
          <div className="label">Your links</div>
          <div className="rows">
            {keys.map((k) => (
              <div className="row" key={k.id}>
                <span className="grow"><code>{k.prefix}…</code> {k.name}</span>
                <span className="muted">Last used {when(k.last_used_at)}</span>
                <button className="btn quiet" type="button" onClick={() => revoke(k.id)}>Turn off</button>
              </div>
            ))}
          </div>
          <p className="tip">A link lets whoever has it read your workspaces and save into them, so treat it like a password.</p>
        </>
      )}
    </div>
  );
}

// Parse a Figma link into its file key and a readable name.
export function parseFigmaUrl(raw: string) {
  try {
    const u = new URL(raw.trim());
    if (!/(^|\.)figma\.com$/.test(u.hostname)) return null;
    const m = u.pathname.match(/^\/(design|file|board|slides|proto)\/([A-Za-z0-9]{10,})(?:\/branch\/([A-Za-z0-9]{10,}))?(?:\/([^/?#]+))?/);
    if (!m) return null;
    const key = m[3] || m[2];
    const name = m[4] ? decodeURIComponent(m[4]).replace(/-/g, ' ') : 'Figma file';
    return { key, name, url: `https://www.figma.com/${m[1] === 'file' ? 'design' : m[1]}/${m[2]}${m[3] ? `/branch/${m[3]}` : ''}${m[4] ? `/${m[4]}` : ''}` };
  } catch {
    return null;
  }
}

export function WorkspaceSettings({ supabase, ws, toast, onSaved, onDeleted }: { supabase: SupabaseClient; ws: Ws; toast: (m: string) => void; onSaved: () => void; onDeleted?: () => void }) {
  const owner = can.admin(ws.role); // admins and owners change brand settings
  const [name, setName] = useState(ws.name);
  const [link, setLink] = useState(ws.figma_file_url || '');
  const [busy, setBusy] = useState(false);
  const parsed = link.trim() ? parseFigmaUrl(link) : null;
  const invalid = !!link.trim() && !parsed;

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (invalid) return;
    setBusy(true);
    const { error } = await supabase.from('workspaces').update({
      name: name.trim() || ws.name,
      figma_file_url: parsed?.url || null,
      figma_file_key: parsed?.key || null,
      figma_file_name: parsed?.name || null,
    }).eq('id', ws.id);
    setBusy(false);
    if (error) { toast('Couldn’t save. Only admins and owners can change brand settings.'); return; }
    toast(parsed ? `Connected ${parsed.name}` : 'Saved');
    onSaved();
  }

  return (
    <form onSubmit={save} className="settings">
      <h2>Workspace settings</h2>
      <div className="bf">
        <div className="bl"><label htmlFor="wsname">Workspace name</label></div>
        <input id="wsname" className="in" value={name} maxLength={60} disabled={!owner} onChange={(e) => setName(e.target.value)} />
      </div>
      <div className="bf">
        <div className="bl"><label htmlFor="figma">Connected Figma file</label></div>
        <input id="figma" className="in mono" type="url" disabled={!owner} placeholder="https://www.figma.com/design/…" value={link} onChange={(e) => setLink(e.target.value)} />
        {invalid ? <p className="err">That doesn’t look like a Figma file link. Copy it from Figma with Share → Copy link.</p>
          : parsed ? <p className="tip">Claude will use <b>{parsed.name}</b> whenever you don’t give it a link. It’s where images, blocks and components from {ws.name} go.</p>
          : <p className="tip">Paste the link to this brand’s Figma design-system or email file. Claude uses it by default, so you don’t have to paste it into every request.</p>}
      </div>
      {owner ? (
        <div className="actions"><button className="primary" type="submit" disabled={busy || invalid}>{busy ? 'Saving…' : 'Save'}</button></div>
      ) : (
        <p className="tip">Only admins and owners can change brand settings.</p>
      )}
      {can.owner(ws.role) && onDeleted && <DeleteBrand supabase={supabase} ws={ws} toast={toast} onDeleted={onDeleted} />}
    </form>
  );
}

// Delete a brand: everything in it (assets and their versions, files, folders, collections,
// brand kit, portals and share links, team access) goes. Owners only; type the name to confirm.
function DeleteBrand({ supabase, ws, toast, onDeleted }: { supabase: SupabaseClient; ws: Ws; toast: (m: string) => void; onDeleted: () => void }) {
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [count, setCount] = useState<number | null>(null);
  useEffect(() => {
    if (!open) return;
    supabase.from('assets').select('id', { count: 'exact', head: true }).eq('workspace_id', ws.id).eq('on_board', false).then(({ count: n }) => setCount(n ?? 0));
  }, [open, supabase, ws.id]);

  async function remove() {
    // On Pro: stop the subscription first, so a deleted brand is never billed again.
    const stop = await fetch(`/api/billing?workspace_id=${ws.id}`, { method: 'DELETE' }).catch(() => null);
    if (stop && !stop.ok && stop.status !== 401) { toast((await stop.json().catch(() => null))?.error || 'Couldn’t stop this brand’s subscription, so it wasn’t deleted. Try again.'); return; }
    setBusy(true);
    // Files first (the database rows go with the brand): every file of every asset and version.
    const paths = new Set<string>();
    for (let from = 0; ; from += 1000) {
      const { data } = await supabase.from('assets').select('storage_path, images').eq('workspace_id', ws.id).range(from, from + 999);
      for (const a of (data || []) as any[]) { if (a.storage_path) paths.add(a.storage_path); for (const s of Object.values(a.images || {}) as any[]) { if (s?.path) paths.add(s.path); if (s?.original_path) paths.add(s.original_path); } }
      if (!data || data.length < 1000) break;
    }
    const { data: vers } = await supabase.from('asset_versions').select('storage_path, images').eq('workspace_id', ws.id).limit(10000);
    for (const v of (vers || []) as any[]) { if (v.storage_path) paths.add(v.storage_path); if (v.images?.email?.path) paths.add(v.images.email.path); }
    const list = [...paths].filter((p) => p.startsWith(ws.id + '/'));
    for (let i = 0; i < list.length; i += 500) await supabase.storage.from('assets').remove(list.slice(i, i + 500));
    const { error } = await supabase.from('workspaces').delete().eq('id', ws.id);
    setBusy(false);
    if (error) { toast('Couldn’t delete the brand. Only owners can.'); return; }
    toast(`${ws.name} deleted`);
    onDeleted();
  }

  return (
    <div className="danger">
      <h3>Delete this brand</h3>
      {!open ? (
        <>
          <p className="tip">Removes {ws.name} for everyone: its assets and their versions, files, folders, collections, brand kit, portals, share links and team access. If it’s on Pro, its subscription stops today. This can’t be undone.</p>
          <button className="btn danger-btn" type="button" onClick={() => setOpen(true)}>Delete {ws.name}…</button>
        </>
      ) : (
        <>
          <p className="tip">{count === null ? 'Counting…' : `${count.toLocaleString()} asset${count === 1 ? '' : 's'} will be deleted, with every version.`} Portals and share links stop working straight away. Type <b>{ws.name}</b> to confirm.</p>
          <input className="in" value={typed} autoFocus onChange={(e) => setTyped(e.target.value)} placeholder={ws.name} aria-label="Type the brand name to confirm" />
          <div className="actions">
            <button className="btn quiet" type="button" onClick={() => { setOpen(false); setTyped(''); }} disabled={busy}>Keep it</button>
            <button className="btn danger-btn solid" type="button" disabled={busy || typed.trim() !== ws.name.trim()} onClick={remove}>{busy ? 'Deleting…' : 'Delete forever'}</button>
          </div>
        </>
      )}
    </div>
  );
}
