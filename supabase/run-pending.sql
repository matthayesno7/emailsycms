-- Mise: every migration still to run or confirm (2 Oct 2026). Each part is safe to run more than once.
-- Paste into Supabase → SQL editor → Run.

-- ===== 20260930150000_video_assets.sql =====
-- Emailsy CMS: videos as a kind of asset (made with Claude via Figma motion or a video model).
-- Safe to run more than once.
alter table public.assets drop constraint if exists assets_kind_check;
alter table public.assets add constraint assets_kind_check check (kind in ('image', 'logo', 'video', 'product', 'block'));

-- Videos are bigger than images: raise the bucket's per-file limit to 100 MB.
update storage.buckets set file_size_limit = 104857600 where id = 'assets';

-- ===== 20261001000000_folders.sql =====
-- Emailsy: folders, so a brand can organise assets the way they would in Dropbox.
-- One folder per asset (or none). Safe to run more than once.
create table if not exists public.folders (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces on delete cascade,
  name text not null check (char_length(name) between 1 and 60),
  created_by uuid references auth.users on delete set null,
  created_at timestamptz not null default now(),
  unique (workspace_id, name)
);
alter table public.folders enable row level security;
drop policy if exists "folders: members read" on public.folders;
drop policy if exists "folders: members add" on public.folders;
drop policy if exists "folders: members edit" on public.folders;
drop policy if exists "folders: members delete" on public.folders;
create policy "folders: members read" on public.folders for select using (public.is_member(workspace_id));
create policy "folders: members add" on public.folders for insert with check (public.is_member(workspace_id));
create policy "folders: members edit" on public.folders for update using (public.is_member(workspace_id));
create policy "folders: members delete" on public.folders for delete using (public.is_member(workspace_id));

alter table public.assets add column if not exists folder_id uuid references public.folders on delete set null;
create index if not exists assets_folder_idx on public.assets (folder_id);

-- ===== 20261001120000_connections.sql =====
-- Mise: connections to where a team already keeps images (Box today; more later).
-- Tokens are only ever read by the server (service role): no client policies on purpose.
create table if not exists public.connections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  provider text not null check (provider in ('box', 'dropbox', 'google')),
  account text,
  access_token text not null,
  refresh_token text,
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, provider)
);
alter table public.connections enable row level security;

-- ===== 20261002180000_sharing.sql =====
-- Mise: share links and brand portals. Safe to run more than once.
-- Public pages read through the server (service role) after checking the link or portal;
-- members manage everything here through row level security.

-- ---------- a public address per workspace: /p/<slug> ----------
alter table public.workspaces add column if not exists slug text;

create or replace function public.slugify(t text)
returns text language sql immutable as $$
  select coalesce(nullif(trim(both '-' from regexp_replace(lower(coalesce(t, '')), '[^a-z0-9]+', '-', 'g')), ''), 'brand')
$$;

create or replace function public.workspace_slug()
returns trigger language plpgsql as $$
declare base text; s text; n int := 1;
begin
  if new.slug is not null and new.slug <> '' and (tg_op = 'INSERT' or new.slug is distinct from old.slug) then
    new.slug = left(public.slugify(new.slug), 40);
  end if;
  if new.slug is null or new.slug = '' then
    base = left(public.slugify(new.name), 40);
    s = base;
    while exists (select 1 from public.workspaces where slug = s and id <> new.id) loop
      n = n + 1; s = base || '-' || n;
    end loop;
    new.slug = s;
  end if;
  return new;
end $$;
drop trigger if exists workspaces_slug on public.workspaces;
create trigger workspaces_slug before insert or update of slug on public.workspaces for each row execute function public.workspace_slug();

-- Give existing workspaces a slug (one at a time, so duplicates get -2, -3…).
do $$ declare r record; begin
  for r in select id from public.workspaces where slug is null or slug = '' order by created_at loop
    update public.workspaces set slug = null where id = r.id;
  end loop;
end $$;
create unique index if not exists workspaces_slug_idx on public.workspaces (slug);

