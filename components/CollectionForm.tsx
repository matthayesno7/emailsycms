'use client';
import { useEffect, useMemo, useState } from 'react';
import { matchesRules, type Collection, type Rules } from '@/lib/collections';
import type { Asset } from './Library';

const KINDS: [string, string][] = [['image', 'Images'], ['logo', 'Logos'], ['product', 'Products'], ['video', 'Videos']];

// Create or edit a smart collection. It fills itself from the rules, now and as files arrive.
export default function CollectionForm({ initial, items, ws, onSave, onDelete, onCancel }: {
  initial?: Partial<Collection> | null;
  items: Asset[];
  ws?: string;
  onSave: (c: { name: string; rules: Rules }) => void;
  onDelete?: () => void;
  onCancel: () => void;
}) {
  const r0 = initial?.rules || {};
  const [name, setName] = useState(initial?.name || '');
  const [tags, setTags] = useState((r0.tags || []).join(', '));
  const [match, setMatch] = useState<'any' | 'all'>(r0.match || 'any');
  const [kinds, setKinds] = useState<string[]>(r0.kinds || []);
  const [text, setText] = useState(r0.text || '');
  const [brand, setBrand] = useState<'any' | 'on' | 'off'>(r0.on_brand === true ? 'on' : r0.on_brand === false ? 'off' : 'any');

  const rules: Rules = useMemo(() => {
    const t = tags.split(',').map((x) => x.trim().toLowerCase()).filter(Boolean);
    const r: Rules = {};
    if (t.length) { r.tags = t; if (t.length > 1) r.match = match; }
    if (kinds.length) r.kinds = kinds;
    if (text.trim()) r.text = text.trim();
    if (brand !== 'any') r.on_brand = brand === 'on';
    return r;
  }, [tags, match, kinds, text, brand]);
  // Words are matched by meaning: the AI search reads them (Claude turns a sentence like "only stuff for email"
  // into what to look for) and finds the files, so the count is what the collection will really hold.
  const [found, setFound] = useState<{ text: string; ids: Set<string>; ai: Rules['ai'] } | null>(null);
  const [looking, setLooking] = useState(false);
  const t = text.trim();
  useEffect(() => {
    if (!t || !ws) { setFound(null); return; }
    let gone = false;
    setLooking(true);
    const timer = setTimeout(async () => {
      const reuse = initial?.rules?.text === t ? initial.rules.ai : null;
      const body = reuse ? { workspace_id: ws, q: reuse.text, filters: { ...reuse.filters, ...(kinds.length ? { kinds } : {}) } }
        : { workspace_id: ws, q: t, filters: kinds.length ? { kinds } : {}, understand: t.split(/\s+/).length >= 3 };
      const r = await fetch('/api/search', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }).catch(() => null);
      const j = r?.ok ? await r.json().catch(() => null) : null;
      if (gone) return;
      setLooking(false);
      if (!j) { setFound(null); return; }
      const ai = reuse || (j.understood ? { text: j.text, filters: Object.fromEntries(Object.entries(j.filters || {}).filter(([k]) => k !== 'kinds')) } : null);
      setFound({ text: t, ids: new Set((j.hits || []).map((h: any) => h.id)), ai });
    }, 600);
    return () => { gone = true; clearTimeout(timer); };
  }, [t, ws, kinds.join(',')]); // eslint-disable-line react-hooks/exhaustive-deps
  const hits = found && found.text === t ? found.ids : null;
  const count = useMemo(() => items.filter((i) => matchesRules(i, rules, hits)).length, [items, rules, hits]);
  const read = found && found.text === t && found.ai && found.ai.text.toLowerCase() !== t.toLowerCase() ? found.ai.text : null;
  const empty = !Object.keys(rules).length;

  return (
    <form className="settings collform" onSubmit={(e) => { e.preventDefault(); if (name.trim() && !empty) onSave({ name: name.trim().slice(0, 60), rules: t && found?.text === t && found.ai ? { ...rules, ai: found.ai } : rules }); }}>
      <h2>{initial?.id ? 'Edit smart collection' : 'New smart collection'}</h2>
      <p className="tip">A saved search that fills itself: new files that match land here automatically.</p>
      <div className="bf"><div className="bl"><label htmlFor="cname">Name</label></div>
        <input id="cname" className="in" autoFocus value={name} maxLength={60} placeholder="e.g. Lifestyle, summer" onChange={(e) => setName(e.target.value)} /></div>
      <div className="bf"><div className="bl"><label htmlFor="ctags">Tags</label>
        {tags.includes(',') && <div className="seg mini" role="group" aria-label="Match">
          <button type="button" aria-pressed={match === 'any'} onClick={() => setMatch('any')}>Any</button>
          <button type="button" aria-pressed={match === 'all'} onClick={() => setMatch('all')}>All</button>
        </div>}</div>
        <input id="ctags" className="in" value={tags} placeholder="lifestyle, summer" onChange={(e) => setTags(e.target.value)} /></div>
      <div className="bf"><div className="bl"><label htmlFor="ctext">Describe it</label></div>
        <input id="ctext" className="in" value={text} placeholder="Describe what belongs here, e.g. lifestyle shots for email" onChange={(e) => setText(e.target.value)} /></div>
      <div className="bf"><div className="bl"><span>Types</span></div>
        <div className="chips">{KINDS.map(([k, l]) => <button key={k} type="button" className="chip" aria-pressed={kinds.includes(k)} onClick={() => setKinds((ks) => (ks.includes(k) ? ks.filter((x) => x !== k) : [...ks, k]))}>{l}</button>)}</div></div>
      <div className="bf"><div className="bl"><span>Brand check</span></div>
        <div className="seg" role="group" aria-label="Brand check">
          {([['any', 'Any'], ['on', 'On brand'], ['off', 'Off brand']] as const).map(([k, l]) => <button key={k} type="button" aria-pressed={brand === k} onClick={() => setBrand(k)}>{l}</button>)}
        </div></div>
      <p className="tip">{empty ? 'Add at least one rule.' : t && looking && found?.text !== t ? 'Finding matches…' : `${count} file${count === 1 ? '' : 's'} match right now.`}{read && <> Looking for “{read}”.</>}</p>
      <div className="actions">
        {onDelete && <button className="btn quiet" type="button" onClick={onDelete}>Delete collection</button>}
        <span className="spacer" />
        <button className="btn" type="button" onClick={onCancel}>Cancel</button>
        <button className="primary" type="submit" disabled={!name.trim() || empty}>Save</button>
      </div>
    </form>
  );
}
