'use client';
import { useMemo, useRef, useState } from 'react';
import { CATEGORIES, MOCKS, PROMPTS, USE_LABEL, fillPrompt, type PromptCategory } from '@/lib/prompts';
import { normaliseKit, type BrandKitRow } from '@/lib/brandKit';
import Mock, { type Brand } from './Mock';
import { Icon } from './icons';
import type { Asset, Ws } from './Library';

// Quick formats for the composer, drawn at their real proportions.
const FORMATS: { label: string; size: [number, number]; ask: string; video?: boolean }[] = [
  { label: 'Email hero', size: [1200, 600], ask: 'an email hero banner, 1200×600' },
  { label: 'LinkedIn banner', size: [1128, 191], ask: 'a LinkedIn company banner, 1128×191' },
  { label: 'LinkedIn post', size: [1200, 627], ask: 'a LinkedIn post image, 1200×627' },
  { label: 'Instagram post', size: [1080, 1350], ask: 'an Instagram post, 1080×1350' },
  { label: 'Story', size: [1080, 1920], ask: 'an Instagram story, 1080×1920' },
  { label: 'Square ad', size: [1080, 1080], ask: 'a square social ad, 1080×1080' },
  { label: 'Product reel', size: [1080, 1920], ask: 'a 6-second vertical product video, 1080×1920', video: true },
  { label: 'Animated banner', size: [1200, 600], ask: 'an animated email banner, 1200×600, under 4 seconds', video: true },
];

