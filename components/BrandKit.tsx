'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import { COLOR_LABEL, COLOR_ROLES, emptyKit, missing, normaliseKit, warnings, type BrandKit, type BrandKitRow } from '@/lib/brandKit';
import { Icon } from './icons';
import type { Asset, Ws } from './Library';

// The workspace's brand kit: build it from the website or from Figma (through Claude),
// review it against a live email preview, then approve it.
export default function BrandKitView({ supabase, ws, userId, row, items, urls, toast, onChanged, autoSite, onBuilt }: {
  supabase: SupabaseClient;
  ws: Ws;
  userId: string;
  row: BrandKitRow | null;
  items: Asset[];
  urls: Record<string, string>;
  toast: (m: string) => void;
  onChanged: () => void;
  autoSite?: string | null; // from the landing page: build the kit from this website now
  onBuilt?: (name: string) => void;
}) {
  const [kit, setKit] = useState<BrandKit>(() => normaliseKit(row?.kit || { name: ws.name }, ws.name));
  const [dirty, setDirty] = useState(false);
  const [site, setSite] = useState(row?.source?.type === 'website' ? row.source.url || '' : '');
  const [building, setBuilding] = useState(false);
  const [busy, setBusy] = useState(false);
  const owner = ['owner', 'admin'].includes(ws.role || ''); // admins and owners approve the kit

  // Someone else (or Claude) saved a new version: show it unless we have unsaved edits.
  useEffect(() => { if (!dirty) setKit(normaliseKit(row?.kit || { name: ws.name }, ws.name)); }, [row, ws.name]); // eslint-disable-line react-hooks/exhaustive-deps

  const logos = useMemo(() => items.filter((i) => i.kind === 'logo'), [items]);
  const images = useMemo(() => items.filter((i) => i.kind === 'image' && i.storage_path), [items]);
  const src = (id?: string | null) => { const a = id ? items.find((i) => i.id === id) : null; return a?.storage_path ? urls[a.storage_path] : undefined; };
  const set = (fn: (k: BrandKit) => void) => { setKit((k) => { const n = structuredClone(k); fn(n); return n; }); setDirty(true); };
  const gaps = missing(kit), warns = warnings(kit);
  const figmaPrompt = `Build the Mise brand kit for the "${ws.name}" workspace from our Figma email design system${ws.figma_file_url ? `: ${ws.figma_file_url}` : ' (paste the Figma link here)'}.`;

  const autoRan = useRef(false);
  useEffect(() => {
    if (!autoSite || row || autoRan.current) return;
    autoRan.current = true;
    setSite(autoSite);
    buildFromSite(undefined, autoSite);
  }, [autoSite, row]); // eslint-disable-line react-hooks/exhaustive-deps

  async function buildFromSite(e?: React.FormEvent, url = site) {
    e?.preventDefault();
    if (!url.trim()) return;
    setBuilding(true);
    const res = await fetch('/api/brand-kit/extract', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ workspace_id: ws.id, url }) }).catch(() => null);
    const json = res ? await res.json().catch(() => null) : null;
    setBuilding(false);
    if (!res?.ok || !json?.kit) { toast(json?.error || 'Couldn’t read that website. Try again.'); return; }
    setDirty(false);
    setKit(normaliseKit(json.kit.kit, ws.name));
    onChanged();
    const f = json.found || {};
    toast(`Brand kit drafted from ${new URL(json.kit.source.url).hostname}${f.logo ? ' with its logo' : ''}${json.renamed ? `, and your brand is now called ${json.renamed}` : ''}. Check it, then approve.`);
    if (autoSite && onBuilt) onBuilt(json.renamed || json.kit?.kit?.name || ws.name);
  }

  async function save(status?: 'approved') {
    setBusy(true);
    const clean = normaliseKit(kit, ws.name);
    const patch: Record<string, any> = { workspace_id: ws.id, kit: clean, updated_by: userId };
    if (dirty || !row) { patch.version = (row?.version || 0) + 1; patch.status = 'draft'; patch.source = row?.source || { type: 'manual', at: new Date().toISOString() }; }
    if (status === 'approved') Object.assign(patch, { status: 'approved', approved_by: userId, approved_at: new Date().toISOString() });
    const { error } = await supabase.from('brand_kits').upsert(patch, { onConflict: 'workspace_id' });
    setBusy(false);
    if (error) { toast('Couldn’t save the brand kit. Try again.'); return; }
    setDirty(false);
    setKit(clean);
    onChanged();
    toast(status === 'approved' ? 'Brand kit approved. Claude uses it from now on.' : row?.status === 'approved' ? 'Saved. Changes go back to draft until approved.' : 'Saved');
  }

  const copy = async (t: string) => { try { await navigator.clipboard.writeText(t); toast('Copied. Paste it into Claude.'); } catch { toast(t); } };

  // ---------- no kit yet ----------
  if (!row) {
    return (
      <div className="bk">
        <div className="head"><h1>Brand kit</h1></div>
        <p className="tip bk-lede">One brand kit per workspace: colours, fonts, buttons, logos and imagery style. Claude uses it whenever it builds or generates anything for {ws.name}. Start from what you already have.</p>
        <div className="bk-starts">
          <form className="bk-start" onSubmit={buildFromSite}>
            <b>From your website</b>
            <span>We read your site’s colours, fonts, buttons and logo, and draft the kit for you to check.</span>
            <input className="in" placeholder="yourbrand.com" value={site} onChange={(e) => setSite(e.target.value)} disabled={building} />
            <button className="primary" type="submit" disabled={building || !site.trim()}>{building ? 'Reading your site…' : 'Build my brand kit'}</button>
            {building && autoSite && <span className="tip">Reading {site}: colours, fonts, buttons and logo. About 20 seconds, then your first designs.</span>}
          </form>
          <div className="bk-start">
            <b>From your Figma design system</b>
            <span>With the Mise and Figma connectors on, ask Claude. It reads your foundations and saves the kit here as a draft.</span>
            <div className="promptbox">{figmaPrompt}</div>
            <button className="btn" type="button" onClick={() => copy(figmaPrompt)}>Copy request for Claude</button>
          </div>
        </div>
        <button className="btn quiet" type="button" onClick={() => { setKit(emptyKit(ws.name)); save(); }} disabled={busy}>Or start with a blank kit</button>
      </div>
    );
  }

  // ---------- the kit ----------
  const srcLabel = row.source?.type === 'website' ? `From ${hostOf(row.source.url)}` : row.source?.type === 'figma' ? 'From Figma' : 'Set up by hand';
  const lines = (v: string) => v.split('\n').map((x) => x.trim()).filter(Boolean);

  return (
    <div className="bk">
      <div className="head">
        <h1>Brand kit</h1>
        <span className={'pill ' + (row.status === 'approved' && !dirty ? 'ok' : 'draft')}>{dirty ? 'Unsaved changes' : row.status === 'approved' ? 'Approved' : 'Draft'}</span>
        <span className="n">v{row.version} · {srcLabel}</span>
        <span className="spacer" />
        {dirty && <button className="btn" type="button" disabled={busy} onClick={() => save()}>Save</button>}
        {(row.status !== 'approved' || dirty) && (owner
          ? <button className="primary" type="button" disabled={busy} onClick={() => save('approved')}>{dirty ? 'Save and approve' : 'Approve'}</button>
          : <span className="tip">An admin or owner approves the kit.</span>)}
      </div>

      {(gaps.length > 0 || warns.length > 0) && (
        <div className="bk-note">
          {gaps.length > 0 && <p><b>Still missing:</b> {gaps.join(', ')}.</p>}
          {warns.map((w) => <p key={w}>{w}</p>)}
        </div>
      )}

      <div className="bk-cols">
        <div className="bk-form" key={row.version}>
          <section>
            <h3>Logos</h3>
            <div className="bk-logos">
              {(['primary', 'reversed', 'icon'] as const).map((role) => (
                <label key={role} className="bk-logo">
                  <span className={'bk-lthumb' + (role === 'reversed' ? ' dark' : '')}>{src(kit.logos[role]) ? <img src={src(kit.logos[role])} alt="" /> : <em>None</em>}</span>
                  <span className="bk-k">{role === 'primary' ? 'Main logo' : role === 'reversed' ? 'On dark' : 'Icon'}</span>
                  <select className="in" value={kit.logos[role] || ''} onChange={(e) => set((k) => { k.logos[role] = e.target.value || null; })}>
                    <option value="">None</option>
                    {logos.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
                  </select>
                </label>
              ))}
            </div>
            {!logos.length && <p className="tip">Upload your logo to Logos and pick it here.</p>}
          </section>

          <section>
            <h3>Colours</h3>
            <div className="bk-colors">
              {COLOR_ROLES.map((r) => (
                <label key={r} className="bk-color">
                  <input type="color" value={kit.colors[r] || '#ffffff'} onChange={(e) => set((k) => { k.colors[r] = e.target.value; })} aria-label={COLOR_LABEL[r]} />
                  <span className="bk-k">{COLOR_LABEL[r]}</span>
                  <input className="fin mono" value={kit.colors[r] || ''} placeholder="Not set" maxLength={7}
                    onChange={(e) => set((k) => { k.colors[r] = e.target.value || null; })} onBlur={() => set((k) => { k.colors = normaliseKit(k).colors; })} />
                </label>
              ))}
            </div>
          </section>

          <section>
            <h3>Type</h3>
            {(['heading', 'body'] as const).map((role) => (
              <div key={role} className="bk-font">
                <span className="bk-k">{role === 'heading' ? 'Headings' : 'Body'}</span>
                <input className="in" placeholder="Font family" value={kit.type[role].family} onChange={(e) => set((k) => { k.type[role].family = e.target.value; })} />
                <input className="in bk-w" type="number" step={100} min={100} max={900} value={kit.type[role].weight} onChange={(e) => set((k) => { k.type[role].weight = +e.target.value; })} aria-label="Weight" />
                <input className="in mono" placeholder="Web font link (Google Fonts CSS)" value={kit.type[role].url} onChange={(e) => set((k) => { k.type[role].url = e.target.value; })} />
                <input className="in mono" placeholder="Fallback" value={kit.type[role].fallback} onChange={(e) => set((k) => { k.type[role].fallback = e.target.value; })} />
              </div>
            ))}
            <div className="bk-row">
              <Num label="H1" value={kit.type.sizes.h1} onChange={(n) => set((k) => { k.type.sizes.h1 = n; })} />
              <Num label="H2" value={kit.type.sizes.h2} onChange={(n) => set((k) => { k.type.sizes.h2 = n; })} />
              <Num label="Body" value={kit.type.sizes.body} onChange={(n) => set((k) => { k.type.sizes.body = n; })} />
              <Num label="Small" value={kit.type.sizes.small} onChange={(n) => set((k) => { k.type.sizes.small = n; })} />
            </div>
            <Seg label="Headline case" value={kit.type.heading_case} options={[['none', 'As typed'], ['upper', 'UPPERCASE'], ['title', 'Title Case']]} onChange={(v) => set((k) => { k.type.heading_case = v as any; })} />
          </section>

          <section>
            <h3>Buttons and layout</h3>
            <Seg label="Button style" value={kit.button.style} options={[['filled', 'Filled'], ['outline', 'Outline'], ['underline', 'Underlined link']]} onChange={(v) => set((k) => { k.button.style = v as any; })} />
            <Seg label="Button case" value={kit.button.case} options={[['none', 'As typed'], ['upper', 'UPPERCASE'], ['title', 'Title Case']]} onChange={(v) => set((k) => { k.button.case = v as any; })} />
            <div className="bk-row">
              <Num label="Radius" value={kit.button.radius} onChange={(n) => set((k) => { k.button.radius = n; })} />
              <Num label="Pad Y" value={kit.button.padding_y} onChange={(n) => set((k) => { k.button.padding_y = n; })} />
              <Num label="Pad X" value={kit.button.padding_x} onChange={(n) => set((k) => { k.button.padding_x = n; })} />
              <Num label="Weight" value={kit.button.weight} unit="" onChange={(n) => set((k) => { k.button.weight = n; })} />
            </div>
            <div className="bk-row">
              <Num label="Email width" value={kit.layout.width} onChange={(n) => set((k) => { k.layout.width = n; })} />
              <Num label="Corners" value={kit.layout.radius} onChange={(n) => set((k) => { k.layout.radius = n; })} />
              <Num label="Spacing" value={kit.layout.spacing} onChange={(n) => set((k) => { k.layout.spacing = n; })} />
            </div>
          </section>

          <section>
            <h3>Imagery</h3>
            <textarea className="in" rows={2} placeholder="e.g. Natural light, muted tones, product on textured surfaces, lots of space" value={kit.imagery.style} onChange={(e) => set((k) => { k.imagery.style = e.target.value; })} />
            <div className="bk-two">
              <label><span className="bk-k">Do (one per line)</span><textarea className="in" rows={3} defaultValue={kit.imagery.do.join('\n')} onBlur={(e) => set((k) => { k.imagery.do = lines(e.target.value); })} /></label>
              <label><span className="bk-k">Don’t (one per line)</span><textarea className="in" rows={3} defaultValue={kit.imagery.dont.join('\n')} onBlur={(e) => set((k) => { k.imagery.dont = lines(e.target.value); })} /></label>
            </div>
            <span className="bk-k">Reference images (up to 6)</span>
            <div className="bk-refs">
              {kit.imagery.references.map((id) => (
                <button key={id} type="button" className="bk-ref" title="Remove" onClick={() => set((k) => { k.imagery.references = k.imagery.references.filter((x) => x !== id); })}>
                  {src(id) ? <img src={src(id)} alt="" /> : null}<span>×</span>
                </button>
              ))}
              {kit.imagery.references.length < 6 && images.length > 0 && (
                <select className="in" value="" onChange={(e) => e.target.value && set((k) => { k.imagery.references = [...k.imagery.references, e.target.value]; })}>
                  <option value="">Add from Images…</option>
                  {images.filter((i) => !kit.imagery.references.includes(i.id)).map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
                </select>
              )}
            </div>
          </section>

          <section>
            <h3>Voice</h3>
            <input className="in" placeholder="Tone words, comma separated: warm, confident, plain" defaultValue={kit.voice.tone.join(', ')} onBlur={(e) => set((k) => { k.voice.tone = e.target.value.split(',').map((x) => x.trim()).filter(Boolean); })} />
            <textarea className="in" rows={2} placeholder="Notes for Claude (anything else it should know about this brand)" value={kit.notes} onChange={(e) => set((k) => { k.notes = e.target.value; })} />
          </section>

          <section className="bk-rebuild">
            <h3>Rebuild</h3>
            <form className="inline" onSubmit={buildFromSite}>
              <input className="in" placeholder="yourbrand.com" value={site} onChange={(e) => setSite(e.target.value)} disabled={building} />
              <button className="btn" type="submit" disabled={building || !site.trim()}>{building ? 'Reading…' : 'Refresh from website'}</button>
            </form>
            <p className="tip">Refreshing updates what the site shows and keeps your logos, references and notes. Or ask Claude: <button type="button" className="linkish" onClick={() => copy(figmaPrompt)}>copy the Figma request</button>.</p>
          </section>
        </div>

        <Preview kit={kit} logo={src(kit.logos.primary)} photo={src(kit.imagery.references[0])} />
      </div>
    </div>
  );
}

function Num({ label, value, onChange, unit = 'px' }: { label: string; value: number; onChange: (n: number) => void; unit?: string }) {
  return <label className="bk-num"><span>{label}</span><input className="in" type="number" value={value} onChange={(e) => onChange(+e.target.value)} /><em>{unit}</em></label>;
}

function Seg({ label, value, options, onChange }: { label: string; value: string; options: [string, string][]; onChange: (v: string) => void }) {
  return (
    <div className="bk-seg"><span className="bk-k">{label}</span>
      <div className="seg" role="group" aria-label={label}>{options.map(([v, l]) => <button key={v} type="button" aria-pressed={value === v} onClick={() => onChange(v)}>{l}</button>)}</div>
    </div>
  );
}

function hostOf(u?: string | null) { try { return new URL(u || '').hostname.replace(/^www\./, ''); } catch { return 'website'; } }

// A small email drawn with the kit, so people can judge it by looking.
function Preview({ kit, logo, photo }: { kit: BrandKit; logo?: string; photo?: string }) {
  const c = kit.colors;
  const bg = c.background || '#ffffff', text = c.text || '#1d1d1f';
  const head = [kit.type.heading.family && `'${kit.type.heading.family}'`, kit.type.heading.fallback].filter(Boolean).join(', ');
  const body = [kit.type.body.family && `'${kit.type.body.family}'`, kit.type.body.fallback].filter(Boolean).join(', ');
  const kase = (s: string, k: string) => (k === 'upper' ? s.toUpperCase() : k === 'title' ? s.replace(/\b\w/g, (m) => m.toUpperCase()) : s);
  const btnBg = c.button_bg || c.primary || '#1d1d1f', btnText = c.button_text || '#ffffff';
  const b = kit.button;
  const btn: React.CSSProperties = b.style === 'underline'
    ? { color: c.link || btnBg, textDecoration: 'underline', fontWeight: b.weight }
    : { background: b.style === 'filled' ? btnBg : 'transparent', color: b.style === 'filled' ? btnText : btnBg, border: b.style === 'outline' ? `2px solid ${btnBg}` : 0, borderRadius: b.radius, padding: `${b.padding_y}px ${b.padding_x}px`, fontWeight: b.weight, display: 'inline-block', textDecoration: 'none' };
  const fonts = [...new Set([kit.type.heading.url, kit.type.body.url].filter(Boolean))];
  return (
    <aside className="bk-preview" aria-label="Preview">
      {fonts.map((u) => <link key={u} rel="stylesheet" href={u} />)}
      <div className="bk-k">Preview</div>
      <div className="bk-mail" style={{ background: c.surface || '#f3f3f4' }}>
        <div className="bk-inner" style={{ background: bg, color: text, fontFamily: body, fontSize: kit.type.sizes.body, borderRadius: kit.layout.radius }}>
          <div style={{ padding: `${kit.layout.spacing * 0.75}px ${kit.layout.spacing}px`, textAlign: 'center', borderBottom: c.border ? `1px solid ${c.border}` : undefined }}>
            {logo ? <img src={logo} alt="Logo" style={{ maxHeight: 34, maxWidth: 160 }} /> : <b style={{ fontFamily: head }}>{kit.name || 'Your logo'}</b>}
          </div>
          <div className="bk-hero" style={{ background: photo ? `center/cover url(${photo})` : c.primary || '#ddd' }} />
          <div style={{ padding: kit.layout.spacing }}>
            {c.accent && <div style={{ color: c.accent, fontSize: kit.type.sizes.small, fontWeight: 700, letterSpacing: '.06em', marginBottom: 6 }}>NEW SEASON</div>}
            <div style={{ fontFamily: head, fontWeight: kit.type.heading.weight, fontSize: Math.round(kit.type.sizes.h1 * 0.8), lineHeight: 1.15, marginBottom: 10 }}>{kase('The autumn edit is here', kit.type.heading_case)}</div>
            <p style={{ margin: '0 0 8px', lineHeight: 1.5 }}>Warm layers, made to last. Discover this season’s pieces, chosen for everyday wear.</p>
            <p style={{ margin: '0 0 18px', color: c.text_muted || text, fontSize: kit.type.sizes.small }}>Free delivery over £50 · <span style={{ color: c.link || btnBg, textDecoration: 'underline' }}>See details</span></p>
            <span style={btn}>{kase('Shop the edit', b.case)}</span>
          </div>
        </div>
      </div>
      <p className="tip">Most inboxes don’t load web fonts; Gmail and Outlook show the fallback ({(kit.type.body.fallback || '').split(',')[0]}).</p>
    </aside>
  );
}
