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
