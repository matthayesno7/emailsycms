'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Ws } from './Library';
import { roleLabel } from '@/lib/roles';

type Entry = { id: number; at: string; actor_email: string | null; via: string; action: string; target_type: string | null; target_id: string | null; target_name: string | null; details: Record<string, any> };

// What each action reads as. Grouped for the filter.
const ACTIONS: Record<string, { label: string; group: string }> = {
  'asset.added': { label: 'Added', group: 'Files' },
  'asset.approved': { label: 'Approved', group: 'Files' },
  'asset.unapproved': { label: 'Moved back to review', group: 'Files' },
  'asset.renamed': { label: 'Renamed', group: 'Files' },
  'asset.edited': { label: 'Edited', group: 'Files' },
  'asset.availability': { label: 'Changed availability of', group: 'Files' },
  'asset.deleted': { label: 'Deleted', group: 'Files' },
  'member.invited': { label: 'Invited', group: 'People' },
  'member.joined': { label: 'Joined', group: 'People' },
  'member.removed': { label: 'Removed', group: 'People' },
  'member.role_changed': { label: 'Changed the role of', group: 'People' },
  'share.created': { label: 'Created a share link', group: 'Sharing' },
  'share.turned_off': { label: 'Turned off a share link', group: 'Sharing' },
  'share.deleted': { label: 'Deleted a share link', group: 'Sharing' },
  'portal.created': { label: 'Created a portal', group: 'Sharing' },
  'portal.published': { label: 'Published a portal', group: 'Sharing' },
  'portal.unpublished': { label: 'Unpublished a portal', group: 'Sharing' },
  'portal.access_changed': { label: 'Changed portal access', group: 'Sharing' },
  'portal.deleted': { label: 'Deleted a portal', group: 'Sharing' },
  'brand_kit.saved': { label: 'Saved the brand kit', group: 'Brand' },
  'brand_kit.approved': { label: 'Approved the brand kit', group: 'Brand' },
  'feed.synced': { label: 'Synced products from', group: 'Brand' },
  'billing.plan_changed': { label: 'Changed plan to', group: 'Brand' },
};
const GROUPS = ['All', 'Files', 'People', 'Sharing', 'Brand'];

function detail(e: Entry) {
  const d = e.details || {};
  switch (e.action) {
    case 'asset.renamed': return d.from ? `was “${d.from}”` : '';
    case 'asset.availability': return [d.to, d.reason].filter(Boolean).join(' · ');
    case 'asset.added': return [e.target_type, d.status === 'draft' ? 'draft' : ''].filter(Boolean).join(' · ');
    case 'member.role_changed': return `${roleLabel(d.from)} → ${roleLabel(d.to)}`;
    case 'member.invited': case 'member.joined': return roleLabel(d.role);
    case 'feed.synced': return `${d.products ?? 0} products${d.added ? ` · ${d.added} new` : ''}${d.removed ? ` · ${d.removed} gone` : ''}`;
    case 'share.created': return d.expires_at ? `expires ${new Date(d.expires_at).toLocaleDateString('en-GB')}` : '';
    case 'portal.access_changed': return `${d.from} → ${d.to}`;
    default: return '';
  }
}
const who = (e: Entry) => e.actor_email || (e.via === 'mise' ? 'Mise (Claude connector or automation)' : 'Someone');
const when = (iso: string) => new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
const csvCell = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;

// Settings → Activity: who did what in this brand. Admins and owners only (row level security).
export default function Activity({ supabase, ws }: { supabase: SupabaseClient; ws: Ws }) {
  const [rows, setRows] = useState<Entry[]>([]);
  const [group, setGroup] = useState('All');
  const [person, setPerson] = useState('');
  const [more, setMore] = useState(true);
  const [loading, setLoading] = useState(false);

  const fetchPage = useCallback(async (before?: number) => {
    setLoading(true);
    let q = supabase.from('audit_log').select('id, at, actor_email, via, action, target_type, target_id, target_name, details').eq('workspace_id', ws.id).order('id', { ascending: false }).limit(200);
    if (before) q = q.lt('id', before);
    const { data } = await q;
    setLoading(false);
    setMore((data || []).length === 200);
    return (data || []) as Entry[];
  }, [supabase, ws.id]);
  useEffect(() => { fetchPage().then(setRows); }, [fetchPage]);

  const people = useMemo(() => [...new Set(rows.map(who))].sort(), [rows]);
  const shown = rows.filter((e) => (group === 'All' || ACTIONS[e.action]?.group === group) && (!person || who(e) === person));

  function download() {
    const head = ['When (UTC)', 'Who', 'Via', 'Action', 'What', 'Name', 'Details'];
    const lines = shown.map((e) => [e.at, who(e), e.via, e.action, e.target_type, e.target_name, JSON.stringify(e.details || {})].map(csvCell).join(','));
    const blob = new Blob([[head.map(csvCell).join(','), ...lines].join('\n')], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${ws.name.replace(/[^\w-]+/g, '-')}-activity.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  return (
    <div className="settings activity">
      <h2>Activity</h2>
      <p className="tip">Who added, approved, changed, deleted and shared what in {ws.name}, and changes to people, the brand kit and the plan. Entries can’t be edited or removed.</p>
      <div className="act-bar">
        <div className="seg" role="group" aria-label="Show">{GROUPS.map((g) => <button key={g} type="button" aria-pressed={group === g} onClick={() => setGroup(g)}>{g}</button>)}</div>
        <select className="in act-person" value={person} onChange={(e) => setPerson(e.target.value)} aria-label="Person">
          <option value="">Everyone</option>
          {people.map((p) => <option key={p} value={p}>{p}</option>)}
        </select>
        <span className="spacer" />
        <button className="btn" type="button" disabled={!shown.length} onClick={download}>Download CSV</button>
      </div>
      {!rows.length && !loading ? <p className="tip">Nothing yet. Activity is recorded from now on.</p> : (
        <div className="act-list">
          {shown.map((e) => (
            <div key={e.id} className="act-row">
              <span className="act-when">{when(e.at)}</span>
              <span className="act-what"><b>{who(e)}</b> {(ACTIONS[e.action]?.label || e.action).toLowerCase()} {e.target_name && <q>{e.target_name}</q>} {detail(e) && <span className="muted">· {detail(e)}</span>}</span>
            </div>
          ))}
        </div>
      )}
      {more && rows.length > 0 && (
        <div className="actions left"><button className="btn quiet" type="button" disabled={loading} onClick={async () => { const next = await fetchPage(rows[rows.length - 1].id); setRows((r) => [...r, ...next]); }}>{loading ? 'Loading…' : 'Show older'}</button></div>
      )}
    </div>
  );
}
