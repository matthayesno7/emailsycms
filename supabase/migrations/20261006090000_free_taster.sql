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
