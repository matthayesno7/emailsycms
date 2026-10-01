import { createClient } from '@/lib/supabase/server';
import { boxGet, boxList, boxToken, boxWalk } from '@/lib/box';
import { isImportable } from '@/lib/importer';

// Browse a Box folder (GET ?folder=0), or list every importable file under one (GET ?folder=…&all=1).
export const runtime = 'nodejs';
export const maxDuration = 60;

export async function GET(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: 'Sign in first.' }, { status: 401 });
  const token = await boxToken(user.id);
  if (!token) return Response.json({ error: 'not_connected' }, { status: 409 });
  const u = new URL(request.url);
  const folder = /^\d+$/.test(u.searchParams.get('folder') || '') ? u.searchParams.get('folder')! : '0';
  try {
    if (u.searchParams.get('all')) {
      const files = (await boxWalk(token, folder)).filter((f) => isImportable(f.name));
      return Response.json({ files });
    }
    const [info, items] = await Promise.all([boxGet(token, `/folders/${folder}?fields=name,path_collection`), boxList(token, folder)]);
    return Response.json({
      folder: { id: folder, name: folder === '0' ? 'All files' : info.name, path: (info.path_collection?.entries || []).map((e: any) => ({ id: e.id, name: e.id === '0' ? 'All files' : e.name })) },
      items: items.filter((i) => i.type === 'folder' || isImportable(i.name)).sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name) : a.type === 'folder' ? -1 : 1)),
    });
  } catch (e: any) {
    return Response.json({ error: e?.message || 'Box didn’t respond.' }, { status: 502 });
  }
}
