import type { Metadata } from 'next';
import PublicFrame from '@/components/public/PublicFrame';
import Gallery, { Gate } from '@/components/public/Gallery';
import { brandOf, isUnlocked, loadShare, logEvent, publicView, shareAssets, shareState, thumbUrls, visitor } from '@/lib/share';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Shared files', robots: { index: false, follow: false } };

// A share link: /s/<token>. One or more files, a folder or a smart collection, styled with the brand kit.
export default async function SharePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const r = await loadShare(token);
  if (!r) return <Gone />;
  const { db, share } = r;
  const { data: ws } = await db.from('workspaces').select('id, name, slug').eq('id', share.workspace_id).maybeSingle();
  if (!ws) return <Gone />;
  const brand = await brandOf(db, ws);
  const v = await visitor(db, ws.id);
  const state = shareState(share);
  const logo = await logoUrl(db, brand.kit?.logos?.primary);
  const frame = (children: React.ReactNode, preview?: string | null) => <PublicFrame kit={brand.kit} brandName={brand.name} logoUrl={logo} preview={preview}>{children}</PublicFrame>;

  if (state !== 'live' && !v.member) return frame(<div className="pub-gate"><h1>{state === 'expired' ? 'This link has expired' : 'This link has been turned off'}</h1><p>Ask the person who shared it for a new one.</p></div>);
  if (!v.member && !(await isUnlocked('s', share.id, share.passcode_hash))) return frame(<Gate shareRef={{ s: token }} mode="passcode" brandName={brand.name} />);

  const assets = await shareAssets(db, share);
  const thumbs = await thumbUrls(db, assets);
  if (!v.member) await logEvent(db, { workspace_id: ws.id, share_id: share.id, event: 'view' }).catch(() => {});
  const expires = share.expires_at ? new Date(share.expires_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }) : null;
  return frame(
    <>
      <section className="pub-hero">
        <h1>{share.title}</h1>
        {share.message && <p>{share.message}</p>}
        <p className="pub-meta">{assets.length} file{assets.length === 1 ? '' : 's'} from {brand.name}{expires ? ` · available until ${expires}` : ''}</p>
        {assets.gone > 0 && <p className="pub-meta">{assets.gone} file{assets.gone === 1 ? ' in this link is' : 's in this link are'} no longer available. Ask {brand.name} for {assets.gone === 1 ? 'its replacement' : 'their replacements'}.</p>}
      </section>
      <Gallery assets={assets.map((a) => ({ ...publicView(a, thumbs[a.id]), tags: a.tags || [] }))} shareRef={{ s: token }} allowDownload={share.allow_download} formats={share.formats} searchable={assets.length > 6} />
    </>,
    v.member ? `Preview for your team${state !== 'live' ? ` · this link is ${state}` : ''}. Visits and downloads by your team aren’t counted.` : null,
  );
}

async function logoUrl(db: any, id?: string | null) {
  if (!id) return null;
  const { data } = await db.from('assets').select('storage_path').eq('id', id).maybeSingle();
  if (!data?.storage_path) return null;
  return (await db.storage.from('assets').createSignedUrl(data.storage_path, 3600)).data?.signedUrl || null;
}

function Gone() {
  return <PublicFrame kit={null} brandName="Mise"><div className="pub-gate"><h1>This link isn’t available</h1><p>It may have been mistyped, turned off or removed. Ask the person who shared it for a new one.</p></div></PublicFrame>;
}
