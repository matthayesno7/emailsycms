// A small in-memory stand-in for the Supabase client, enough for the connector tools.
export function fakeDb(seed: Record<string, any[]>) {
  const T: Record<string, any[]> = {};
  for (const [k, v] of Object.entries(seed)) T[k] = v.map((r) => ({ ...r }));
  const files = new Map<string, Buffer>();
  const log: string[] = [];
  const uid = () => crypto.randomUUID();
  const tbl = (n: string) => (T[n] ||= []);

  function builder(name: string) {
    let op: 'select' | 'insert' | 'update' | 'delete' | 'upsert' = 'select';
    let payload: any = null; let conflict = '';
    const filters: ((r: any) => boolean)[] = [];
    let lim = Infinity, single = false, maybe = false, count = false, head = false, ret = false;
    let orderBy: [string, boolean][] = [];
    const b: any = {
      select(_c?: string, o?: any) { if (op !== 'select') ret = true; if (o?.count) count = true; if (o?.head) head = true; return b; },
      insert(p: any) { op = 'insert'; payload = p; return b; },
      update(p: any) { op = 'update'; payload = p; return b; },
      delete() { op = 'delete'; return b; },
      upsert(p: any, o?: any) { op = 'upsert'; payload = p; conflict = o?.onConflict || 'id'; return b; },
      eq(k: string, v: any) { filters.push((r) => r[k] === v); return b; },
      neq(k: string, v: any) { filters.push((r) => r[k] !== v); return b; },
      in(k: string, v: any[]) { filters.push((r) => v.includes(r[k])); return b; },
      contains(k: string, v: any) { filters.push((r) => Object.entries(v).every(([kk, vv]) => r[k]?.[kk] === vv)); return b; },
      not() { return b; }, or() { return b; },
      order(k: string, o?: any) { orderBy.push([k, o?.ascending !== false]); return b; },
      limit(n: number) { lim = n; return b; },
      range(a: number, z: number) { lim = z - a + 1; return b; },
      maybeSingle() { single = true; maybe = true; return b; },
      single() { single = true; return b; },
      then(res: any, rej: any) { return Promise.resolve(run()).then(res, rej); },
    };
    function run() {
      const rows = tbl(name);
      log.push(`${op} ${name}`);
      if (op === 'insert' || op === 'upsert') {
        const list = (Array.isArray(payload) ? payload : [payload]).map((p: any) => ({ id: uid(), created_at: new Date().toISOString(), ...p }));
        const out: any[] = [];
        for (const r of list) {
          const keys = conflict.split(',');
          const hit = op === 'upsert' ? rows.find((x) => keys.every((k) => x[k] === r[k])) : null;
          if (hit) { Object.assign(hit, r, { id: hit.id }); out.push(hit); } else { rows.push(r); out.push(r); }
        }
        return { data: single ? out[0] : out, error: null };
      }
      let hits = rows.filter((r) => filters.every((f) => f(r)));
      if (op === 'update') { for (const r of hits) Object.assign(r, payload); return { data: single ? hits[0] || null : hits, error: null }; }
      if (op === 'delete') { T[name] = rows.filter((r) => !hits.includes(r)); return { data: null, error: null }; }
      for (const [k, asc] of orderBy.reverse()) hits = [...hits].sort((a, z) => (a[k] > z[k] ? 1 : a[k] < z[k] ? -1 : 0) * (asc ? 1 : -1));
      hits = hits.slice(0, lim);
      if (head) return { data: null, count: hits.length, error: null };
      if (single) return hits[0] || maybe ? { data: hits[0] || null, error: null } : { data: null, error: { message: 'no rows' } };
      return { data: hits, count: count ? hits.length : undefined, error: null };
    }
    return b;
  }

  const db: any = {
    T, files, log,
    from: (n: string) => builder(n),
    async rpc(name: string, a: any) {
      log.push(`rpc ${name}`);
      const assets = tbl('assets');
      if (name === 'search_assets') return { data: [], error: null };
      if (name === 'asset_new_version') {
        const x = assets.find((r) => r.id === a.p_asset);
        tbl('asset_versions').push({ id: uid(), asset_id: x.id, workspace_id: x.workspace_id, version: x.version || 1, storage_path: x.storage_path, images: x.images, note: 'Original', created_at: x.created_at });
        Object.assign(x, { storage_path: a.p_file.storage_path, mime: a.p_file.mime, width: a.p_file.width, height: a.p_file.height, bytes: a.p_file.bytes, images: a.p_file.images, version: (x.version || 1) + 1, version_note: a.p_note });
        return { data: x, error: null };
      }
      if (name === 'asset_save_copy') {
        const x = assets.find((r) => r.id === a.p_asset);
        const c = { ...x, id: uid(), name: a.p_name, storage_path: a.p_file.storage_path, width: a.p_file.width, height: a.p_file.height, images: a.p_file.images, version: 1, created_by: a.p_file.by };
        assets.push(c);
        return { data: c, error: null };
      }
      if (name === 'asset_revert') {
        const x = assets.find((r) => r.id === a.p_asset);
        const v = tbl('asset_versions').find((r) => r.asset_id === x.id && r.version === a.p_version);
        if (!v) return { data: null, error: { message: 'Version not found' } };
        Object.assign(x, { storage_path: v.storage_path, images: v.images, version: x.version + 1, version_note: `Restored version ${a.p_version}` });
        return { data: x, error: null };
      }
      return { data: null, error: { message: `no rpc ${name}` } };
    },
    storage: {
      from: () => ({
        async upload(p: string, buf: any) { files.set(p, Buffer.from(buf)); return { error: null }; },
        async remove(ps: string[]) { for (const p of ps) files.delete(p); log.push(`remove ${ps.length}`); return { error: null }; },
        async download(p: string) { const b = files.get(p); return b ? { data: new Blob([new Uint8Array(b)], { type: p.endsWith('.png') ? 'image/png' : 'image/jpeg' }), error: null } : { data: null, error: { message: 'missing' } }; },
        async createSignedUrl(p: string) { return { data: { signedUrl: `https://signed/${p}` } }; },
      }),
    },
    auth: { admin: { async inviteUserByEmail(e: string) { log.push(`invite ${e}`); return { error: null }; } } },
  };
  return db;
}
