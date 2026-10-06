// Assets that are no longer available: archived (retired by hand), expired (licence or usage
// rights ran out) or obsolete (superseded: an old logo, a dead format). They stay in the
// library, marked, so people can see what existed, why it went and what replaced it.
// Shared by server and browser.

// Any asset row (only lifecycle, licence_expires_at, lifecycle_reason and replaced_by are read).
type Row = Record<string, any> | null | undefined;

export type Lifecycle = 'active' | 'archived' | 'expired' | 'obsolete';

export const LIFECYCLE: Record<Exclude<Lifecycle, 'active'>, { label: string; badge: string; help: string }> = {
  archived: { label: 'Archived', badge: 'Archived', help: 'Retired. Still here for the record, but hidden from the library, Create and Claude.' },
  expired: { label: 'Licence expired', badge: 'Licence expired', help: 'The licence or usage rights have run out. It can’t be downloaded, shared or used in new work.' },
  obsolete: { label: 'Obsolete', badge: 'Obsolete', help: 'Superseded, e.g. an old logo or a format that’s no longer used. Point people to its replacement.' },
};

// What state an asset is really in: a licence date in the past means expired, even
// before the hourly job has flipped it.
export function lifecycleOf(a: Row): Lifecycle {
  if (!a) return 'active';
  const l = (a.lifecycle || 'active') as Lifecycle;
  if (l === 'active' && a.licence_expires_at && Date.parse(a.licence_expires_at) <= Date.now()) return 'expired';
  return l;
}

export const isAvailable = (a: Row) => lifecycleOf(a) === 'active';

// Expired files can't be downloaded or shared at all. Archived and obsolete ones can still be
// downloaded by the team (e.g. for an audit), but never go out through links, portals or Claude.
export const canDownload = (a: Row, member = true) => {
  const l = lifecycleOf(a);
  return l === 'active' || (member && l !== 'expired');
};

// Licence ending within this many days: flag it.
export function expiresSoon(a: Row, days = 30) {
  if (!a) return false;
  if (lifecycleOf(a) !== 'active' || !a.licence_expires_at) return false;
  return Date.parse(a.licence_expires_at) - Date.now() < days * 864e5;
}

// Fields to write when changing state (lifecycle_by is set by the caller).
export function lifecyclePatch(to: Lifecycle, reason?: string | null) {
  return to === 'active'
    ? { lifecycle: 'active', lifecycle_reason: null, lifecycle_at: null }
    : { lifecycle: to, lifecycle_reason: (reason || '').trim().slice(0, 300) || null, lifecycle_at: new Date().toISOString() };
}

// For Claude (MCP): the state, why, and what to use instead.
export function lifecycleForClaude(a: Row): Record<string, any> | null {
  if (!a) return null;
  const l = lifecycleOf(a);
  if (l === 'active') return a.licence_expires_at ? { availability: 'available', licence_expires_at: a.licence_expires_at } : null;
  return {
    availability: l,
    reason: a.lifecycle_reason || LIFECYCLE[l].label,
    ...(a.replaced_by ? { use_instead: a.replaced_by } : {}),
    warning: 'No longer available. Don’t use it in new work' + (a.replaced_by ? '; use the replacement (use_instead) instead.' : '.'),
  };
}
