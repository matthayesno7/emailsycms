import { redirect } from 'next/navigation';
import PublicFrame from '@/components/public/PublicFrame';
import { brandOf } from '@/lib/share';
import { createAdminClient } from '@/lib/supabase/admin';

export const dynamic = 'force-dynamic';
export const metadata = { robots: { index: false, follow: false } };

// /p/<brand>: straight to the portal when there's one; otherwise a list of the brand's portals.
export default async function BrandPortals({ params }: { params: Promise<{ ws: string }> }) {
  const { ws: slug } = await params;
  const db = createAdminClient();
  const { data: ws } = await db.from('workspaces').select('id, name, slug').eq('slug', slug.toLowerCase()).maybeSingle();
  const { data: portals } = ws ? await db.from('portals').select('slug, name, intro, access').eq('workspace_id', ws.id).eq('published', true).order('created_at') : { data: [] as any[] };
  if (!ws || !portals?.length) return <PublicFrame kit={null} brandName="Mise"><div className="pub-gate"><h1>Nothing here</h1><p>Check the address, or ask the brand for a link.</p></div></PublicFrame>;
  if (portals.length === 1) redirect(`/p/${ws.slug}/${portals[0].slug}`);
  const brand = await brandOf(db, ws);
  return (
    <PublicFrame kit={brand.kit} brandName={brand.name}>
      <section className="pub-hero"><h1>{brand.name}</h1><p>Choose a portal.</p></section>
      <div className="pub-portals">
        {portals.map((p: any) => (
          <a key={p.slug} href={`/p/${ws.slug}/${p.slug}`} className="pub-portal-card">
            <b>{p.name}</b>
            {p.intro && <span>{p.intro}</span>}
            {p.access !== 'public' && <em>{p.access === 'passcode' ? 'Passcode' : 'Invite only'}</em>}
          </a>
        ))}
      </div>
    </PublicFrame>
  );
}
