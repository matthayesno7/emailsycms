-- Mise: edit with version history. An edit never overwrites the original: the current file
-- moves into asset_versions and the edited file becomes current, on the same asset, so its
-- tags, folder, product link, collections and share links all stay. Safe to run more than once.

alter table public.assets
  add column if not exists version int not null default 1,
  add column if not exists version_note text,          -- what made this version, e.g. "Cropped to 1200×600"
  add column if not exists version_by uuid references auth.users on delete set null,
  add column if not exists version_at timestamptz;

create table if not exists public.asset_versions (
  id uuid primary key default gen_random_uuid(),
  asset_id uuid not null references public.assets on delete cascade,
  workspace_id uuid not null references public.workspaces on delete cascade,
  version int not null,
  storage_path text,
  mime text,
  width int,
  height int,
  bytes int,
  images jsonb not null default '{}'::jsonb,
  provenance jsonb,
  focus jsonb,
  phash text,
  note text,
  created_by uuid references auth.users on delete set null,
  created_at timestamptz not null default now(),   -- when this version was made
  archived_at timestamptz not null default now(),  -- when it stopped being current
  unique (asset_id, version)
);
create index if not exists asset_versions_asset_idx on public.asset_versions (asset_id, version desc);
alter table public.asset_versions enable row level security;
drop policy if exists "versions: members read" on public.asset_versions;
create policy "versions: members read" on public.asset_versions for select using (public.is_member(workspace_id));
-- Written only by the functions below.

-- An edit keeps what auto-organise found (the picture is the same subject); a brand-new file is organised again.
create or replace function public.asset_ai_queue()
returns trigger language plpgsql as $$
begin
  if current_setting('mise.keep_ai', true) = 'on' then return new; end if;
  if new.kind in ('image', 'logo', 'product') and new.storage_path is not null
     and (tg_op = 'INSERT' or new.storage_path is distinct from old.storage_path) then
    new.ai_status = 'pending';
    new.ai_attempts = 0;
    new.ai_error = null;
  end if;
  return new;
end $$;

-- Keep the current file as a version.
create or replace function public.asset_archive_current(a public.assets)
returns void language sql security definer set search_path = public as $$
  insert into public.asset_versions (asset_id, workspace_id, version, storage_path, mime, width, height, bytes, images, provenance, focus, phash, note, created_by, created_at)
  values (a.id, a.workspace_id, a.version, a.storage_path, a.mime, a.width, a.height, a.bytes, a.images, a.provenance, a.focus, a.phash,
          coalesce(a.version_note, case when a.version = 1 then 'Original' end), coalesce(a.version_by, a.created_by), coalesce(a.version_at, a.created_at))
  on conflict (asset_id, version) do nothing;
$$;
revoke all on function public.asset_archive_current(public.assets) from public, anon, authenticated;

-- Save an edited file as the asset's new current version.
-- p_file: {storage_path, mime, width, height, bytes, images, phash, focus?}; p_provenance replaces provenance when given (Studio designs).
create or replace function public.asset_new_version(p_asset uuid, p_file jsonb, p_note text default null, p_provenance jsonb default null)
returns public.assets language plpgsql security definer set search_path = public as $$
declare a public.assets; result public.assets;
begin
  select * into a from public.assets where id = p_asset for update;
  -- The team, or the Mise server for the Claude connector (it checks the workspace itself).
  if a.id is null or not (public.is_member(a.workspace_id) or coalesce(auth.role(), '') = 'service_role') then raise exception 'Asset not found'; end if;
  if a.kind = 'block' then raise exception 'Blocks have their own editor'; end if;
  if coalesce(p_file->>'storage_path', '') not like a.workspace_id::text || '/%' then raise exception 'The file must be in this workspace'; end if;
  perform public.asset_archive_current(a);
  perform set_config('mise.keep_ai', 'on', true);
  update public.assets set
    storage_path = p_file->>'storage_path',
    mime = coalesce(p_file->>'mime', mime),
    width = nullif(p_file->>'width', '')::int,
    height = nullif(p_file->>'height', '')::int,
    bytes = nullif(p_file->>'bytes', '')::int,
    images = coalesce(p_file->'images', '{}'::jsonb),
    phash = p_file->>'phash',
    focus = case when p_file ? 'focus' then p_file->'focus' else focus end,
    provenance = coalesce(p_provenance, provenance),
    duplicate_of = null,
    version = a.version + 1, version_note = left(p_note, 200), version_by = auth.uid(), version_at = now()
  where id = a.id returning * into result;
  perform set_config('mise.keep_ai', 'off', true);
  return result;
end $$;

-- Save an edit as a separate asset (e.g. a LinkedIn crop), keeping the source as it is.
-- The copy starts with the source's description, tags, colours, folder and product link.
create or replace function public.asset_save_copy(p_asset uuid, p_file jsonb, p_name text, p_note text default null)
returns public.assets language plpgsql security definer set search_path = public as $$
declare a public.assets; result public.assets;
begin
  select * into a from public.assets where id = p_asset;
  if a.id is null or not public.is_member(a.workspace_id) then raise exception 'Asset not found'; end if;
  if coalesce(p_file->>'storage_path', '') not like a.workspace_id::text || '/%' then raise exception 'The file must be in this workspace'; end if;
  perform set_config('mise.keep_ai', 'on', true);
  insert into public.assets (workspace_id, kind, name, storage_path, mime, width, height, bytes, images, phash, focus, folder_id, product_id, fields,
    description, tags, colours, colour_names, text_in_image, on_brand, on_brand_reason, ai, edited, ai_status, origin, status, created_by, provenance, version_note, version_by, version_at)
  values (a.workspace_id, case when a.kind = 'product' then 'image' else a.kind end, left(coalesce(nullif(trim(p_name), ''), a.name || ' (edit)'), 120),
    p_file->>'storage_path', coalesce(p_file->>'mime', a.mime), nullif(p_file->>'width', '')::int, nullif(p_file->>'height', '')::int, nullif(p_file->>'bytes', '')::int,
    coalesce(p_file->'images', '{}'::jsonb), p_file->>'phash', a.focus, a.folder_id, case when a.kind = 'product' then a.id else a.product_id end,
    jsonb_build_object('alt', coalesce(a.fields->>'alt', a.description, a.name)),
    a.description, a.tags, a.colours, a.colour_names, a.text_in_image, a.on_brand, a.on_brand_reason, a.ai, a.edited,
    case when a.ai_status in ('done', 'skipped') then a.ai_status else null end, 'uploaded', a.status, auth.uid(),
    jsonb_build_object('via', 'edit', 'source_asset_id', a.id, 'source_version', a.version, 'note', p_note, 'edited_at', now()),
    left(p_note, 200), auth.uid(), now())
  returning * into result;
  perform set_config('mise.keep_ai', 'off', true);
  return result;
end $$;

-- Go back to an earlier version. The current one is kept too, so nothing is ever lost.
create or replace function public.asset_revert(p_asset uuid, p_version int)
returns public.assets language plpgsql security definer set search_path = public as $$
declare a public.assets; v public.asset_versions; result public.assets;
begin
  select * into a from public.assets where id = p_asset for update;
  if a.id is null or not public.is_member(a.workspace_id) then raise exception 'Asset not found'; end if;
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
