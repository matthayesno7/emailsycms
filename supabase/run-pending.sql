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


-- ===== 20261005120000_billing_and_lifecycle.sql =====
-- Mise: plans and billing (Free, or Pro per brand through Stripe) and assets that are no longer available.
-- Safe to run more than once.

-- ---------- billing: one row per brand (workspace) ----------
-- Kept out of public.workspaces so owners (who can update their workspace row) can't change their own plan.
-- Only the server (service role, from Stripe webhooks) writes here.
create table if not exists public.workspace_billing (
  workspace_id uuid primary key references public.workspaces on delete cascade,
  plan text not null default 'free' check (plan in ('free', 'pro', 'enterprise')),
  interval text check (interval in ('month', 'year')),
  stripe_customer_id text unique,
  stripe_subscription_id text unique,
  subscription_status text,                      -- Stripe's: active, trialing, past_due, canceled…
  current_period_end timestamptz,
  cancel_at_period_end boolean not null default false,
  overage_cap_pence int not null default 5000 check (overage_cap_pence between 0 and 1000000),  -- extra Studio designs a month, in pence (default £50)
  updated_at timestamptz not null default now()
);
alter table public.workspace_billing enable row level security;
drop policy if exists "billing: members read" on public.workspace_billing;
create policy "billing: members read" on public.workspace_billing for select using (public.is_member(workspace_id));

