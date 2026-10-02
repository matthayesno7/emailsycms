'use client';
import { useEffect, useState } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Asset } from './Library';

type V = { id: string; version: number; storage_path: string | null; images: any; width: number | null; height: number | null; note: string | null; created_at: string };
const when = (d?: string | null) => (d ? new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) + ', ' + new Date(d).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) : '');

// Version history on the asset page. Every edit is a version; nothing is ever overwritten,
// and going back to an old version keeps the current one too.
export default function AssetVersions({ it, supabase, onRevert, toast }: { it: Asset; supabase: SupabaseClient; onRevert: (version: number) => Promise<boolean>; toast: (m: string) => void }) {
  const [list, setList] = useState<V[] | null>(null);
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<number | null>(null);

  useEffect(() => {
    if ((it.version || 1) <= 1) { setList([]); return; }
    let alive = true;
    supabase.from('asset_versions').select('id, version, storage_path, images, width, height, note, created_at').eq('asset_id', it.id).order('version', { ascending: false }).then(async ({ data }) => {
      if (!alive) return;
      const rows = (data as V[]) || [];
      setList(rows);
      const paths = rows.map((r) => r.images?.email?.path || r.storage_path).filter(Boolean) as string[];
      if (paths.length) {
        const { data: signed } = await supabase.storage.from('assets').createSignedUrls(paths, 3600);
        if (alive) setUrls(Object.fromEntries((signed || []).filter((s) => s.path && s.signedUrl).map((s) => [s.path!, s.signedUrl as string])));
      }
    });
    return () => { alive = false; };
  }, [it.id, it.version, supabase]);

  if (!list || !list.length) return null;
  const shown = open ? list : list.slice(0, 2);
  return (
    <div className="ed-sec versions">
      <div className="label">Versions <span className="opt">{list.length + 1}</span></div>
      <div className="vlist">
        <div className="vrow current">
          <span className="vthumb cur">v{it.version}</span>
          <span className="vmeta"><b>Version {it.version} · current</b><small>{it.version_note || 'Edited'}{it.version_at ? ` · ${when(it.version_at)}` : ''}</small></span>
        </div>
        {shown.map((v) => {
          const u = urls[v.images?.email?.path || v.storage_path || ''];
          return (
            <div key={v.id} className="vrow">
              <span className="vthumb">{u ? <img src={u} alt="" /> : `v${v.version}`}</span>
              <span className="vmeta"><b>Version {v.version}</b><small>{v.note || (v.version === 1 ? 'Original' : 'Edited')}{v.width ? ` · ${v.width}×${v.height}` : ''} · {when(v.created_at)}</small></span>
              <button type="button" className="btn quiet" disabled={busy !== null} onClick={async () => { setBusy(v.version); const ok = await onRevert(v.version); setBusy(null); if (ok) toast(`Back to version ${v.version}. The version you replaced is kept.`); }}>{busy === v.version ? '…' : 'Restore'}</button>
            </div>
          );
        })}
      </div>
      {list.length > 2 && <button type="button" className="linkish" onClick={() => setOpen((o) => !o)}>{open ? 'Show fewer' : `Show all ${list.length + 1} versions`}</button>}
    </div>
  );
}
