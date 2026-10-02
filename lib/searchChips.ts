// Search filters shown as removable chips in the library. Browser-safe (no server imports).

export type SearchFilters = {
  kinds?: string[];
  colours?: string[];
  orientation?: 'landscape' | 'portrait' | 'square';
  folder?: string;
  folder_name?: string;
  on_brand?: boolean;
  origin?: 'uploaded' | 'product_feed' | 'generated';
  status?: 'draft' | 'approved';
};

const KIND: Record<string, string> = { image: 'Images', logo: 'Logos', product: 'Products', video: 'Videos' };
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export function chipsOf(f: SearchFilters): { id: string; label: string }[] {
  const out: { id: string; label: string }[] = [];
  for (const k of f.kinds || []) out.push({ id: `kind:${k}`, label: KIND[k] || cap(k) });
  for (const c of f.colours || []) out.push({ id: `colour:${c}`, label: cap(c) });
  if (f.orientation) out.push({ id: 'orientation', label: cap(f.orientation) });
  if (f.folder) out.push({ id: 'folder', label: `In ${f.folder_name || 'folder'}` });
  if (typeof f.on_brand === 'boolean') out.push({ id: 'on_brand', label: f.on_brand ? 'On-brand' : 'Off-brand' });
  if (f.origin) out.push({ id: 'origin', label: f.origin === 'generated' ? 'Made with AI' : f.origin === 'product_feed' ? 'From the feed' : 'Uploaded' });
  if (f.status) out.push({ id: 'status', label: f.status === 'draft' ? 'Drafts' : 'Approved' });
  return out;
}

export function removeChip(f: SearchFilters, id: string): SearchFilters {
  const n: SearchFilters = { ...f };
  if (id.startsWith('kind:')) n.kinds = (n.kinds || []).filter((k) => `kind:${k}` !== id);
  else if (id.startsWith('colour:')) n.colours = (n.colours || []).filter((c) => `colour:${c}` !== id);
  else if (id === 'folder') { delete n.folder; delete n.folder_name; }
  else delete (n as any)[id];
  if (n.kinds && !n.kinds.length) delete n.kinds;
  if (n.colours && !n.colours.length) delete n.colours;
  return n;
}

export const searchKey = (text: string, f: SearchFilters) => JSON.stringify([text.trim().toLowerCase(), f.kinds || [], f.colours || [], f.orientation || '', f.folder || '', f.on_brand ?? '', f.origin || '', f.status || '']);