-- ---------- share links ----------
create table if not exists public.shares (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces on delete cascade,
  token text not null unique,                                  -- the secret in the link: /s/<token>
  kind text not null check (kind in ('assets', 'folder', 'collection')),
  asset_ids uuid[] not null default '{}',
  folder_id uuid references public.folders on delete cascade,
  collection_id uuid references public.collections on delete cascade,
  title text not null default 'Shared files' check (char_length(title) between 1 and 120),
  message text check (char_length(message) <= 1000),
  expires_at timestamptz,                                      -- null: never
  passcode_hash text,                                          -- null: no passcode (scrypt, set by the server)
  allow_download boolean not null default true,
  formats text[] not null default '{original,web,email}',
  revoked_at timestamptz,
  views int not null default 0,
  downloads int not null default 0,
  last_viewed_at timestamptz,
  created_by uuid references auth.users on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists shares_ws_idx on public.shares (workspace_id, created_at desc);

-- ---------- brand portals: /p/<workspace slug>/<portal slug> ----------
create table if not exists public.portals (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces on delete cascade,
  slug text not null check (slug ~ '^[a-z0-9][a-z0-9-]{0,39}$'),
  name text not null check (char_length(name) between 1 and 80),
  intro text check (char_length(intro) <= 1000),
  include_all boolean not null default true,                   -- every approved file
  folder_ids uuid[] not null default '{}',
  collection_ids uuid[] not null default '{}',
  show_guidelines boolean not null default true,
  access text not null default 'public' check (access in ('public', 'passcode', 'allowlist')),
  passcode_hash text,
  allowlist text[] not null default '{}',                      -- lowercase emails, or @domain.com for a whole domain
  allow_download boolean not null default true,
  formats text[] not null default '{original,web,email}',
  published boolean not null default true,
  created_by uuid references auth.users on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, slug)
);
drop trigger if exists portals_touch on public.portals;
create trigger portals_touch before update on public.portals for each row execute function public.touch_updated_at();

-- ---------- what happened on links and portals (visits and downloads) ----------
create table if not exists public.share_events (
  id bigint generated always as identity primary key,
  workspace_id uuid not null references public.workspaces on delete cascade,
  share_id uuid references public.shares on delete cascade,
  portal_id uuid references public.portals on delete cascade,
  asset_id uuid references public.assets on delete set null,
  event text not null check (event in ('view', 'download')),
  email text,                                                  -- only for allowlist portals (the visitor signed in)
  format text,
  at timestamptz not null default now()
);
create index if not exists share_events_portal_idx on public.share_events (portal_id, at desc);
create index if not exists share_events_share_idx on public.share_events (share_id, at desc);

-- ---------- row level security ----------
alter table public.shares enable row level security;
alter table public.portals enable row level security;
alter table public.share_events enable row level security;

drop policy if exists "shares: members read" on public.shares;
drop policy if exists "shares: members edit" on public.shares;
drop policy if exists "shares: members delete" on public.shares;
create policy "shares: members read" on public.shares for select using (public.is_member(workspace_id));
create policy "shares: members edit" on public.shares for update using (public.is_member(workspace_id)) with check (public.is_member(workspace_id));
create policy "shares: members delete" on public.shares for delete using (public.is_member(workspace_id));

drop policy if exists "portals: members read" on public.portals;
drop policy if exists "portals: members edit" on public.portals;
drop policy if exists "portals: members delete" on public.portals;
create policy "portals: members read" on public.portals for select using (public.is_member(workspace_id));
create policy "portals: members edit" on public.portals for update using (public.is_member(workspace_id)) with check (public.is_member(workspace_id));
create policy "portals: members delete" on public.portals for delete using (public.is_member(workspace_id));

drop policy if exists "share events: members read" on public.share_events;
create policy "share events: members read" on public.share_events for select using (public.is_member(workspace_id));
-- Inserts (new links and portals, passcodes, events) go through the server, which checks membership.