// The home page: Claude-first and visual. Describe it or pick a design from the library;
// Claude makes it with the brand kit and assets and saves it back for approval.
export default function Create({ ws, items, urls, kit, connected, onConnect, onBrandKit, onReview, onOpen, toast }: {
  ws: Ws; items: Asset[]; urls: Record<string, string>; kit: BrandKitRow | null; connected: boolean;
  onConnect: () => void; onBrandKit: () => void; onReview: () => void; onOpen: (a: Asset) => void; toast: (m: string) => void;
}) {
  const [cat, setCat] = useState<PromptCategory | 'all'>('all');
  const [ask, setAsk] = useState('');
  const [fmt, setFmt] = useState<number | null>(null);
  const [picked, setPicked] = useState<string | null>(null); // prompt id loaded into the composer
  const box = useRef<HTMLTextAreaElement>(null);

  const src = (a?: Asset) => (a ? (a.images?.email?.path && urls[a.images.email.path]) || (a.storage_path ? urls[a.storage_path] : undefined) : undefined);
  const products = useMemo(() => items.filter((i) => i.kind === 'product'), [items]);
  const photos = useMemo(() => items.filter((i) => i.kind === 'image' && i.origin !== 'generated'), [items]);
  const made = useMemo(() => items.filter((i) => i.origin === 'generated').slice(0, 10), [items]);
  const drafts = items.filter((i) => i.status === 'draft').length;
  // Pictures for the previews: the brand's own photos first, then product shots.
  const pool = useMemo(() => [...photos, ...products].map((a) => src(a)).filter(Boolean).slice(0, 12) as string[], [photos, products, urls]); // eslint-disable-line react-hooks/exhaustive-deps

  const k = normaliseKit(kit?.kit || { name: ws.name }, ws.name);
  const logoAsset = items.find((i) => i.id === k.logos.primary) || items.find((i) => i.kind === 'logo');
  const stack = (f: { family: string; fallback: string }) => [f.family && `'${f.family}'`, f.fallback].filter(Boolean).join(', ');
  const brand: Brand = {
    bg: k.colors.background || '#ffffff', surface: k.colors.surface || '#f1efeb', text: k.colors.text || '#1d1d1f',
    primary: k.colors.primary || '#1d1d1f', accent: k.colors.accent || k.colors.secondary || k.colors.primary || '#e8a317',
    btnBg: k.colors.button_bg || k.colors.primary || '#1d1d1f', btnText: k.colors.button_text || '#ffffff', radius: k.button.radius,
    head: stack(k.type.heading) || 'Georgia, serif', body: stack(k.type.body) || 'Arial, sans-serif', upper: k.type.heading_case === 'upper',
    logo: src(logoAsset), name: ws.name,
  };
  const fonts = [...new Set([k.type.heading.url, k.type.body.url].filter(Boolean))];

  const fill = { brand: ws.name, figma: ws.figma_file_url };
  const shown = PROMPTS.filter((p) => cat === 'all' || p.category === cat);

  const text = (() => {
    const t = ask.trim();
    if (picked) return t;
    if (!t && fmt === null) return '';
    const f = fmt !== null ? FORMATS[fmt] : null;
    return `For ${ws.name}: ${t || `make ${f?.ask}`}${t && f ? `. Make it ${f.ask}` : ''}. Use our Emailsy brand kit and assets, make it in Figma${ws.figma_file_url ? ` (${ws.figma_file_url})` : ''}, and save the result to Emailsy.`;
  })();
  const blanks = { product: text.includes('[product]'), image: text.includes('[image]') };

  function usePrompt(id: string) {
    const p = PROMPTS.find((x) => x.id === id)!;
    setPicked(id); setFmt(null); setAsk(fillPrompt(p.prompt, fill));
    window.scrollTo({ top: 0, behavior: 'smooth' });
    setTimeout(() => box.current?.focus({ preventScroll: true }), 300);
  }
  const fillBlank = (key: 'product' | 'image', a?: Asset) => a && setAsk((t) => t.replace(`[${key}]`, `"${a.name}"${a.pid ? ` (PID ${a.pid})` : ''}`));
  async function copy(t: string) { try { await navigator.clipboard.writeText(t); toast('Copied. Paste it into Claude.'); } catch { toast(t); } }
  const openInClaude = (t: string) => window.open(`https://claude.ai/new?q=${encodeURIComponent(t)}`, '_blank', 'noopener');

  const steps = [
    { done: connected, label: 'Connect Claude', note: 'Emailsy + Figma', go: onConnect },
    { done: kit?.status === 'approved', label: kit ? 'Approve your brand kit' : 'Brand kit', note: kit ? 'It’s a draft' : 'From your site or Figma', go: onBrandKit },
    { done: pool.length > 0, label: 'Add images', note: 'Photos, products, logos', go: undefined },
  ];

  return (
    <div className="create">
      {fonts.map((u) => <link key={u} rel="stylesheet" href={u} />)}

      <section className="cr-hero">
        <div className="cr-brand" onClick={onBrandKit} role="button" tabIndex={0} title="Brand kit">
          {brand.logo ? <img src={brand.logo} alt="" /> : <b style={{ fontFamily: brand.head }}>{ws.name}</b>}
          <span className="cr-sw">{[brand.primary, brand.accent, brand.text, brand.surface].map((c, i) => <i key={i} style={{ background: c }} />)}</span>
          <span className="cr-bk">{kit ? (kit.status === 'approved' ? 'Brand kit' : 'Brand kit · draft') : 'Set up brand kit'}</span>
        </div>
        <h1>What are we making?</h1>

        <div className={'cr-compose' + (picked ? ' picked' : '')}>
          {picked && <div className="cr-picked"><span>{PROMPTS.find((p) => p.id === picked)?.title}</span><button type="button" className="linkish" onClick={() => { setPicked(null); setAsk(''); }}>Clear</button></div>}
          <textarea ref={box} className="in" rows={picked ? 4 : 2} value={ask} onChange={(e) => setAsk(e.target.value)}
            placeholder="Describe it: “A LinkedIn banner for our autumn launch, warm and simple”"
            onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter' && text) openInClaude(text); }} />
          {(blanks.product || blanks.image) && (
            <div className="cr-blanks">
              {blanks.product && products.length > 0 && (
                <select className="in" value="" onChange={(e) => fillBlank('product', products.find((p) => p.id === e.target.value))}>
                  <option value="">Choose the product…</option>
                  {products.slice(0, 300).map((p) => <option key={p.id} value={p.id}>{p.pid} · {p.name}</option>)}
                </select>
              )}
              {blanks.image && photos.length > 0 && (
                <select className="in" value="" onChange={(e) => fillBlank('image', photos.find((p) => p.id === e.target.value))}>
                  <option value="">Choose the image…</option>
                  {photos.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              )}
              <span className="tip">or leave it and Claude will ask.</span>
            </div>
          )}
          {!picked && (
            <div className="cr-formats" role="group" aria-label="Format">
              {FORMATS.map((f, i) => {
                const r = f.size[0] / f.size[1];
                return (
                  <button key={f.label} type="button" className="cr-fmt" aria-pressed={fmt === i} onClick={() => setFmt(fmt === i ? null : i)}>
                    <span className="shape"><i style={r >= 1 ? { width: '100%', aspectRatio: `${r}` } : { height: '100%', aspectRatio: `${r}` }}>{f.video && <em>▶</em>}</i></span>
                    <b>{f.label}</b><small>{f.size[0]}×{f.size[1]}</small>
                  </button>
                );
              })}
            </div>
          )}
          <div className="cr-row">
            <span className="tip">Claude designs it in Figma with your brand kit and saves it here.</span>
            <span className="spacer" />
            <button className="btn" type="button" disabled={!text} onClick={() => copy(text)}>Copy</button>
            <button className="primary" type="button" disabled={!text} onClick={() => openInClaude(text)}><Icon.Sparkle size={16} />Make it in Claude</button>
          </div>
        </div>

        {steps.some((s) => !s.done) && (
          <div className="cr-steps" aria-label="Setup">
            {steps.map((s, i) => (
              <button key={s.label} type="button" className={'cr-step' + (s.done ? ' done' : '')} disabled={!s.go || s.done} onClick={s.go}>
                <span className="n">{s.done ? '✓' : i + 1}</span><span><b>{s.label}</b><em>{s.done ? 'Done' : s.note}</em></span>
              </button>
            ))}
          </div>
        )}
      </section>

      {made.length > 0 && (
        <section>
          <div className="cr-h"><h2>Made with Claude</h2>{drafts > 0 && <button className="linkish" type="button" onClick={onReview}>{drafts} to review</button>}</div>
          <div className="cr-made">
            {made.map((a) => (
              <button key={a.id} type="button" className="cr-shot" onClick={() => onOpen(a)} title={a.name}
                style={{ aspectRatio: a.width && a.height ? `${Math.max(0.56, Math.min(2.2, a.width / a.height))}` : '4 / 3' }}>
                {a.kind === 'video' ? <video src={src(a)} muted loop playsInline preload="metadata" onMouseEnter={(e) => e.currentTarget.play().catch(() => {})} onMouseLeave={(e) => e.currentTarget.pause()} /> : src(a) ? <img src={src(a)} alt="" /> : null}
                {a.status === 'draft' && <span className="tag draft">To review</span>}
                <span className="cr-cap">{a.name}</span>
              </button>
            ))}
          </div>
        </section>
      )}

      <section>
        <div className="cr-h">
          <h2>Start from an idea</h2>
          <span className="tip">Previews use your brand kit and images. Click one to load it, then make it in Claude.</span>
        </div>
        <div className="seg cr-cats" role="group" aria-label="Category">
          {CATEGORIES.map(([c, l]) => <button key={c} type="button" aria-pressed={cat === c} onClick={() => setCat(c)}>{l}</button>)}
        </div>
        <div className="cr-gallery">
          {shown.map((p) => {
            const m = MOCKS[p.id] || { size: [1200, 600] as [number, number], layout: 'hero' as const };
            const r = m.size[0] / m.size[1];
            const t = fillPrompt(p.prompt, fill);
            return (
              <article key={p.id} className={'cr-idea' + (picked === p.id ? ' on' : '')}>
                <button type="button" className="cr-stage" onClick={() => usePrompt(p.id)} aria-label={`Use: ${p.title}`}>
                  <div className="cr-fit" style={r >= 4 / 3 ? { width: '86%' } : { height: '86%', aspectRatio: `${r}` }}>
                    <Mock layout={m.layout} size={m.size} brand={brand} images={rotate(pool, p.id)} headline={m.headline} video={m.video} />
                  </div>
                  <span className="cr-hover"><span>{t}</span></span>
                </button>
                <div className="cr-info">
                  <div><b>{p.title}</b><small>{p.format}</small></div>
                  <div className="cr-uses">{p.uses.filter((u) => u !== 'copy').map((u) => <span key={u} className={'use ' + u} title={USE_LABEL[u]}>{USE_LABEL[u]}</span>)}</div>
                </div>
                <div className="cr-mini">
                  <button type="button" onClick={() => usePrompt(p.id)}>Use</button>
                  <button type="button" onClick={() => copy(t)}>Copy</button>
                  <button type="button" onClick={() => openInClaude(t)}>Open in Claude</button>
                </div>
              </article>
            );
          })}
        </div>
        <p className="tip cr-foot">AI image and video runs use your Figma Weave credits; Claude shows the cost and asks first. Everything Claude makes lands here as a draft.</p>
      </section>
    </div>
  );
}

// A different starting image per idea, so the gallery doesn't repeat one photo.
function rotate(pool: string[], seed: string) {
  if (!pool.length) return pool;
  let h = 0;
  for (const c of seed) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  const n = h % pool.length;
  return [...pool.slice(n), ...pool.slice(0, n)];
}
