import type { SupabaseClient } from '@supabase/supabase-js';
import type { AssetRow, Repo, Workspace } from './server';

// Supabase-backed data access for the MCP server. Uses the service-role client,
// so every read is scoped by the caller (server.ts checks workspace membership).
export function supabaseRepo(db: SupabaseClient): Repo {
  return {
    async workspacesForUser(userId) {
      const { data, error } = await db
        .from('workspace_members')
        .select('role, workspaces(id, name)')
        .eq('user_id', userId);
      if (error) throw error;
      return (data || [])
        .map((r: any) => (r.workspaces ? { id: r.workspaces.id, name: r.workspaces.name, role: r.role } : null))
        .filter(Boolean) as Workspace[];
    },
    async listAssets(workspaceIds, { kind, query, limit }) {
      let q = db.from('assets').select('*').in('workspace_id', workspaceIds).order('updated_at', { ascending: false }).limit(limit);
      if (kind) q = q.eq('kind', kind);
      if (query) {
        const s = query.replace(/[%,()]/g, ' ').trim();
        if (s) q = q.or(`name.ilike.%${s}%,pid.ilike.%${s}%`);
      }
      const { data, error } = await q;
      if (error) throw error;
      return (data || []) as AssetRow[];
    },
    async getAsset(id) {
      if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
      const { data } = await db.from('assets').select('*').eq('id', id).maybeSingle();
      return (data as AssetRow) || null;
    },
    async signedUrl(path) {
      const { data } = await db.storage.from('assets').createSignedUrl(path, 3600);
      return data?.signedUrl || null;
    },
    async download(path) {
      const { data, error } = await db.storage.from('assets').download(path);
      if (error || !data) return null;
      return { blob: data, mime: data.type || (path.endsWith('.png') ? 'image/png' : 'image/jpeg') };
    },
    async updateAsset(id, patch) {
      const { error } = await db.from('assets').update(patch).eq('id', id);
      if (error) throw error;
    },
  };
}
