'use client';
import type { MockLayout } from '@/lib/prompts';

// A small design sketch drawn with the workspace's brand kit and its own images,
// so the prompt library reads like a gallery of designs rather than a list of text.
// Everything is sized in cqw (container width) so it scales to any card.

export type Brand = {
  bg: string; surface: string; text: string; primary: string; accent: string;
  btnBg: string; btnText: string; radius: number;
  head: string; body: string; upper: boolean; logo?: string; name: string;
};

export default function Mock({ layout, size, brand, images, headline, video }: {
  layout: MockLayout; size: [number, number]; brand: Brand; images: string[]; headline?: string; video?: boolean;
}) {
  const b = brand;
  const img = (i: number) => images.length ? images[i % images.length] : undefined;
  const H = ({ children, s = 7, c = b.text }: { children: React.ReactNode; s?: number; c?: string }) => (
    <div className="mk-h" style={{ fontFamily: b.head, fontSize: `${s}cqw`, color: c, textTransform: b.upper ? 'uppercase' : 'none' }}>{children}</div>
  );
  const Btn = ({ s = 2.6, label = 'Shop now' }: { s?: number; label?: string }) => (
    <span className="mk-btn" style={{ background: b.btnBg, color: b.btnText, borderRadius: Math.min(b.radius, 40), fontSize: `${s}cqw` }}>{label}</span>
  );
  const Pic = ({ i, className = '', style }: { i: number; className?: string; style?: React.CSSProperties }) => (
    <div className={'mk-pic ' + className} style={{ backgroundColor: b.surface, backgroundImage: img(i) ? `url("${img(i)}")` : undefined, ...style }} />
  );
  const Logo = ({ h = 5, light = false }: { h?: number; light?: boolean }) => b.logo
    ? <img className="mk-logo" src={b.logo} alt="" style={{ height: `${h}cqw`, filter: light ? 'brightness(0) invert(1)' : undefined }} />
    : <span className="mk-word" style={{ fontFamily: b.head, fontSize: `${h * 0.8}cqw`, color: light ? '#fff' : b.text }}>{b.name}</span>;

  let body: React.ReactNode;
  switch (layout) {
    case 'hero':
      body = <>
        <Pic i={0} className="fill" />
        <div className="mk-shade" />
        <div className="mk-over" style={{ left: '6%', bottom: '10%', width: '60%' }}><H s={6.5} c="#fff">{headline}</H><Btn s={2.4} /></div>
      </>; break;
    case 'scene':
      body = <><Pic i={1} className="fill" />{headline && <div className="mk-over" style={{ left: '6%', top: '10%', width: '50%' }}><H s={6} c="#fff">{headline}</H></div>}<div className="mk-shade soft" /></>; break;
    case 'strip':
      body = <div className="mk-row" style={{ background: b.primary, padding: '0 5%' }}>
        <Logo h={size[1] / size[0] < 0.2 ? 5 : 7} light />
        <div style={{ flex: 1 }} />
        <H s={size[1] / size[0] < 0.2 ? 3.2 : 4.4} c="#fff">{headline}</H>
      </div>; break;
    case 'post':
      body = <div className="mk-col" style={{ background: b.bg }}>
        <Pic i={2} style={{ flex: 1 }} />
        <div style={{ padding: '6% 7%' }}><H s={8}>{headline}</H></div>
      </div>; break;
    case 'story':
      body = <>
        <Pic i={3} className="fill" />
        <div className="mk-shade" />
        <div className="mk-over" style={{ left: 0, right: 0, top: '6%', display: 'flex', justifyContent: 'center' }}><Logo h={7} light /></div>
        {headline ? <div className="mk-over" style={{ left: '8%', right: '8%', bottom: '12%', textAlign: 'center' }}><H s={11} c="#fff">{headline}</H><Btn s={5} /></div> : null}
      </>; break;
    case 'grid':
      body = <div className="mk-grid" style={{ background: b.bg }}>
        {[0, 1, 2, 3].map((i) => <div key={i} className="mk-cell"><Pic i={i} style={{ flex: 1, borderRadius: 3 }} /><div className="mk-line" style={{ background: b.text, width: '60%' }} /><div className="mk-line" style={{ background: b.primary, width: '30%' }} /></div>)}
      </div>; break;
    case 'email':
      body = <div className="mk-col" style={{ background: b.surface, alignItems: 'center', padding: '0 12%' }}>
        <div className="mk-col" style={{ background: b.bg, width: '100%', height: '100%' }}>
          <div style={{ padding: '4%', textAlign: 'center' }}><Logo h={4} /></div>
          <Pic i={0} style={{ height: '34%' }} />
          <div style={{ padding: '5% 7%', textAlign: 'center' }}><H s={5}>{headline}</H><div className="mk-line c" style={{ background: b.text, opacity: .25 }} /><div className="mk-line c" style={{ background: b.text, opacity: .25, width: '70%' }} /><Btn s={2.4} /></div>
          <div className="mk-row" style={{ gap: '4%', padding: '0 7%', flex: 1 }}><Pic i={1} style={{ flex: 1, height: '70%' }} /><Pic i={2} style={{ flex: 1, height: '70%' }} /></div>
        </div>
      </div>; break;
    case 'footer':
      body = <div className="mk-col" style={{ background: b.primary, alignItems: 'center', justifyContent: 'center', gap: '7%' }}>
        <Logo h={9} light />
        <div className="mk-row" style={{ gap: '3cqw', height: 'auto' }}>{[0, 1, 2, 3].map((i) => <span key={i} className="mk-dot" />)}</div>
        <div className="mk-line c" style={{ background: '#fff', opacity: .5, width: '50%' }} />
      </div>; break;
    case 'set':
      body = <div className="mk-row" style={{ background: b.surface, gap: '3%', padding: '6%', alignItems: 'flex-end' }}>
        {[[0.8, 1], [0.56, 1], [1.9, 1], [1.78, 1]].map(([r], i) => (
          <div key={i} className="mk-frame" style={{ aspectRatio: r, height: i === 1 ? '100%' : i === 0 ? '72%' : 'auto', width: i > 1 ? '28%' : undefined, background: b.bg }}>
            <Pic i={i} style={{ height: '70%' }} /><div style={{ padding: '6%' }}><div className="mk-line" style={{ background: b.primary, width: '70%', height: '1.2cqw' }} /></div>
          </div>
        ))}
      </div>; break;
    case 'carousel':
      body = <div className="mk-row" style={{ background: b.surface, padding: '8% 6%', gap: '3%' }}>
        {[0, 1, 2].map((i) => (
          <div key={i} className="mk-frame" style={{ flex: 1, height: '100%', background: i === 0 ? b.primary : b.bg }}>
            {i === 0 ? <div style={{ padding: '14% 10%' }}><H s={4.2} c="#fff">{headline}</H></div> : <><Pic i={i} style={{ height: '72%' }} /><div style={{ padding: '8%' }}><div className="mk-line" style={{ background: b.text, width: '60%', height: '1cqw' }} /></div></>}
          </div>
        ))}
      </div>; break;
    case 'ads':
      body = <div className="mk-row" style={{ background: b.surface, padding: '6%', gap: '4%', alignItems: 'flex-start' }}>
        <div className="mk-frame" style={{ width: '16%', height: '100%', background: b.bg }}><Pic i={0} style={{ height: '55%' }} /><div style={{ padding: '10%' }}><Btn s={1.6} label="Shop" /></div></div>
        <div className="mk-col" style={{ flex: 1, gap: '8%', height: '100%' }}>
          <div className="mk-frame mk-row" style={{ height: '18%', background: b.primary, padding: '0 4%' }}><Logo h={3} light /><div style={{ flex: 1 }} /><Btn s={1.5} label="Shop" /></div>
          <div className="mk-frame" style={{ width: '55%', aspectRatio: '300/250', background: b.bg }}><Pic i={1} style={{ height: '62%' }} /><div style={{ padding: '5%' }}><H s={2.6}>{headline}</H></div></div>
        </div>
      </div>; break;
    case 'cutout':
      body = <div className="mk-check"><Pic i={0} className="fill contain" style={{ backgroundColor: 'transparent', margin: '12%' }} /></div>; break;
    case 'kit':
      body = <div className="mk-row" style={{ background: b.bg, padding: '8%', gap: '6%' }}>
        <div className="mk-col" style={{ gap: '6%', width: '40%' }}>
          <Logo h={6} />
          <div className="mk-row" style={{ gap: '3%', height: '22%' }}>{[b.primary, b.accent, b.text, b.surface].map((c, i) => <span key={i} className="mk-sw" style={{ background: c }} />)}</div>
          <div className="mk-row" style={{ height: 'auto', gap: '6%' }}><Btn s={2.2} /></div>
        </div>
        <div className="mk-col" style={{ flex: 1, justifyContent: 'center' }}><div style={{ fontFamily: b.head, fontSize: '16cqw', lineHeight: 1, color: b.text }}>Aa</div><div style={{ fontFamily: b.body, fontSize: '2.4cqw', color: b.text, opacity: .7 }}>{b.head.split(',')[0].replace(/'/g, '')}</div></div>
      </div>; break;
    case 'check':
      body = <div className="mk-row" style={{ background: b.surface, padding: '8%', gap: '4%' }}>
        {[0, 1, 2].map((i) => (
          <div key={i} className="mk-frame" style={{ flex: 1, height: '100%', background: b.bg, position: 'relative' }}>
            <Pic i={i} style={{ height: '100%' }} />
            <span className={'mk-badge ' + (i === 1 ? 'no' : 'ok')}>{i === 1 ? '!' : '✓'}</span>
          </div>
        ))}
      </div>; break;
    case 'slide':
      body = <div className="mk-row" style={{ background: b.bg }}>
        <div className="mk-col" style={{ width: '48%', padding: '6%', justifyContent: 'space-between' }}><Logo h={3.4} /><H s={5.4}>{headline}</H><div className="mk-line" style={{ background: b.primary, width: '30%', height: '.8cqw' }} /></div>
        <Pic i={1} style={{ flex: 1, height: '100%' }} />
      </div>; break;
    case 'thumb':
      body = <><Pic i={2} className="fill" /><div className="mk-over" style={{ left: '5%', bottom: '8%', width: '58%' }}><span className="mk-tag" style={{ background: b.accent || b.primary, fontFamily: b.head, fontSize: '7.5cqw', textTransform: b.upper ? 'uppercase' : 'none' }}>{headline}</span></div></>; break;
  }

  return (
    <div className="mk" style={{ aspectRatio: `${size[0]} / ${size[1]}`, background: b.bg, fontFamily: b.body }}>
      {body}
      {video && <span className="mk-play" aria-hidden="true" />}
    </div>
  );
}
