'use client';
import { useCallback, useEffect, useState } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import { BLOCK_TYPES } from '@/lib/blockTypes';
import { Icon, Wire } from './icons';
import type { Asset, Ws } from './Library';

export function Modal({ children, onClose, wide }: { children: React.ReactNode; onClose: () => void; wide?: boolean }) {
  return (
    <div className={'modal' + (wide ? ' wide' : '')} role="dialog" aria-modal="true">
      <button className="x" type="button" aria-label="Close" onClick={onClose}><Icon.Close /></button>
      {children}
    </div>
  );
}

export function BlockTypePicker({ from, count = 0, onPick }: { from?: Asset | null; count?: number; onPick: (t: string) => void }) {
  const types = Object.entries(BLOCK_TYPES).filter(([, t]) => (!from && !count) || t.fields.some((d) => d.type === 'image'));
  return (
    <>
      <h2>{count ? (count === 1 ? 'What kind of block?' : `Make ${count} blocks`) : from ? `Make “${from.name}” a block` : 'New block'}</h2>
      <p className="tip" style={{ marginBottom: 14 }}>
        {count
          ? `Each image is added to your assets and used as the main image of a new block. Pick Design for a finished design with copy in it: Emailsy reads it into an editable Card. ${count === 1 ? '' : 'Add copy to each block afterwards.'}`
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
        <li><b>Need a component?</b> Open a block and copy the request for Claude. With the Emailsy CMS and Figma connectors on, Claude builds it in the design system you choose.</li>
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

export function Members({ supabase, ws, userId, toast }: { supabase: SupabaseClient; ws: Ws; userId: string; toast: (m: string) => void }) {
  const [members, setMembers] = useState<{ user_id: string; role: string; email: string }[]>([]);
  const [invites, setInvites] = useState<{ id: string; email: string }[]>([]);
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const owner = ws.role === 'owner';

  const load = useCallback(async () => {
    const { data: m } = await supabase.from('workspace_members').select('user_id, role').eq('workspace_id', ws.id);
    const ids = (m || []).map((r: any) => r.user_id);
    const { data: p } = ids.length ? await supabase.from('profiles').select('id, email').in('id', ids) : { data: [] as any[] };
    const emails = Object.fromEntries((p || []).map((r: any) => [r.id, r.email]));
    setMembers((m || []).map((r: any) => ({ ...r, email: emails[r.user_id] || 'Unknown' })));
    if (owner) {
      const { data: i } = await supabase.from('workspace_invites').select('id, email').eq('workspace_id', ws.id).is('accepted_at', null);
      setInvites(i || []);
    }
  }, [supabase, ws.id, owner]);
  useEffect(() => { load(); }, [load]);

  async function invite(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    const res = await fetch('/api/invites', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ workspaceId: ws.id, email }) });
    const json = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) { toast(json.error || 'Couldn’t send the invite.'); return; }
    toast(json.existing ? `${email} already has an account. They'll see ${ws.name} next time they open Emailsy.` : `Invite sent to ${email}`);
    setEmail('');
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

  return (
    <>
      <h2>Members of {ws.name}</h2>
      <div className="rows">
        {members.map((m) => (
          <div className="row" key={m.user_id}>
            <span className="grow">{m.email}{m.user_id === userId ? ' (you)' : ''}</span>
            <span className="muted">{m.role === 'owner' ? 'Owner' : 'Editor'}</span>
            {owner && m.user_id !== userId && <button className="btn quiet" type="button" onClick={() => remove(m.user_id)}>Remove</button>}
          </div>
        ))}
        {invites.map((i) => (
          <div className="row" key={i.id}>
            <span className="grow">{i.email}</span><span className="muted">Invited</span>
            <button className="btn quiet" type="button" onClick={() => cancel(i.id)}>Cancel</button>
          </div>
        ))}
      </div>
      {owner ? (
        <form className="inline" onSubmit={invite}>
          <input className="in" type="email" required placeholder="teammate@company.com" value={email} onChange={(e) => setEmail(e.target.value)} />
          <button className="primary" type="submit" disabled={busy}>{busy ? 'Sending…' : 'Invite'}</button>
        </form>
      ) : (
        <p className="tip">Only owners can invite people to this workspace.</p>
      )}
    </>
  );
}

export function Connector({ supabase, toast }: { supabase: SupabaseClient; toast: (m: string) => void }) {
  const [keys, setKeys] = useState<any[]>([]);
  const [fresh, setFresh] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const { data } = await supabase.from('api_keys').select('id, name, prefix, created_at, last_used_at').order('created_at', { ascending: false });
    setKeys(data || []);
  }, [supabase]);
  useEffect(() => { load(); }, [load]);

  async function create() {
    setBusy(true);
    const res = await fetch('/api/keys', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Claude' }) });
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

  const when = (d?: string) => (d ? new Date(d).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : 'Never');

  return (
    <>
      <h2>Claude connector</h2>
      <p className="tip" style={{ marginBottom: 12 }}>
        Connect Claude to your library so it can find assets, push images into Figma and turn blocks into components. In Claude, open
        Settings → Connectors → Add custom connector, name it Emailsy CMS and paste your link.
      </p>
      {fresh && (
        <>
          <div className="label">Your new link (shown once, keep it private)</div>
          <div className="keybox">{fresh}</div>
          <div className="actions" style={{ marginBottom: 12 }}>
            <button className="primary" type="button" onClick={async () => { try { await navigator.clipboard.writeText(fresh); toast('Copied'); } catch { toast(fresh); } }}>Copy link</button>
            <button className="btn quiet" type="button" onClick={() => setFresh(null)}>Done</button>
          </div>
        </>
      )}
      {keys.length > 0 && (
        <div className="rows">
          {keys.map((k) => (
            <div className="row" key={k.id}>
              <span className="grow"><code>{k.prefix}…</code></span>
              <span className="muted">Last used {when(k.last_used_at)}</span>
              <button className="btn quiet" type="button" onClick={() => revoke(k.id)}>Turn off</button>
            </div>
          ))}
        </div>
      )}
      {!fresh && <button className="primary" type="button" disabled={busy} onClick={create}>{busy ? 'Creating…' : keys.length ? 'Create another link' : 'Create my connector link'}</button>}
    </>
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

export function WorkspaceSettings({ supabase, ws, toast, onSaved }: { supabase: SupabaseClient; ws: Ws; toast: (m: string) => void; onSaved: () => void }) {
  const owner = ws.role === 'owner';
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
    if (error) { toast('Couldn’t save. Only owners can change workspace settings.'); return; }
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
        <p className="tip">Only owners can change workspace settings.</p>
      )}
    </form>
  );
}
