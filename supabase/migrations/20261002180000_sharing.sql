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
