-- The Claude connector does more of the work: it saves edits as copies and restores versions.
-- The Mise server calls these with the service role after checking the user's workspace itself
-- (the same allowance asset_new_version already has). p_by records who it was for.

create or replace function public.asset_save_copy(p_asset uuid, p_file jsonb, p_name text, p_note text default null)
returns public.assets language plpgsql security definer set search_path = public as $$
declare a public.assets; result public.assets;
begin
  select * into a from public.assets where id = p_asset;
  if a.id is null or not (public.is_member(a.workspace_id) or coalesce(auth.role(), '') = 'service_role') then raise exception 'Asset not found'; end if;
  if coalesce(p_file->>'storage_path', '') not like a.workspace_id::text || '/%' then raise exception 'The file must be in this workspace'; end if;
  perform set_config('mise.keep_ai', 'on', true);
  insert into public.assets (workspace_id, kind, name, storage_path, mime, width, height, bytes, images, phash, focus, folder_id, product_id, fields,
    description, tags, colours, colour_names, text_in_image, on_brand, on_brand_reason, ai, edited, ai_status, origin, status, created_by, provenance, version_note, version_by, version_at)
  values (a.workspace_id, case when a.kind = 'product' then 'image' else a.kind end, left(coalesce(nullif(trim(p_name), ''), a.name || ' (edit)'), 120),
    p_file->>'storage_path', coalesce(p_file->>'mime', a.mime), nullif(p_file->>'width', '')::int, nullif(p_file->>'height', '')::int, nullif(p_file->>'bytes', '')::int,
    coalesce(p_file->'images', '{}'::jsonb), p_file->>'phash', a.focus, a.folder_id, case when a.kind = 'product' then a.id else a.product_id end,
    jsonb_build_object('alt', coalesce(a.fields->>'alt', a.description, a.name)),
    a.description, a.tags, a.colours, a.colour_names, a.text_in_image, a.on_brand, a.on_brand_reason, a.ai, a.edited,
    case when a.ai_status in ('done', 'skipped') then a.ai_status else null end, 'uploaded', a.status, coalesce(auth.uid(), nullif(p_file->>'by', '')::uuid),
    jsonb_build_object('via', 'edit', 'source_asset_id', a.id, 'source_version', a.version, 'note', p_note, 'edited_at', now()),
    left(p_note, 200), coalesce(auth.uid(), nullif(p_file->>'by', '')::uuid), now())
  returning * into result;
  perform set_config('mise.keep_ai', 'off', true);
  return result;
end $$;

create or replace function public.asset_revert(p_asset uuid, p_version int)
returns public.assets language plpgsql security definer set search_path = public as $$
declare a public.assets; v public.asset_versions; result public.assets;
begin
  select * into a from public.assets where id = p_asset for update;
  if a.id is null or not (public.is_member(a.workspace_id) or coalesce(auth.role(), '') = 'service_role') then raise exception 'Asset not found'; end if;
  select * into v from public.asset_versions where asset_id = a.id and version = p_version;
  if v.id is null then raise exception 'Version not found'; end if;
  perform public.asset_archive_current(a);
  perform set_config('mise.keep_ai', 'on', true);
  update public.assets set
    storage_path = v.storage_path, mime = v.mime, width = v.width, height = v.height, bytes = v.bytes,
    images = v.images, phash = v.phash, focus = v.focus, provenance = coalesce(v.provenance, provenance),
    version = a.version + 1, version_note = 'Restored version ' || p_version, version_by = auth.uid(), version_at = now()
  where id = a.id returning * into result;
  perform set_config('mise.keep_ai', 'off', true);
  return result;
end $$;
