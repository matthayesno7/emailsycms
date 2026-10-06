// Roles in a brand. Safe for the browser. The database enforces the same rules (roles_and_audit migration);
// the server and the Claude connector check them too, because they write with the service role.
export type Role = 'owner' | 'admin' | 'editor' | 'contributor' | 'viewer';

export const ROLES: { id: Role; label: string; blurb: string }[] = [
  { id: 'owner', label: 'Owner', blurb: 'Everything, including billing and deleting the brand' },
  { id: 'admin', label: 'Admin', blurb: 'Everything except billing; manages people and settings' },
  { id: 'editor', label: 'Editor', blurb: 'Adds, edits, approves, shares and deletes; edits the brand kit' },
  { id: 'contributor', label: 'Contributor', blurb: 'Adds files and makes things; they wait in Review for an editor' },
  { id: 'viewer', label: 'Viewer', blurb: 'Browses, searches and downloads' },
];
export const roleLabel = (r?: string | null) => ROLES.find((x) => x.id === r)?.label || 'Member';
export const isRole = (r: unknown): r is Role => ROLES.some((x) => x.id === r);

const at = (r: string | null | undefined, ok: Role[]) => !!r && (ok as string[]).includes(r);
export const can = {
  add: (r?: string | null) => at(r, ['owner', 'admin', 'editor', 'contributor']),      // upload, import, make
  manage: (r?: string | null) => at(r, ['owner', 'admin', 'editor']),                  // approve, edit anyone's, share, brand kit, delete
  admin: (r?: string | null) => at(r, ['owner', 'admin']),                             // people, settings, activity
  owner: (r?: string | null) => r === 'owner',                                          // billing, delete the brand
};
export const NEEDS = {
  add: 'Viewers can look and download, not add or make things. Ask an admin for contributor access.',
  manage: 'That needs an editor, admin or owner of this brand.',
  admin: 'Only admins and owners of this brand can do that.',
  owner: 'Only owners of this brand can do that.',
};
// A database refusal ("ROLE: …") as a sentence for people.
export const roleError = (msg?: string | null) => (/^ROLE: /.test(msg || '') ? (msg as string).replace(/^ROLE: /, '') : null);
