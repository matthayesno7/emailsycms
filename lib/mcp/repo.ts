import type { SupabaseClient } from '@supabase/supabase-js';
import type { AssetRow, Repo, Workspace } from './server';
import { searchAssets } from '../search';

// Supabase-backed data access for the MCP server. Uses the service-role client,
// so every read is scoped by the caller (server.ts checks workspace membership).
export function supabaseRepo(db: SupabaseClient): Repo {
  return {
    async workspacesForUser(userId) {
      const { data, error } = await db
        .from('workspace_members')
        .select('role, workspaces(id, name, figma_file_url, figma_file_key, figma_file_name)')
        .eq('user_id', userId);
      if (error) throw error;
      return (data || [])
        .map((r: any) => (r.workspaces ? { id: r.workspaces.id, name: r.workspaces.name, role: r.role, figma_file_url: r.workspaces.figma_file_url, figma_file_key: r.workspaces.figma_file_key, figma_file_name: r.workspaces.figma_file_name } : null))
        .filter(Boolean) as Workspace[];
    },
    async listAssets(workspaceIds, { kind, origin, status, query, limit }) {
      let q = db.from('assets').select('*').in('workspace_id', workspaceIds).eq('on_board', false).order('updated_at', { ascending: false }).limit(limit);
      if (kind) q = q.eq('kind', kind);
      if (origin) q = q.eq('origin', origin);
      if (status) q = q.eq('status', status);
      if (query) {
        // Every word matches somewhere: name, PID, AI description, text in the image, a tag or a colour.
        const words = query.toLowerCase().replace(/[%,()"{}\\]/g, ' ').split(/\s+/).filter(Boolean).slice(0, 6);
        for (const w of words) q = q.or(`name.ilike.%${w}%,pid.ilike.%${w}%,description.ilike.%${w}%,text_in_image.ilike.%${w}%,tags.cs.{${w}},colour_names.cs.{${w}}`);
      }
      const { data, error } = await q;
      if (error) throw error;
      return (data || []) as AssetRow[];
    },
    async search(workspaceIds, query, { kind, origin, status, limit }) {
      const r = await searchAssets(db, { ws: workspaceIds, q: query, filters: { kinds: kind ? [kind] : undefined, origin: origin as any, status: status as any }, limit });
      if (!r.hits.length) return [];
      const { data, error } = await db.from('assets').select('*').in('id', r.hits.map((h) => h.id)).eq('on_board', false);
      if (error) throw error;
      const rank = new Map(r.hits.map((h, i) => [h.id, i]));
      return ((data || []) as AssetRow[]).sort((a, b) => (rank.get(a.id) ?? 0) - (rank.get(b.id) ?? 0));
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
    async insertAsset(row) {
      const { data, error } = await db.from('assets').insert(row).select('*').single();
      if (error) throw error;
      return data as AssetRow;
    },
    async newVersion(id, file, note, provenance) {
      const { data, error } = await db.rpc('asset_new_version', { p_asset: id, p_file: file, p_note: note, p_provenance: provenance || null });
      if (error) throw error;
      return data as AssetRow;
    },
    async upload(path, buf, type) {
      const { error } = await db.storage.from('assets').upload(path, buf, { contentType: type });
      if (error) throw error;
    },
    async getBrandKit(workspaceId) {
      const { data, error } = await db.from('brand_kits').select('*').eq('workspace_id', workspaceId).maybeSingle();
      if (error) throw error;
      return (data as any) || null;
    },
    async saveBrandKit(row) {
      const { data, error } = await db.from('brand_kits').upsert(row, { onConflict: 'workspace_id' }).select('*').single();
      if (error) throw error;
      return data as any;
    },
  };
}
