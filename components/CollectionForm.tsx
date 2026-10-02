'use client';
import { useMemo, useState } from 'react';
import { matchesRules, type Collection, type Rules } from '@/lib/collections';
import type { Asset } from './Library';

const KINDS: [string, string][] = [['image', 'Images'], ['logo', 'Logos'], ['product', 'Products'], ['video', 'Videos']];

// Create or edit a smart collection. It fills itself from the rules, now and as files arrive.
export default function CollectionForm({ initial, items, onSave, onDelete, onCancel }: {
  initial?: Partial<Collection> | null;
  items: Asset[];
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
  const count = useMemo(() => items.filter((i) => matchesRules(i, rules)).length, [items, rules]);
  const empty = !Object.keys(rules).length;

  return (
    <form className="settings collform" onSubmit={(e) => { e.preventDefault(); if (name.trim() && !empty) onSave({ name: name.trim().slice(0, 60), rules }); }}>
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
      <div className="bf"><div className="bl"><label htmlFor="ctext">Words</label></div>
        <input id="ctext" className="in" value={text} placeholder="Anything in the name, description or text in the image" onChange={(e) => setText(e.target.value)} /></div>
      <div className="bf"><div className="bl"><span>Types</span></div>
        <div className="chips">{KINDS.map(([k, l]) => <button key={k} type="button" className="chip" aria-pressed={kinds.includes(k)} onClick={() => setKinds((ks) => (ks.includes(k) ? ks.filter((x) => x !== k) : [...ks, k]))}>{l}</button>)}</div></div>
      <div className="bf"><div className="bl"><span>Brand check</span></div>
        <div className="seg" role="group" aria-label="Brand check">
          {([['any', 'Any'], ['on', 'On brand'], ['off', 'Off brand']] as const).map(([k, l]) => <button key={k} type="button" aria-pressed={brand === k} onClick={() => setBrand(k)}>{l}</button>)}
        </div></div>
      <p className="tip">{empty ? 'Add at least one rule.' : `${count} file${count === 1 ? '' : 's'} match right now.`}</p>
      <div className="actions">
        {onDelete && <button className="btn quiet" type="button" onClick={onDelete}>Delete collection</button>}
        <span className="spacer" />
        <button className="btn" type="button" onClick={onCancel}>Cancel</button>
        <button className="primary" type="submit" disabled={!name.trim() || empty}>Save</button>
      </div>
    </form>
  );
}
