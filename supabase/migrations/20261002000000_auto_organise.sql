-- Mise: auto-organising. AI description, tags, colours, text in the image, an on-brand check
-- and product matching on every asset; a queue the server works through; smart collections;
-- near-duplicate flags. Safe to run more than once.

-- ---------- what the AI found (people's edits always win) ----------
alter table public.assets
  add column if not exists description text,
  add column if not exists tags text[] not null default '{}',
  add column if not exists colours text[] not null default '{}',        -- dominant colours, #rrggbb
  add column if not exists colour_names text[] not null default '{}',   -- plain names for search: red, navy, beige…
  add column if not exists text_in_image text,
  add column if not exists on_brand boolean,                             -- null: not checked (no imagery rules yet)
  add column if not exists on_brand_reason text,
  add column if not exists ai jsonb,                                     -- the raw result, model and time
  add column if not exists edited text[] not null default '{}',          -- 'description', 'tags': set by a person, AI won't overwrite
  -- the queue: null = not organised yet (older files, see Settings → Auto-organise)
  add column if not exists ai_status text,
  add column if not exists ai_error text,
  add column if not exists ai_attempts int not null default 0,
  add column if not exists ai_claimed_at timestamptz,
  -- near-duplicates (perceptual hash, worked out in the browser)
  add column if not exists phash text,
  add column if not exists duplicate_of uuid references public.assets on delete set null,
  add column if not exists duplicate_ok boolean not null default false;

alter table public.assets drop constraint if exists assets_ai_status_check;
alter table public.assets add constraint assets_ai_status_check check (ai_status in ('pending', 'processing', 'done', 'failed', 'skipped'));

create index if not exists assets_ai_queue_idx on public.assets (ai_status, created_at desc) where ai_status in ('pending', 'processing');
create index if not exists assets_tags_idx on public.assets using gin (tags);

-- New images, logos and product images join the queue. So does a product when its image arrives or changes.
create or replace function public.asset_ai_queue()
returns trigger language plpgsql as $$
begin
  if new.kind in ('image', 'logo', 'product') and new.storage_path is not null
     and (tg_op = 'INSERT' or new.storage_path is distinct from old.storage_path) then
    new.ai_status = 'pending';
    new.ai_attempts = 0;
    new.ai_error = null;
  end if;
  return new;
end $$;
drop trigger if exists assets_ai_queue on public.assets;
create trigger assets_ai_queue before insert or update of storage_path on public.assets for each row execute function public.asset_ai_queue();

-- The worker takes a few jobs at a time. Newest first, so fresh uploads beat a backfill.
-- Jobs stuck in processing for 5 minutes (a restart mid-job) are picked up again.
create or replace function public.claim_ai_jobs(n int, ws uuid default null)
returns setof public.assets language sql security definer set search_path = public as $$
  update public.assets a set ai_status = 'processing', ai_claimed_at = now(), ai_attempts = a.ai_attempts + 1
  where a.id in (
    select id from public.assets
    where (ai_status = 'pending' or (ai_status = 'processing' and ai_claimed_at < now() - interval '5 minutes'))
      and (ws is null or workspace_id = ws)
    order by created_at desc
    limit n
    for update skip locked
  )
  returning a.*;
$$;
revoke all on function public.claim_ai_jobs(int, uuid) from public, anon, authenticated;
grant execute on function public.claim_ai_jobs(int, uuid) to service_role;

-- ---------- smart collections: saved searches that fill themselves ----------
create table if not exists public.collections (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces on delete cascade,
  name text not null check (char_length(name) between 1 and 60),
  -- {tags: [], match: 'any'|'all', kinds: [], text: '', on_brand: true|false|null, colours: []}
  rules jsonb not null default '{}'::jsonb,
  position int not null default 0,
  created_by uuid references auth.users on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists collections_ws_idx on public.collections (workspace_id, position);
alter table public.collections enable row level security;
drop policy if exists "collections: members read" on public.collections;
drop policy if exists "collections: members add" on public.collections;
drop policy if exists "collections: members edit" on public.collections;
drop policy if exists "collections: members delete" on public.collections;
create policy "collections: members read" on public.collections for select using (public.is_member(workspace_id));
create policy "collections: members add" on public.collections for insert with check (public.is_member(workspace_id));
create policy "collections: members edit" on public.collections for update using (public.is_member(workspace_id));
create policy "collections: members delete" on public.collections for delete using (public.is_member(workspace_id));