-- Counters, bumped by the server when a link is opened or a file downloaded.
create or replace function public.bump_share(p_share uuid, p_view int, p_download int)
returns void language sql security definer set search_path = public as $$
  update public.shares set views = views + p_view, downloads = downloads + p_download,
    last_viewed_at = case when p_view > 0 then now() else last_viewed_at end
  where id = p_share;
$$;
revoke all on function public.bump_share(uuid, int, int) from public, anon, authenticated;
grant execute on function public.bump_share(uuid, int, int) to service_role;

-- ===== 20261002210000_versions.sql =====
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

-- ===== check: should list folders, connections, shares, portals, share_events, asset_versions =====
select table_name from information_schema.tables where table_schema = 'public' and table_name in ('folders','connections','shares','portals','share_events','asset_versions') order by 1;

-- ===== 20261003000000_usage_and_feedback.sql (added 2 Oct, later) =====
-- Mise: monthly AI allowances per workspace (cost guards) and in-app feedback. Safe to run more than once.

-- ---------- AI usage: one row per workspace, month and kind ----------
-- kinds: tag (auto-organise), search (plain-English search), design (Studio), kit (brand kit from a website)
create table if not exists public.ai_usage (
  workspace_id uuid not null references public.workspaces on delete cascade,
  month date not null,
  kind text not null,
  used int not null default 0,
  alerted int not null default 0,          -- highest alert sent this month: 0, 80 or 100 (percent)
  updated_at timestamptz not null default now(),
  primary key (workspace_id, month, kind)
);
alter table public.ai_usage enable row level security;
drop policy if exists "ai usage: members read" on public.ai_usage;
create policy "ai usage: members read" on public.ai_usage for select using (public.is_member(workspace_id));

-- Per-workspace overrides, e.g. {"tag": 20000} for a design partner. Set by hand in Supabase.
alter table public.workspaces add column if not exists ai_caps jsonb not null default '{}'::jsonb;

-- Take n from this month's allowance, if there's room. Server only (service role).
-- Returns ok, used (after), cap, and alert: 80 or 100 the first time usage crosses that line this month.
create or replace function public.ai_usage_take(p_ws uuid, p_kind text, p_n int, p_cap int)
returns table (ok boolean, used int, cap int, alert int)
language plpgsql security definer set search_path = public as $$
declare m date := date_trunc('month', now())::date; c int; u int; a int; pct int; newalert int := 0;
begin
  select coalesce(nullif(w.ai_caps->>p_kind, '')::int, p_cap) into c from public.workspaces w where w.id = p_ws;
  if c is null then c := p_cap; end if;
  insert into public.ai_usage (workspace_id, month, kind) values (p_ws, m, p_kind) on conflict do nothing;
  select au.used, au.alerted into u, a from public.ai_usage au where au.workspace_id = p_ws and au.month = m and au.kind = p_kind for update;
  if u + p_n > c then
    if a < 100 then update public.ai_usage set alerted = 100, updated_at = now() where workspace_id = p_ws and month = m and kind = p_kind; newalert := 100; end if;
    return query select false, u, c, newalert; return;
  end if;
  u := u + p_n;
  pct := case when c > 0 then (u * 100) / c else 100 end;
  if pct >= 80 and a < 80 then newalert := 80; end if;
  update public.ai_usage set used = u, alerted = greatest(alerted, newalert), updated_at = now() where workspace_id = p_ws and month = m and kind = p_kind;
  return query select true, u, c, newalert;
end $$;
revoke all on function public.ai_usage_take(uuid, text, int, int) from public, anon, authenticated;

-- ---------- feedback from the app ----------
create table if not exists public.feedback (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users on delete set null,
  email text,
  workspace_id uuid references public.workspaces on delete set null,
  kind text not null default 'idea' check (kind in ('bug', 'idea', 'question', 'praise')),
  message text not null check (char_length(message) between 1 and 4000),
  page text,
  user_agent text,
  created_at timestamptz not null default now()
);
alter table public.feedback enable row level security;
-- Anyone signed in can send feedback; nobody reads it through the app (read it in Supabase).
drop policy if exists "feedback: send" on public.feedback;
create policy "feedback: send" on public.feedback for insert with check (auth.uid() = user_id);
