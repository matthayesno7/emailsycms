-- Emailsy CMS: initial schema
-- Workspaces (one per brand), members, invites, assets (images, logos, products, blocks),
-- per-user API keys for the Claude connector, and a private storage bucket.

create extension if not exists pgcrypto;

-- ---------- profiles (email lookup for member lists) ----------
create table public.profiles (
  id uuid primary key references auth.users on delete cascade,
  email text not null,
  created_at timestamptz not null default now()
);

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email) values (new.id, lower(new.email))
  on conflict (id) do update set email = excluded.email;
  return new;
end $$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------- workspaces ----------
create table public.workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 60),
  created_by uuid references auth.users on delete set null,
  created_at timestamptz not null default now()
);

create table public.workspace_members (
  workspace_id uuid not null references public.workspaces on delete cascade,
  user_id uuid not null references auth.users on delete cascade,
  role text not null default 'editor' check (role in ('owner', 'editor')),
  created_at timestamptz not null default now(),
  primary key (workspace_id, user_id)
);
create index workspace_members_user_idx on public.workspace_members (user_id);

create table public.workspace_invites (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces on delete cascade,
  email text not null,
  role text not null default 'editor' check (role in ('owner', 'editor')),
  invited_by uuid references auth.users on delete set null,
  created_at timestamptz not null default now(),
  accepted_at timestamptz,
  unique (workspace_id, email)
);

create or replace function public.is_member(ws uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select exists (select 1 from public.workspace_members m where m.workspace_id = ws and m.user_id = auth.uid());
$$;

create or replace function public.is_owner(ws uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select exists (select 1 from public.workspace_members m where m.workspace_id = ws and m.user_id = auth.uid() and m.role = 'owner');
$$;

-- Create a workspace and make the caller its owner.
create or replace function public.create_workspace(ws_name text)
returns public.workspaces language plpgsql security definer set search_path = public as $$
declare w public.workspaces;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  insert into public.workspaces (name, created_by) values (trim(ws_name), auth.uid()) returning * into w;
  insert into public.workspace_members (workspace_id, user_id, role) values (w.id, auth.uid(), 'owner');
  return w;
end $$;

-- Called after sign-in: accept pending invites for this email, and give brand-new
-- users a first workspace so the app never opens empty-handed.
create or replace function public.bootstrap()
returns void language plpgsql security definer set search_path = public as $$
declare uemail text;
begin
  if auth.uid() is null then return; end if;
  select lower(email) into uemail from auth.users where id = auth.uid();
  insert into public.profiles (id, email) values (auth.uid(), uemail) on conflict (id) do nothing;
  insert into public.workspace_members (workspace_id, user_id, role)
    select i.workspace_id, auth.uid(), i.role from public.workspace_invites i
    where lower(i.email) = uemail and i.accepted_at is null
  on conflict do nothing;
  update public.workspace_invites set accepted_at = now()
    where lower(email) = uemail and accepted_at is null;
  if not exists (select 1 from public.workspace_members where user_id = auth.uid()) then
    perform public.create_workspace('My brand');
  end if;
end $$;

-- ---------- assets ----------
create table public.assets (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces on delete cascade,
  kind text not null check (kind in ('image', 'logo', 'product', 'block')),
  name text not null check (char_length(name) between 1 and 120),
  -- original file in the "assets" bucket: <workspace_id>/<uuid>.<ext>
  storage_path text,
  mime text,
  width int,
  height int,
  bytes int,
  focus jsonb,                      -- {x, y} 0..1 focal point for crops
  -- products
  pid text,
  price text,
  link text,
  feed_image text,
  -- blocks
  block_type text,
  fields jsonb not null default '{}'::jsonb,   -- text fields: headline, body, cta, link...
  images jsonb not null default '{}'::jsonb,   -- per image slot: {path, width, height, format, alt, source_asset_id, original_path}
  product_id uuid references public.assets on delete set null,
  figma jsonb,                      -- where Claude placed it: {file_key, node_id, component_key, placed_at}
  created_by uuid references auth.users on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, pid)
);
create index assets_ws_kind_idx on public.assets (workspace_id, kind, created_at desc);

create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$ begin new.updated_at = now(); return new; end $$;
create trigger assets_touch before update on public.assets for each row execute function public.touch_updated_at();

-- ---------- API keys for the Claude connector (MCP) ----------
create table public.api_keys (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  name text not null default 'Claude',
  prefix text not null,              -- first characters, shown in the UI
  key_hash text not null unique,     -- sha256 of the full key; the key itself is never stored
  created_at timestamptz not null default now(),
  last_used_at timestamptz
);

-- ---------- row level security ----------
alter table public.profiles enable row level security;
alter table public.workspaces enable row level security;
alter table public.workspace_members enable row level security;
alter table public.workspace_invites enable row level security;
alter table public.assets enable row level security;
alter table public.api_keys enable row level security;

create policy "profiles: self or teammates" on public.profiles for select using (
  id = auth.uid() or exists (
    select 1 from public.workspace_members a join public.workspace_members b on a.workspace_id = b.workspace_id
    where a.user_id = auth.uid() and b.user_id = profiles.id));

create policy "workspaces: members read" on public.workspaces for select using (public.is_member(id));
create policy "workspaces: owners rename" on public.workspaces for update using (public.is_owner(id));
create policy "workspaces: owners delete" on public.workspaces for delete using (public.is_owner(id));

create policy "members: members read" on public.workspace_members for select using (public.is_member(workspace_id));
create policy "members: owners remove" on public.workspace_members for delete using (public.is_owner(workspace_id) or user_id = auth.uid());

create policy "invites: owners read" on public.workspace_invites for select using (public.is_owner(workspace_id));
create policy "invites: owners create" on public.workspace_invites for insert with check (public.is_owner(workspace_id));
create policy "invites: owners delete" on public.workspace_invites for delete using (public.is_owner(workspace_id));

create policy "assets: members read" on public.assets for select using (public.is_member(workspace_id));
create policy "assets: members add" on public.assets for insert with check (public.is_member(workspace_id));
create policy "assets: members edit" on public.assets for update using (public.is_member(workspace_id)) with check (public.is_member(workspace_id));
create policy "assets: members delete" on public.assets for delete using (public.is_member(workspace_id));

create policy "keys: own read" on public.api_keys for select using (user_id = auth.uid());
create policy "keys: own add" on public.api_keys for insert with check (user_id = auth.uid());
create policy "keys: own delete" on public.api_keys for delete using (user_id = auth.uid());

-- ---------- storage ----------
insert into storage.buckets (id, name, public, file_size_limit)
values ('assets', 'assets', false, 26214400)
on conflict (id) do nothing;

create policy "assets bucket: members read" on storage.objects for select
  using (bucket_id = 'assets' and public.is_member(((storage.foldername(name))[1])::uuid));
create policy "assets bucket: members upload" on storage.objects for insert
  with check (bucket_id = 'assets' and public.is_member(((storage.foldername(name))[1])::uuid));
create policy "assets bucket: members replace" on storage.objects for update
  using (bucket_id = 'assets' and public.is_member(((storage.foldername(name))[1])::uuid));
create policy "assets bucket: members delete" on storage.objects for delete
  using (bucket_id = 'assets' and public.is_member(((storage.foldername(name))[1])::uuid));

-- live updates in the library when a teammate (or Claude) changes something
alter publication supabase_realtime add table public.assets;
