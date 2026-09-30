'use client';
import { useMemo, useState } from 'react';
import { CATEGORIES, PROMPTS, QUICK_FORMATS, USE_LABEL, fillPrompt, type PromptCategory } from '@/lib/prompts';
import type { BrandKitRow } from '@/lib/brandKit';
import { Icon } from './icons';
import type { Asset, Ws } from './Library';

// The home page: Claude-first. Describe what you want (or pick from the prompt library),
// send it to Claude, and what Claude makes lands back in the library for approval.
export default function Create({ ws, items, urls, kit, connected, onConnect, onBrandKit, onReview, onOpen, toast }: {
  ws: Ws;
  items: Asset[];
  urls: Record<string, string>;
  kit: BrandKitRow | null;
  connected: boolean;
  onConnect: () => void;
  onBrandKit: () => void;
  onReview: () => void;
  onOpen: (a: Asset) => void;
  toast: (m: string) => void;
}) {
  const [cat, setCat] = useState<PromptCategory | 'all'>('all');
  const [ask, setAsk] = useState('');
  const [fmt, setFmt] = useState<string | null>(null);
  const [productId, setProductId] = useState('');

  const products = useMemo(() => items.filter((i) => i.kind === 'product'), [items]);
  const images = useMemo(() => items.filter((i) => i.kind === 'image' && i.origin !== 'generated'), [items]);
  const product = products.find((p) => p.id === productId) || products[0];
  const made = useMemo(() => items.filter((i) => i.origin === 'generated').slice(0, 8), [items]);
  const drafts = items.filter((i) => i.status === 'draft').length;
  const fill = { brand: ws.name, product: product?.name, pid: product?.pid, image: images[0]?.name, figma: ws.figma_file_url };
  const shown = PROMPTS.filter((p) => cat === 'all' || p.category === cat);

  const composed = (() => {
    const what = ask.trim();
    if (!what && !fmt) return '';
    const parts = [`For ${ws.name}: ${what || 'make a'}${fmt ? `${what ? '. Format:' : ''} ${fmt}` : ''}.`];
    if (productId && product) parts.push(`Use our product "${product.name}" (PID ${product.pid}) from Emailsy.`);
    parts.push('Use our Emailsy brand kit and assets, make it in Figma' + (ws.figma_file_url ? ` (${ws.figma_file_url})` : '') + ', and save the result to Emailsy.');
    return parts.join(' ');
  })();

  async function copy(text: string) {
    try { await navigator.clipboard.writeText(text); toast('Copied. Paste it into Claude.'); } catch { toast(text); }
  }
  const openInClaude = (text: string) => window.open(`https://claude.ai/new?q=${encodeURIComponent(text)}`, '_blank', 'noopener');
  const src = (a: Asset) => (a.images?.email?.path && urls[a.images.email.path]) || (a.storage_path ? urls[a.storage_path] : undefined);

  const steps = [
    { done: connected, label: 'Connect Claude', note: 'Add Emailsy and Figma to Claude', go: onConnect },
    { done: kit?.status === 'approved', label: kit ? 'Approve your brand kit' : 'Set up your brand kit', note: kit ? 'It’s a draft' : 'From your website or Figma', go: onBrandKit },
    { done: items.some((i) => i.kind !== 'block' && i.origin !== 'generated'), label: 'Add assets', note: 'Logos, images, a product feed', go: undefined },
  ];

  return (
    <div className="create">
      <section className="cr-hero">
        <h1>What are we making for {ws.name}?</h1>
        <p>Describe it and send it to Claude. Claude uses your brand kit and assets, makes it in Figma, and saves it back here for you to approve.</p>
        <div className="cr-compose">
          <textarea className="in" rows={3} value={ask} onChange={(e) => setAsk(e.target.value)}
            placeholder="e.g. A LinkedIn banner for our autumn launch, warm and simple, with the new merino range"
            onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter' && composed) openInClaude(composed); }} />
          <div className="cr-formats" role="group" aria-label="Format">
            {QUICK_FORMATS.map(([label, value]) => (
              <button key={label} type="button" className="chip" aria-pressed={fmt === value} onClick={() => setFmt(fmt === value ? null : value)}>{label}</button>
            ))}
          </div>
          <div className="cr-row">
            {products.length > 0 && (
              <select className="in cr-prod" value={productId} onChange={(e) => setProductId(e.target.value)} aria-label="Feature a product">
                <option value="">No particular product</option>
                {products.slice(0, 300).map((p) => <option key={p.id} value={p.id}>{p.pid} · {p.name}</option>)}
              </select>
            )}
            <span className="spacer" />
            <button className="btn" type="button" disabled={!composed} onClick={() => copy(composed)}>Copy</button>
            <button className="primary" type="button" disabled={!composed} onClick={() => openInClaude(composed)}><Icon.Sparkle size={16} />Open in Claude</button>
          </div>
          {composed && <p className="tip cr-preview">{composed}</p>}
        </div>
      </section>

      {steps.some((s) => !s.done) && (
        <section className="cr-steps" aria-label="Setup">
          {steps.map((s, i) => (
            <button key={s.label} type="button" className={'cr-step' + (s.done ? ' done' : '')} disabled={!s.go || s.done} onClick={s.go}>
              <span className="n">{s.done ? '✓' : i + 1}</span>
              <span><b>{s.label}</b><em>{s.done ? 'Done' : s.note}</em></span>
            </button>
          ))}
        </section>
      )}

      {made.length > 0 && (
        <section>
          <div className="cr-h"><h2>Made with Claude</h2>{drafts > 0 && <button className="linkish" type="button" onClick={onReview}>{drafts} waiting for approval</button>}</div>
          <div className="cr-made">
            {made.map((a) => (
              <button key={a.id} type="button" className="cr-thumb" onClick={() => onOpen(a)} title={a.name}>
                {a.kind === 'video' ? <video src={src(a)} muted playsInline preload="metadata" /> : src(a) ? <img src={src(a)} alt="" /> : null}
                {a.status === 'draft' && <span className="tag draft">Draft</span>}
                <span className="cr-cap">{a.name}</span>
              </button>
            ))}
          </div>
        </section>
      )}

      <section>
        <div className="cr-h">
          <h2>Prompt library</h2>
          <span className="tip">Filled in with {ws.name}{product ? ` and ${product.name}` : ''}. Copy one, or open it straight in Claude.</span>
        </div>
        <div className="seg cr-cats" role="group" aria-label="Category">
          {CATEGORIES.map(([k, l]) => <button key={k} type="button" aria-pressed={cat === k} onClick={() => setCat(k)}>{l}</button>)}
        </div>
        <div className="cr-grid">
          {shown.map((p) => {
            const text = fillPrompt(p.prompt, fill);
            return (
              <article key={p.id} className="cr-card">
                <div className="cr-meta"><span>{p.format}</span></div>
                <h3>{p.title}</h3>
                <p>{text}</p>
                <div className="cr-uses">{p.uses.map((u) => <span key={u} className={'use ' + u}>{USE_LABEL[u]}</span>)}</div>
                <div className="cr-actions">
                  <button className="btn" type="button" onClick={() => copy(text)}>Copy</button>
                  <button className="btn" type="button" onClick={() => openInClaude(text)}>Open in Claude</button>
                </div>
              </article>
            );
          })}
        </div>
        <p className="tip cr-foot">AI image and video runs use your Figma Weave credits; Claude tells you the cost and asks before running. Everything Claude makes arrives here as a draft.</p>
      </section>
    </div>
  );
}
