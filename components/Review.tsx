'use client';
import { useMemo, useState } from 'react';
import { Icon } from './icons';
import type { Asset } from './Library';
import { ORDER, SECTION, reviewQueue, summaryLine, type ReviewItem, type ReviewKind } from '@/lib/review';

// Review: the home when something needs a person. Mise files, tags, checks and makes things on
// its own; this is where people make the calls it shouldn't make alone.
export default function Review({ items, kit, thumbOf, canDecide = true, onApprove, onReject, onKeepBoth, onFine, onRetry, onOpen, onProducts, onBrandKit, onLibrary }: {
  items: Asset[];
  kit: { status?: string | null } | null;
  thumbOf: (a?: Asset | null) => string | null;
  canDecide?: boolean; // editors and up approve and reject
  onApprove: (ids: string[]) => Promise<void>;
  onReject: (a: Asset) => Promise<void>;
  onKeepBoth: (a: Asset) => Promise<void>;
  onFine: (a: Asset) => Promise<void>;
  onRetry: (a: Asset) => Promise<void>;
  onOpen: (id: string) => void;
  onProducts: () => void;
  onBrandKit: () => void;
  onLibrary: () => void;
}) {
  const q = useMemo(() => reviewQueue(items, kit), [items, kit]);
  const byId = useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);
  const [busy, setBusy] = useState<string | null>(null);
  const groups = ORDER.map((k) => ({ kind: k, list: q.items.filter((i) => i.kind === k) })).filter((g) => g.list.length);

  async function run(key: string, fn: () => Promise<void>) {
    setBusy(key);
    try { await fn(); } finally { setBusy(null); }
  }

  return (
    <div className="review">
      <div className="lib-head">
        <h1>Review</h1>
        <span className="lib-fact">{q.count ? `${q.count} thing${q.count === 1 ? '' : 's'} need${q.count === 1 ? 's' : ''} you` : 'All clear'}</span>
      </div>
      <p className="rv-week"><Icon.Sparkle size={15} />{summaryLine(q.summary)}</p>
      {!canDecide && groups.length > 0 && <p className="tip">An editor, admin or owner decides on these. You can open any of them to look.</p>}

      {!groups.length ? (
        <div className="rv-clear">
          <span className="rv-tick"><Icon.Check size={22} /></span>
          <h2>Nothing needs you</h2>
          <p className="tip">New files are filed, tagged and checked against your brand kit as they arrive. Anything Mise shouldn’t decide on its own lands here.</p>
          <button className="btn" type="button" onClick={onLibrary}>Go to assets</button>
        </div>
      ) : groups.map((g) => (
        <section key={g.kind} className="rv-sec">
          <div className="rv-sec-h">
            <h2>{SECTION[g.kind].title} <span>{g.kind === 'no_image' ? g.list[0].asset_ids?.length : g.list.length}</span></h2>
            {canDecide && g.kind === 'draft' && g.list.length > 1 && (
              <button className="btn quiet" type="button" disabled={busy === 'all'} onClick={() => run('all', () => onApprove(g.list.map((i) => i.asset_id!)))}>
                <Icon.Check size={15} />Approve all {g.list.length}
              </button>
            )}
          </div>
          <p className="tip">{SECTION[g.kind].hint}</p>
          <div className="rv-list">
            {g.list.map((it) => <Row key={it.key} it={it} kind={g.kind} a={it.asset_id ? byId.get(it.asset_id) : undefined} other={it.other_id ? byId.get(it.other_id) : undefined}
              thumbOf={thumbOf} busy={busy === it.key || busy === 'all'} readOnly={!canDecide}
              act={(fn) => run(it.key, fn)} {...{ onApprove, onReject, onKeepBoth, onFine, onRetry, onOpen, onProducts, onBrandKit }} />)}
          </div>
        </section>
      ))}

      <p className="tip rv-claude">In Claude, ask “What needs me in Mise?”: it sees this same list and can approve, fix or tidy for you.</p>
    </div>
  );
}

function Row({ it, kind, a, other, thumbOf, busy, readOnly, act, onApprove, onReject, onKeepBoth, onFine, onRetry, onOpen, onProducts, onBrandKit }: {
  it: ReviewItem; kind: ReviewKind; a?: Asset; other?: Asset; thumbOf: (a?: Asset | null) => string | null; busy: boolean; readOnly?: boolean;
  act: (fn: () => Promise<void>) => void;
  onApprove: (ids: string[]) => Promise<void>; onReject: (a: Asset) => Promise<void>; onKeepBoth: (a: Asset) => Promise<void>;
  onFine: (a: Asset) => Promise<void>; onRetry: (a: Asset) => Promise<void>; onOpen: (id: string) => void; onProducts: () => void; onBrandKit: () => void;
}) {
  const src = thumbOf(a);
  const thumb = (x?: Asset, s?: string | null) => (
    <button type="button" className="rv-thumb" onClick={() => x && onOpen(x.id)} aria-label={x ? `Open ${x.name}` : undefined} disabled={!x}>
      {s ? <img src={s} alt="" loading="lazy" /> : kind === 'brand_kit' ? <Icon.Palette size={22} /> : kind === 'no_image' ? <Icon.Bag size={22} /> : <Icon.Image size={22} />}
    </button>
  );
  return (
    <div className={'rv-row' + (busy ? ' busy' : '')}>
      <div className="rv-thumbs">
        {thumb(a, src)}
        {kind === 'duplicate' && other && <>{<span className="rv-eq">≈</span>}{thumb(other, thumbOf(other))}</>}
      </div>
      <div className="rv-text">
        <b>{it.title}</b>
        <span>{it.detail}</span>
      </div>
      <div className="rv-acts">
        {readOnly ? (a ? <button className="btn" type="button" onClick={() => onOpen(a.id)}>Open</button> : null) : <>
        {kind === 'draft' && a && <>
          <button className="btn quiet" type="button" disabled={busy} onClick={() => act(() => onReject(a))}>Reject</button>
          <button className="btn" type="button" disabled={busy} onClick={() => onOpen(a.id)}>Open</button>
          <button className="primary" type="button" disabled={busy} onClick={() => act(() => onApprove([a.id]))}><Icon.Check size={15} />Approve</button>
        </>}
        {kind === 'duplicate' && a && <>
          <button className="btn quiet" type="button" disabled={busy} onClick={() => act(() => onReject(a))}>Delete this one</button>
          <button className="btn" type="button" disabled={busy} onClick={() => act(() => onKeepBoth(a))}>Keep both</button>
        </>}
        {kind === 'off_brand' && a && <>
          <button className="btn quiet" type="button" disabled={busy} onClick={() => act(() => onReject(a))}>Delete</button>
          <button className="btn" type="button" disabled={busy} onClick={() => onOpen(a.id)}>Open</button>
          <button className="btn" type="button" disabled={busy} onClick={() => act(() => onFine(a))}>It’s fine</button>
        </>}
        {kind === 'failed' && a && <>
          <button className="btn" type="button" disabled={busy} onClick={() => onOpen(a.id)}>Open</button>
          <button className="btn" type="button" disabled={busy} onClick={() => act(() => onRetry(a))}>Try again</button>
        </>}
        {kind === 'no_image' && <button className="btn" type="button" onClick={onProducts}>See products</button>}
        {kind === 'brand_kit' && <button className="btn" type="button" onClick={onBrandKit}>Open brand kit</button>}
        </>}
      </div>
    </div>
  );
}
