'use client';
import { useEffect, useState } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import { Icon } from './icons';
import type { Asset } from './Library';

// The first-run checklist on Assets: four steps from an empty workspace to a shared brand portal.
// Hides itself once everything is done, or when dismissed (remembered per brand in this browser).
export default function GettingStarted({ supabase, ws, items, kitStatus, onBrandKit, onImport, onUpload, onCreate, onSharing }: {
  supabase: SupabaseClient; ws: string; items: Asset[]; kitStatus: string | null;
  onBrandKit: () => void; onImport: () => void; onUpload: () => void; onCreate: () => void; onSharing: () => void;
}) {
  const key = `mise.start.hidden.${ws}`;
  const [hidden, setHidden] = useState(true);
  const [portals, setPortals] = useState<number | null>(null);
  useEffect(() => { try { setHidden(localStorage.getItem(key) === '1'); } catch { setHidden(false); } }, [key]);
  useEffect(() => {
    supabase.from('portals').select('id', { count: 'exact', head: true }).eq('workspace_id', ws).then(({ count }) => setPortals(count || 0));
  }, [supabase, ws]);

  const own = items.filter((a) => a.kind !== 'block' && a.provenance?.via !== 'brand_kit' && a.provenance?.via !== 'studio' && a.origin !== 'generated');
  const made = items.some((a) => a.provenance?.via === 'studio' || a.origin === 'generated');
  const steps = [
    { done: kitStatus === 'approved', title: kitStatus ? 'Approve your brand kit' : 'Build your brand kit', note: kitStatus ? 'Check the draft, then approve it for the team.' : 'Paste your website: colours, fonts and logo in about 20 seconds.', cta: kitStatus ? 'Review kit' : 'Build it', go: onBrandKit },
    { done: own.length > 0, title: 'Bring in your files', note: 'Drop a folder, or import from Google Drive or Dropbox. Mise tags and sorts everything.', cta: 'Add files', go: onUpload, alt: { label: 'From Drive or Dropbox', go: onImport } },
    { done: made, title: 'Make your first design', note: 'A social post or banner from your own photos, on brand, in seconds.', cta: 'Open Create', go: onCreate },
    { done: (portals || 0) > 0, title: 'Share your brand portal', note: 'One link for agencies and retailers, styled from your kit.', cta: 'Create portal', go: onSharing },
  ];
  const left = steps.filter((s) => !s.done).length;
  if (hidden || portals === null || left === 0) return null;
  const next = steps.findIndex((s) => !s.done);

  return (
    <section className="start" aria-label="Getting started">
      <div className="start-h">
        <div><b>Get set up</b><span>{4 - left} of 4 done</span></div>
        <button type="button" className="linkish" onClick={() => { setHidden(true); try { localStorage.setItem(key, '1'); } catch {} }}>Hide</button>
      </div>
      <ol className="start-steps">
        {steps.map((s, i) => (
          <li key={s.title} className={s.done ? 'done' : i === next ? 'next' : ''}>
            <span className="start-n" aria-hidden>{s.done ? <Icon.Check size={13} /> : i + 1}</span>
            <div className="start-t"><b>{s.title}</b>{!s.done && <small>{s.note}</small>}</div>
            {!s.done && (
              <div className="start-a">
                {s.alt && i === next && <button type="button" className="btn quiet" onClick={s.alt.go}>{s.alt.label}</button>}
                <button type="button" className={i === next ? 'primary' : 'btn'} onClick={s.go}>{s.cta}</button>
              </div>
            )}
          </li>
        ))}
      </ol>
    </section>
  );
}
