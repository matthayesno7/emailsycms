import type { Metadata } from 'next';
import PublicFrame from '@/components/public/PublicFrame';
import Gallery, { Gate } from '@/components/public/Gallery';
import Guidelines from '@/components/public/Guidelines';
import { brandOf, loadPortal, logEvent, portalAccess, portalContents, publicView, thumbUrls, visitor } from '@/lib/share';

export const dynamic = 'force-dynamic';

export async function generateMetadata({ params }: { params: Promise<{ ws: string; portal: string }> }): Promise<Metadata> {
  const { ws, portal } = await params;
  const r = await loadPortal(ws, portal);
  return { title: r ? `${r.portal.name} · ${r.ws.name}` : 'Portal', robots: { index: false, follow: false } };
}

// A brand portal: /p/<brand>/<portal>, with ?tab=guidelines for the guidelines page.
export default async function PortalPage({ params, searchParams }: { params: Promise<{ ws: string; portal: string }>; searchParams: Promise<{ tab?: string }> }) {
  const { ws: wsSlug, portal: portalSlug } = await params;
  const { tab } = await searchParams;
  const r = await loadPortal(wsSlug, portalSlug);
  if (!r) return <PublicFrame kit={null} brandName="Mise"><div className="pub-gate"><h1>This portal isn’t available</h1><p>Check the address, or ask the brand for a new link.</p></div></PublicFrame>;
  const { db, ws, portal } = r;
  const brand = await brandOf(db, ws);
  const v = await visitor(db, ws.id);
  const access = await portalAccess(portal, v.email, v.member);
  const base = `/p/${ws.slug}/${portal.slug}`;
  const guidelines = portal.show_guidelines && !!brand.kit;
  const onGuide = guidelines && tab === 'guidelines';
  const kitLogos = brand.kit?.logos || { primary: null, reversed: null, icon: null };
  const logoIds = [kitLogos.primary, kitLogos.reversed, kitLogos.icon].filter(Boolean) as string[];
  const { data: logoRows } = logoIds.length ? await db.from('assets').select('id, name, storage_path, images, kind').in('id', logoIds).eq('workspace_id', ws.id) : { data: [] as any[] };
  const logoThumbs = await thumbUrls(db, (logoRows || []).filter((l: any) => l.storage_path));
  const frame = (children: React.ReactNode) => (
    <PublicFrame kit={brand.kit} brandName={brand.name} logoUrl={kitLogos.primary ? logoThumbs[kitLogos.primary] : null}
      nav={access === 'ok' && guidelines ? [{ href: base, label: 'Assets', on: !onGuide }, { href: `${base}?tab=guidelines`, label: 'Brand guidelines', on: onGuide }] : undefined}
      preview={v.member ? `Preview for your team${portal.published ? '' : ' · unpublished'}${portal.access !== 'public' ? ` · visitors need ${portal.access === 'passcode' ? 'the passcode' : 'to be on the invite list'}` : ''}. Your team’s visits aren’t counted.` : null}>
      {children}
    </PublicFrame>
  );

  if (access === 'unpublished') return frame(<div className="pub-gate"><h1>This portal isn’t published yet</h1><p>Check back soon.</p></div>);
  if (access === 'passcode') return frame(<Gate shareRef={{ p: portal.id }} mode="passcode" brandName={brand.name} />);
  if (access === 'signin') return frame(<Gate shareRef={{ p: portal.id }} mode="signin" brandName={brand.name} />);
  if (access === 'denied') return frame(<div className="pub-gate"><h1>You don’t have access</h1><p>{v.email} isn’t on the invite list for this portal. Ask {brand.name} to add you.</p></div>);

  if (!v.member) await logEvent(db, { workspace_id: ws.id, portal_id: portal.id, event: 'view', email: portal.access === 'allowlist' ? v.email : null }).catch(() => {});
  const fileHref = (id: string, f: string) => `/api/public/file?p=${portal.id}&a=${id}&f=${f}&dl=1`;

  if (onGuide) {
    const LABEL: Record<string, string> = { primary: 'Primary logo', reversed: 'Reversed logo', icon: 'Icon' };
    const logos = (['primary', 'reversed', 'icon'] as const).map((k) => {
      const row = (logoRows || []).find((l: any) => l.id === kitLogos[k]);
      return row && logoThumbs[row.id] ? { id: row.id, label: LABEL[k], name: row.name, thumb: logoThumbs[row.id] } : null;
    }).filter(Boolean) as { id: string; label: string; name: string; thumb: string }[];
    return frame(<Guidelines kit={brand.kit!} brandName={brand.name} logos={logos} fileHref={fileHref} canDownload={portal.allow_download} />);
  }

  const { assets, sections } = await portalContents(db, portal);
  const thumbs = await thumbUrls(db, assets);
  return frame(
    <>
      <section className="pub-hero">
        <h1>{portal.name}</h1>
        {portal.intro ? <p>{portal.intro}</p> : <p>Approved {brand.name} logos, images and product shots, ready to download.{guidelines ? ' See the brand guidelines for how to use them.' : ''}</p>}
      </section>
      <Gallery assets={assets.map((a) => ({ ...publicView(a, thumbs[a.id]), tags: a.tags || [] }))} sections={sections} shareRef={{ p: portal.id }} allowDownload={portal.allow_download} formats={portal.formats} />
    </>,
  );
}