-- The plan a brand is on right now (free when there's no row or the subscription has lapsed).
create or replace function public.plan_of(ws uuid)
returns text language sql security definer stable set search_path = public as $$
  select coalesce((select case when b.plan <> 'free' and coalesce(b.subscription_status, 'active') in ('active', 'trialing', 'past_due') then b.plan else 'free' end
                   from public.workspace_billing b where b.workspace_id = ws), 'free');
$$;

-- One free brand per person. A second brand they own starts through Stripe Checkout as Pro
-- (the webhook creates it), so create_workspace refuses when the caller already owns a free one.
create or replace function public.create_workspace(ws_name text)
returns public.workspaces language plpgsql security definer set search_path = public as $$
declare w public.workspaces;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  if exists (select 1 from public.workspace_members m where m.user_id = auth.uid() and m.role = 'owner' and public.plan_of(m.workspace_id) = 'free') then
    raise exception 'FREE_BRAND_LIMIT' using hint = 'Each extra brand is on Pro.';
  end if;
  insert into public.workspaces (name, created_by) values (trim(ws_name), auth.uid()) returning * into w;
  insert into public.workspace_members (workspace_id, user_id, role) values (w.id, auth.uid(), 'owner');
  return w;
end $$;

-- Owners can rename their workspace, but not raise their own AI allowances.
create or replace function public.guard_workspace_update()
returns trigger language plpgsql as $$
begin
  if new.ai_caps is distinct from old.ai_caps and coalesce(auth.role(), '') <> 'service_role' and current_user not in ('postgres', 'service_role', 'supabase_admin') then
    raise exception 'ai_caps can only be changed by Mise';
  end if;
  return new;
end $$;
drop trigger if exists workspaces_guard on public.workspaces;
create trigger workspaces_guard before update on public.workspaces for each row execute function public.guard_workspace_update();

-- ---------- assets that are no longer available ----------
-- lifecycle: active (default), archived (retired by hand), expired (licence or usage rights ran out),
-- obsolete (superseded: an old logo, a dead format). Unavailable assets stay in the library, marked,
-- so people can see what existed, why it went, and what replaced it.
alter table public.assets
  add column if not exists lifecycle text not null default 'active',
  add column if not exists lifecycle_reason text,
  add column if not exists lifecycle_at timestamptz,
  add column if not exists lifecycle_by uuid references auth.users on delete set null,
  add column if not exists licence_expires_at timestamptz,
  add column if not exists replaced_by uuid references public.assets on delete set null;
alter table public.assets drop constraint if exists assets_lifecycle_check;
alter table public.assets add constraint assets_lifecycle_check check (lifecycle in ('active', 'archived', 'expired', 'obsolete'));
alter table public.assets drop constraint if exists assets_replaced_by_self;
alter table public.assets add constraint assets_replaced_by_self check (replaced_by is null or replaced_by <> id);
create index if not exists assets_licence_idx on public.assets (licence_expires_at) where lifecycle = 'active' and licence_expires_at is not null;

-- Flip assets whose licence has run out to expired. Returns how many changed.
-- Runs hourly when pg_cron is on (below); the app also treats a past date as expired when it reads.
create or replace function public.expire_licences()
returns int language plpgsql security definer set search_path = public as $$
declare n int;
begin
  update public.assets set lifecycle = 'expired', lifecycle_reason = coalesce(lifecycle_reason, 'Licence expired'), lifecycle_at = licence_expires_at
   where lifecycle = 'active' and licence_expires_at is not null and licence_expires_at <= now();
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function public.expire_licences() from public, anon, authenticated;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule('mise-expire-licences') where exists (select 1 from cron.job where jobname = 'mise-expire-licences');
    perform cron.schedule('mise-expire-licences', '7 * * * *', 'select public.expire_licences()');
  end if;
end $$;

-- Who changed an asset's availability (people in the app; the connector sets it itself).
create or replace function public.asset_lifecycle_by()
returns trigger language plpgsql as $$
begin
  if new.lifecycle is distinct from old.lifecycle and auth.uid() is not null then new.lifecycle_by := auth.uid(); end if;
  return new;
end $$;
drop trigger if exists assets_lifecycle_by on public.assets;
create trigger assets_lifecycle_by before update on public.assets for each row execute function public.asset_lifecycle_by();

-- ---------- organising pace on Free ----------
-- Free brands get 500 files auto-organised a month. Past that, files upload and work as normal
-- but wait as 'paused' until the 1st, or until the brand upgrades (the billing webhook resumes them).
alter table public.assets drop constraint if exists assets_ai_status_check;
alter table public.assets add constraint assets_ai_status_check check (ai_status in ('pending', 'processing', 'done', 'failed', 'skipped', 'paused'));
create index if not exists assets_ai_paused_idx on public.assets (workspace_id, updated_at) where ai_status = 'paused';

-- Back in the queue: paused before this month started (or all of a brand's, with force). Returns how many.
create or replace function public.resume_paused_tags(ws uuid default null, force boolean default false)
returns int language plpgsql security definer set search_path = public as $$
declare n int;
begin
  update public.assets set ai_status = 'pending'
   where ai_status = 'paused' and (ws is null or workspace_id = ws)
     and (force or updated_at < date_trunc('month', now()));
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function public.resume_paused_tags(uuid, boolean) from public, anon, authenticated;
grant execute on function public.resume_paused_tags(uuid, boolean) to service_role;

-- ---------- file sizes ----------
-- Images up to 50 MB and videos up to 1 GB, on every plan (checked in the app; this is the hard stop).
-- Your Supabase project's own upload limit (Storage settings) must be at least this.
update storage.buckets set file_size_limit = 1073741824 where id = 'assets';


-- ===== 20261006090000_free_taster.sql =====
-- Mise: Free becomes a taster. Build the brand kit, add up to 50 files, run Studio once.
-- More files, more Studio, any sharing and editing are on Pro (7-day free trial).
-- Safe to run more than once. Needs 20261005120000_billing_and_lifecycle.sql first.

-- ---------- brands: every brand after your first goes through checkout ----------
-- (Before: only blocked while you owned a free brand, so owning a Pro brand let you make free ones.)
create or replace function public.create_workspace(ws_name text)
returns public.workspaces language plpgsql security definer set search_path = public as $$
declare w public.workspaces;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  if exists (select 1 from public.workspace_members m where m.user_id = auth.uid() and m.role = 'owner') then
    raise exception 'FREE_BRAND_LIMIT' using hint = 'Each extra brand is on Pro.';
  end if;
  insert into public.workspaces (name, created_by) values (trim(ws_name), auth.uid()) returning * into w;
  insert into public.workspace_members (workspace_id, user_id, role) values (w.id, auth.uid(), 'owner');
  return w;
end $$;

-- ---------- files: 50 on Free ----------
-- Counts files (anything with a stored file, except email blocks). New versions of a file don't count.
create or replace function public.free_file_limit()
returns trigger language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if new.storage_path is null or new.kind = 'block' then return new; end if;
  if tg_op = 'UPDATE' and old.storage_path is not null then return new; end if;
  if public.plan_of(new.workspace_id) <> 'free' then return new; end if;
  select count(*) into n from public.assets a where a.workspace_id = new.workspace_id and a.storage_path is not null and a.kind <> 'block';
  if n >= 50 then
    raise exception 'FREE_FILE_LIMIT: Free includes 50 files. Start your free Pro trial in Mise to add more.';
  end if;
  return new;
end $$;
drop trigger if exists assets_free_file_limit on public.assets;
create trigger assets_free_file_limit before insert or update of storage_path on public.assets
  for each row execute function public.free_file_limit();

-- ---------- editing: on Pro ----------
-- Every edit and restore keeps the old file as a version, so this is where edits are stopped on Free.
create or replace function public.free_no_edits()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if public.plan_of(new.workspace_id) = 'free' then
    raise exception 'PRO_EDIT: Editing files is on Pro. Start your free Pro trial in Mise to edit.';
  end if;
  return new;
end $$;
drop trigger if exists asset_versions_free_no_edits on public.asset_versions;
create trigger asset_versions_free_no_edits before insert on public.asset_versions
  for each row execute function public.free_no_edits();

-- ---------- Studio: one run on Free ----------
-- A run is one brief: its three designs and any extra sizes. Capped at 12 design calls.
alter table public.workspace_billing
  add column if not exists studio_free_run text,
  add column if not exists studio_free_calls int not null default 0;

create or replace function public.claim_free_run(p_ws uuid, p_run text, p_max int default 12)
returns boolean language plpgsql security definer set search_path = public as $$
begin
  insert into public.workspace_billing (workspace_id) values (p_ws) on conflict do nothing;
  update public.workspace_billing
     set studio_free_run = coalesce(studio_free_run, p_run), studio_free_calls = studio_free_calls + 1, updated_at = now()
   where workspace_id = p_ws and (studio_free_run is null or studio_free_run = p_run) and studio_free_calls < p_max;
  return found;
end $$;
revoke all on function public.claim_free_run(uuid, text, int) from public, anon, authenticated;
grant execute on function public.claim_free_run(uuid, text, int) to service_role;

-- ===== 20261006150000_product_feeds.sql =====
-- Mise: product feeds that stay in sync (a feed link, e.g. Google Merchant, or a Shopify store).
-- Mise re-reads each one daily on Pro (by hand on Free), adds and updates products, and marks
-- products that left the feed as no longer available. Safe to run more than once.

create table if not exists public.product_feeds (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces on delete cascade,
  kind text not null check (kind in ('url', 'shopify')),
  source text not null,                       -- the feed link, or the store's domain
  name text,
  last_synced_at timestamptz,
  last_status text,                           -- 'ok' or the reason it failed
  last_count int,
  created_by uuid references auth.users on delete set null,
  created_at timestamptz not null default now(),
  unique (workspace_id, kind, source)
);
alter table public.product_feeds enable row level security;
drop policy if exists "feeds: members read" on public.product_feeds;
create policy "feeds: members read" on public.product_feeds for select using (public.is_member(workspace_id));
-- Written by the server only (after checking membership).

-- No trial any more: Free's limit messages point to upgrading.
create or replace function public.free_file_limit()
returns trigger language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if new.storage_path is null or new.kind = 'block' then return new; end if;
  if tg_op = 'UPDATE' and old.storage_path is not null then return new; end if;
  if public.plan_of(new.workspace_id) <> 'free' then return new; end if;
  select count(*) into n from public.assets a where a.workspace_id = new.workspace_id and a.storage_path is not null and a.kind <> 'block';
  if n >= 50 then
    raise exception 'FREE_FILE_LIMIT: Free includes 50 files. Upgrade to Pro in Mise to add more.';
  end if;
  return new;
end $$;

create or replace function public.free_no_edits()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if public.plan_of(new.workspace_id) = 'free' then
    raise exception 'PRO_EDIT: Editing files is on Pro. Upgrade to Pro in Mise to edit.';
  end if;
  return new;
end $$;

-- ===== 20261006170000_currency.sql =====
-- Mise: the currency a brand pays in (gbp or usd), written by the Stripe webhook.
-- Until a brand pays, the app shows GBP in the UK and USD elsewhere. Safe to run more than once.
alter table public.workspace_billing add column if not exists currency text check (currency in ('gbp', 'usd'));

-- ===== 20261006180000_roles_and_audit.sql =====
-- Mise enterprise pack, part 1: roles and an audit log. Safe to run more than once.
--
-- Roles, per brand:
--   owner        everything, including billing and deleting the brand
--   admin        everything except billing and deleting the brand; manages people
--   editor       adds, edits, approves, shares and deletes; edits the brand kit
--   contributor  adds files and makes things, which land as drafts for review; edits only their own
--   viewer       browses, searches and downloads
-- Enforced here (so the app, the API and the Claude connector all follow it) with triggers that check
-- the person's role. The server's own writes (service role, no person) are checked in the server code.

-- ---------- roles ----------
alter table public.workspace_members drop constraint if exists workspace_members_role_check;
alter table public.workspace_members add constraint workspace_members_role_check check (role in ('owner', 'admin', 'editor', 'contributor', 'viewer'));
alter table public.workspace_invites drop constraint if exists workspace_invites_role_check;
alter table public.workspace_invites add constraint workspace_invites_role_check check (role in ('admin', 'editor', 'contributor', 'viewer'));

create or replace function public.role_in(ws uuid)
returns text language sql security definer stable set search_path = public as $$
  select m.role from public.workspace_members m where m.workspace_id = ws and m.user_id = auth.uid();
$$;
create or replace function public.is_admin(ws uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select coalesce(public.role_in(ws) in ('owner', 'admin'), false);
$$;
create or replace function public.can_manage(ws uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select coalesce(public.role_in(ws) in ('owner', 'admin', 'editor'), false);
$$;
create or replace function public.can_add(ws uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select coalesce(public.role_in(ws) in ('owner', 'admin', 'editor', 'contributor'), false);
$$;

-- Assets. Viewers can't change anything except the duplicate fingerprint the library fills in as it
-- browses. Contributors' new files are drafts; they change and delete only their own, and can't approve.
create or replace function public.asset_role_guard()
returns trigger language plpgsql as $$
declare r text;
begin
  if auth.uid() is null then return coalesce(new, old); end if;
  r := public.role_in(coalesce(new.workspace_id, old.workspace_id));
  if r is null then return coalesce(new, old); end if; -- row level security already decides
  if r in ('owner', 'admin', 'editor') then return coalesce(new, old); end if;
  if tg_op = 'UPDATE' and (to_jsonb(new) - '{phash,duplicate_of,updated_at}'::text[]) = (to_jsonb(old) - '{phash,duplicate_of,updated_at}'::text[]) then return new; end if;
  if r = 'viewer' then raise exception 'ROLE: Viewers can look and download, not change files. Ask an admin for edit access.'; end if;
  -- contributor
  if tg_op = 'INSERT' then new.status := 'draft'; return new; end if;
  if old.created_by is distinct from auth.uid() then raise exception 'ROLE: Contributors can change only the files they added.'; end if;
  if tg_op = 'UPDATE' and new.status = 'approved' and old.status is distinct from 'approved' then raise exception 'ROLE: An editor approves files. Contributors’ work waits in Review.'; end if;
  return coalesce(new, old);
end $$;
drop trigger if exists assets_00_roles on public.assets;
create trigger assets_00_roles before insert or update or delete on public.assets for each row execute function public.asset_role_guard();

-- Brand kit, collections, sharing: editors and up. Folders: contributors can add (uploading a folder).
create or replace function public.manage_guard()
returns trigger language plpgsql as $$
declare r text;
begin
  if auth.uid() is null then return coalesce(new, old); end if;
  r := public.role_in(coalesce(new.workspace_id, old.workspace_id));
  if r is null or r in ('owner', 'admin', 'editor') then return coalesce(new, old); end if;
  if tg_table_name = 'folders' and tg_op = 'INSERT' and r = 'contributor' then return new; end if;
  raise exception 'ROLE: That needs an editor, admin or owner of this brand.';
end $$;
do $$
declare t text;
begin
  foreach t in array array['brand_kits', 'collections', 'folders', 'shares', 'portals'] loop
    execute format('drop trigger if exists %I on public.%I', t || '_00_roles', t);
    execute format('create trigger %I before insert or update or delete on public.%I for each row execute function public.manage_guard()', t || '_00_roles', t);
  end loop;
end $$;

-- Files in storage: viewers can't upload, replace or delete.
drop policy if exists "assets bucket: members upload" on storage.objects;
create policy "assets bucket: members upload" on storage.objects for insert
  with check (bucket_id = 'assets' and public.can_add(((storage.foldername(name))[1])::uuid));
drop policy if exists "assets bucket: members replace" on storage.objects;
create policy "assets bucket: members replace" on storage.objects for update
  using (bucket_id = 'assets' and public.can_add(((storage.foldername(name))[1])::uuid));
drop policy if exists "assets bucket: members delete" on storage.objects;
create policy "assets bucket: members delete" on storage.objects for delete
  using (bucket_id = 'assets' and public.can_add(((storage.foldername(name))[1])::uuid));

-- People: admins invite and remove (only an owner removes an owner); anyone can leave.
drop policy if exists "invites: owners create" on public.workspace_invites;
drop policy if exists "invites: owners delete" on public.workspace_invites;
drop policy if exists "invites: owners read" on public.workspace_invites;
drop policy if exists "invites: admins create" on public.workspace_invites;
drop policy if exists "invites: admins delete" on public.workspace_invites;
drop policy if exists "invites: admins read" on public.workspace_invites;
create policy "invites: admins create" on public.workspace_invites for insert with check (public.is_admin(workspace_id));
create policy "invites: admins delete" on public.workspace_invites for delete using (public.is_admin(workspace_id));
create policy "invites: admins read" on public.workspace_invites for select using (public.is_admin(workspace_id));
drop policy if exists "members: owners remove" on public.workspace_members;
drop policy if exists "members: admins remove" on public.workspace_members;
create policy "members: admins remove" on public.workspace_members for delete
  using (user_id = auth.uid() or (public.is_admin(workspace_id) and (role <> 'owner' or public.is_owner(workspace_id))));

-- Workspace settings (name, Figma file): admins.
drop policy if exists "workspaces: owners rename" on public.workspaces;
drop policy if exists "workspaces: admins rename" on public.workspaces;
create policy "workspaces: admins rename" on public.workspaces for update using (public.is_admin(id));

-- Change someone's role. Admins manage everyone below owner; only an owner makes or unmakes owners,
-- and a brand always keeps at least one owner.
create or replace function public.set_member_role(p_ws uuid, p_user uuid, p_role text)
returns void language plpgsql security definer set search_path = public as $$
declare cur text;
begin
  if p_role not in ('owner', 'admin', 'editor', 'contributor', 'viewer') then raise exception 'Unknown role'; end if;
  if not public.is_admin(p_ws) then raise exception 'ROLE: Only admins and owners change roles.'; end if;
  select role into cur from public.workspace_members where workspace_id = p_ws and user_id = p_user;
  if cur is null then raise exception 'They aren’t a member of this brand.'; end if;
  if (cur = 'owner' or p_role = 'owner') and not public.is_owner(p_ws) then raise exception 'ROLE: Only an owner can make or change an owner.'; end if;
  if cur = 'owner' and p_role <> 'owner' and (select count(*) from public.workspace_members where workspace_id = p_ws and role = 'owner') < 2 then
    raise exception 'A brand needs at least one owner. Make someone else an owner first.';
  end if;
  update public.workspace_members set role = p_role where workspace_id = p_ws and user_id = p_user;
end $$;
revoke all on function public.set_member_role(uuid, uuid, text) from public, anon;
grant execute on function public.set_member_role(uuid, uuid, text) to authenticated;

-- ---------- audit log ----------
create table if not exists public.audit_log (
  id bigint generated always as identity primary key,
  workspace_id uuid not null references public.workspaces on delete cascade,
  at timestamptz not null default now(),
  actor uuid references auth.users on delete set null,
  actor_email text,
  via text not null default 'app',           -- app (a person in Mise) or mise (the server: Claude connector, feeds, automation)
  action text not null,
  target_type text,
  target_id text,
  target_name text,
  details jsonb not null default '{}'::jsonb
);
create index if not exists audit_ws_at on public.audit_log (workspace_id, at desc);
alter table public.audit_log enable row level security;
drop policy if exists "audit: admins read" on public.audit_log;
create policy "audit: admins read" on public.audit_log for select using (public.is_admin(workspace_id));
-- Written only by the triggers below and the server; nobody can edit or delete entries.

create or replace function public.audit(p_ws uuid, p_action text, p_type text, p_id text, p_name text, p_details jsonb default '{}'::jsonb, p_actor uuid default null)
returns void language plpgsql security definer set search_path = public as $$
declare who uuid := coalesce(auth.uid(), p_actor);
begin
  if p_ws is null or not exists (select 1 from public.workspaces where id = p_ws) then return; end if;
  insert into public.audit_log (workspace_id, actor, actor_email, via, action, target_type, target_id, target_name, details)
  values (p_ws, who, (select email from public.profiles where id = who), case when auth.uid() is null then 'mise' else 'app' end,
          p_action, p_type, p_id, left(p_name, 200), coalesce(p_details, '{}'::jsonb));
end $$;
revoke all on function public.audit(uuid, text, text, text, text, jsonb, uuid) from public, anon, authenticated;
grant execute on function public.audit(uuid, text, text, text, text, jsonb, uuid) to service_role;

create or replace function public.audit_assets()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  -- Product feed syncs log one summary line (feed.synced) instead of a line per product.
  if auth.uid() is null and coalesce(new.origin, old.origin) = 'product_feed' and (tg_op <> 'UPDATE' or new.lifecycle_reason = 'No longer in the product feed' or old.lifecycle_reason = 'No longer in the product feed') then return null; end if;
  if tg_op = 'INSERT' then
    perform public.audit(new.workspace_id, 'asset.added', new.kind, new.id::text, new.name, jsonb_build_object('origin', new.origin, 'status', new.status), new.created_by);
  elsif tg_op = 'DELETE' then
    perform public.audit(old.workspace_id, 'asset.deleted', old.kind, old.id::text, old.name, '{}'::jsonb);
  else
    if new.status is distinct from old.status then
      perform public.audit(new.workspace_id, case when new.status = 'approved' then 'asset.approved' else 'asset.unapproved' end, new.kind, new.id::text, new.name, '{}'::jsonb);
    end if;
    if new.name is distinct from old.name then
      perform public.audit(new.workspace_id, 'asset.renamed', new.kind, new.id::text, new.name, jsonb_build_object('from', old.name));
    end if;
    if new.storage_path is distinct from old.storage_path and old.storage_path is not null then
      perform public.audit(new.workspace_id, 'asset.edited', new.kind, new.id::text, new.name, '{}'::jsonb);
    end if;
    if new.lifecycle is distinct from old.lifecycle then
      perform public.audit(new.workspace_id, 'asset.availability', new.kind, new.id::text, new.name, jsonb_build_object('to', new.lifecycle, 'reason', new.lifecycle_reason));
    end if;
  end if;
  return null;
end $$;
drop trigger if exists assets_audit on public.assets;
create trigger assets_audit after insert or update or delete on public.assets for each row execute function public.audit_assets();

create or replace function public.audit_people()
returns trigger language plpgsql security definer set search_path = public as $$
declare em text;
begin
  if tg_table_name = 'workspace_invites' then
    if tg_op = 'INSERT' then perform public.audit(new.workspace_id, 'member.invited', 'person', new.email, new.email, jsonb_build_object('role', new.role), new.invited_by); end if;
    return null;
  end if;
  select email into em from public.profiles where id = coalesce(new.user_id, old.user_id);
  if tg_op = 'INSERT' then perform public.audit(new.workspace_id, 'member.joined', 'person', new.user_id::text, em, jsonb_build_object('role', new.role), new.user_id);
  elsif tg_op = 'DELETE' then perform public.audit(old.workspace_id, 'member.removed', 'person', old.user_id::text, em, jsonb_build_object('role', old.role));
  elsif new.role is distinct from old.role then perform public.audit(new.workspace_id, 'member.role_changed', 'person', new.user_id::text, em, jsonb_build_object('from', old.role, 'to', new.role));
  end if;
  return null;
end $$;
drop trigger if exists members_audit on public.workspace_members;
create trigger members_audit after insert or update or delete on public.workspace_members for each row execute function public.audit_people();
drop trigger if exists invites_audit on public.workspace_invites;
create trigger invites_audit after insert on public.workspace_invites for each row execute function public.audit_people();

create or replace function public.audit_sharing()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_table_name = 'shares' then
    if tg_op = 'INSERT' then perform public.audit(new.workspace_id, 'share.created', 'share', new.id::text, new.title, jsonb_build_object('kind', new.kind, 'expires_at', new.expires_at, 'files', cardinality(new.asset_ids)), new.created_by);
    elsif tg_op = 'DELETE' then perform public.audit(old.workspace_id, 'share.deleted', 'share', old.id::text, old.title, '{}'::jsonb);
    elsif new.revoked_at is not null and old.revoked_at is null then perform public.audit(new.workspace_id, 'share.turned_off', 'share', new.id::text, new.title, '{}'::jsonb);
    end if;
  else
    if tg_op = 'INSERT' then perform public.audit(new.workspace_id, 'portal.created', 'portal', new.id::text, new.name, jsonb_build_object('access', new.access, 'published', new.published), new.created_by);
    elsif tg_op = 'DELETE' then perform public.audit(old.workspace_id, 'portal.deleted', 'portal', old.id::text, old.name, '{}'::jsonb);
    elsif new.published is distinct from old.published then perform public.audit(new.workspace_id, case when new.published then 'portal.published' else 'portal.unpublished' end, 'portal', new.id::text, new.name, '{}'::jsonb);
    elsif new.access is distinct from old.access then perform public.audit(new.workspace_id, 'portal.access_changed', 'portal', new.id::text, new.name, jsonb_build_object('from', old.access, 'to', new.access));
    end if;
  end if;
  return null;
end $$;
drop trigger if exists shares_audit on public.shares;
create trigger shares_audit after insert or update or delete on public.shares for each row execute function public.audit_sharing();
drop trigger if exists portals_audit on public.portals;
create trigger portals_audit after insert or update or delete on public.portals for each row execute function public.audit_sharing();

create or replace function public.audit_kit()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'UPDATE' and new.status = 'approved' and old.status is distinct from 'approved' then
    perform public.audit(new.workspace_id, 'brand_kit.approved', 'brand_kit', new.workspace_id::text, 'Brand kit', jsonb_build_object('version', new.version), new.approved_by);
  elsif tg_op = 'INSERT' or new.version is distinct from old.version then
    perform public.audit(new.workspace_id, 'brand_kit.saved', 'brand_kit', new.workspace_id::text, 'Brand kit', jsonb_build_object('version', new.version, 'status', new.status), new.updated_by);
  end if;
  return null;
end $$;
drop trigger if exists brand_kits_audit on public.brand_kits;
create trigger brand_kits_audit after insert or update on public.brand_kits for each row execute function public.audit_kit();

create or replace function public.audit_billing()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' or new.plan is distinct from old.plan then
    perform public.audit(new.workspace_id, 'billing.plan_changed', 'billing', new.workspace_id::text, initcap(new.plan), jsonb_build_object('to', new.plan, 'interval', new.interval));
  end if;
  return null;
end $$;
drop trigger if exists billing_audit on public.workspace_billing;
create trigger billing_audit after insert or update on public.workspace_billing for each row execute function public.audit_billing();
