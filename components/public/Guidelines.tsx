// The brand guidelines page in a portal, generated from the brand kit: logos to download,
// colours to copy, fonts, buttons, imagery do's and don'ts, and tone of voice.
import { COLOR_LABEL, COLOR_ROLES, type BrandKit } from '@/lib/brandKit';
import { CopyChip } from './Gallery';
import { contrast } from './brandStyle';

export default function Guidelines({ kit, brandName, logos, fileHref, canDownload = true }: {
  kit: BrandKit;
  brandName: string;
  logos: { id: string; label: string; thumb: string; name: string }[];
  fileHref: (assetId: string, format: string) => string;
  canDownload?: boolean;
}) {
  // Brand colours and neutrals; utility roles (border, button text, link) are left out.
  const colours = COLOR_ROLES.filter((r) => kit.colors?.[r] && !['border', 'button_text', 'button_bg', 'link'].includes(r)).map((r) => ({ role: r, label: COLOR_LABEL[r], hex: kit.colors[r] as string }));
  // Show each colour once, under its most important role.
  const seen = new Set<string>();
  const unique = colours.filter((c) => (seen.has(c.hex.toLowerCase()) ? false : (seen.add(c.hex.toLowerCase()), true)));
  const h = kit.type?.heading, b = kit.type?.body;
  const im = kit.imagery || ({} as BrandKit['imagery']);
  const btn = kit.button;
  const sample = kit.voice?.samples?.[0] || `${brandName}, made with care.`;

  return (
    <div className="pub-guide">
      <section className="pub-hero">
        <h1>{brandName} brand guidelines</h1>
        <p>Everything you need to use the {brandName} brand correctly: logos, colours, type and imagery.</p>
      </section>

      {logos.length > 0 && (
        <section>
          <h2>Logos</h2>
          <div className="pub-logos">
            {logos.map((l) => (
              <div key={l.id} className={'pub-logo ' + (/revers|white|dark/i.test(l.label + l.name) ? 'dark' : '')}>
                <div className="pub-logo-art"><img src={l.thumb} alt={`${brandName} ${l.label}`} /></div>
                <div className="pub-logo-meta"><b>{l.label}</b>
                  {canDownload && <span><a href={fileHref(l.id, 'original')}>Download</a></span>}
                </div>
              </div>
            ))}
          </div>
          <p className="pub-note">Leave clear space around the logo and don’t stretch, recolour or add effects to it.</p>
        </section>
      )}

      {unique.length > 0 && (
        <section>
          <h2>Colours</h2>
          <div className="pub-colours">
            {unique.map((c) => (
              <div key={c.role} className="pub-colour">
                <div className="pub-swatch" style={{ background: c.hex, color: contrast('#ffffff', c.hex) > contrast('#141414', c.hex) ? '#fff' : '#141414' }}>{c.label}</div>
                <div className="pub-colour-meta"><CopyChip value={c.hex.toUpperCase()} /><span>{rgb(c.hex)}</span></div>
              </div>
            ))}
          </div>
        </section>
      )}

      {(h?.family || b?.family) && (
        <section>
          <h2>Typography</h2>
          <div className="pub-type">
            {h?.family && <div><span className="pub-k">Headings</span><p className="pub-type-h" style={{ fontFamily: `'${h.family}', ${h.fallback}`, fontWeight: h.weight }}>{h.family}</p><span className="pub-v">Weight {h.weight}{kit.type.heading_case === 'upper' ? ' · uppercase' : ''} · fallback {h.fallback.split(',')[0]}</span></div>}
            {b?.family && <div><span className="pub-k">Body</span><p className="pub-type-b" style={{ fontFamily: `'${b.family}', ${b.fallback}`, fontWeight: b.weight }}>{sample}</p><span className="pub-v">{b.family} · weight {b.weight} · {kit.type.sizes?.body || 16}px</span></div>}
          </div>
        </section>
      )}

      {btn && (
        <section>
          <h2>Buttons</h2>
          <div className="pub-btnrow">
            <span className="pub-sample-btn" style={{
              background: btn.style === 'filled' ? (kit.colors.button_bg || kit.colors.primary || '#141414') : 'transparent',
              color: btn.style === 'filled' ? (kit.colors.button_text || '#fff') : (kit.colors.button_bg || kit.colors.primary || '#141414'),
              border: btn.style === 'outline' ? `2px solid ${kit.colors.button_bg || kit.colors.primary || '#141414'}` : 'none',
              textDecoration: btn.style === 'underline' ? 'underline' : 'none',
              borderRadius: btn.radius, padding: `${btn.padding_y}px ${btn.padding_x}px`, fontWeight: btn.weight,
              textTransform: btn.case === 'upper' ? 'uppercase' : 'none',
            }}>Shop now</span>
            <span className="pub-v">{btn.style}, {btn.radius}px corners</span>
          </div>
        </section>
      )}

      {(im.style || im.do?.length || im.dont?.length) && (
        <section>
          <h2>Imagery</h2>
          {im.style && <p className="pub-lede">{im.style}</p>}
          <div className="pub-dodont">
            {!!im.do?.length && <div className="do"><h3>Do</h3><ul>{im.do.map((x) => <li key={x}>{x}</li>)}</ul></div>}
            {!!im.dont?.length && <div className="dont"><h3>Don’t</h3><ul>{im.dont.map((x) => <li key={x}>{x}</li>)}</ul></div>}
          </div>
        </section>
      )}

      {(kit.voice?.tone?.length || kit.voice?.samples?.length) ? (
        <section>
          <h2>Tone of voice</h2>
          {!!kit.voice.tone.length && <div className="pub-tones">{kit.voice.tone.map((t) => <span key={t}>{t}</span>)}</div>}
          {kit.voice.samples.slice(0, 3).map((s) => <blockquote key={s}>{s}</blockquote>)}
        </section>
      ) : null}
    </div>
  );
}

function rgb(hex: string) {
  const n = parseInt(hex.replace('#', ''), 16);
  return Number.isFinite(n) ? `RGB ${(n >> 16) & 255} ${(n >> 8) & 255} ${n & 255}` : '';
}
