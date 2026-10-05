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
