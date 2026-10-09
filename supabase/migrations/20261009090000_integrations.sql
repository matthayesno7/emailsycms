-- Mise: integrations. Other tools (Bloomreach, a CMS, an email builder) embed the Mise picker and
-- get permanent links to approved assets. Pro and Enterprise. Safe to run more than once.
-- Needs 20261006180000_roles_and_audit.sql first.

-- ---------- integration keys ----------
-- One per tool. The key itself is shown once and stored only as a SHA-256 hash.
-- origins: the sites allowed to embed the picker, e.g. {https://*.bloomreach.com, https://app.exponea.com}.
create table if not exists public.integration_keys (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces on delete cascade,
  name text not null check (char_length(name) between 1 and 60),
  key_prefix text not null,
  key_hash text not null unique,
  origins text[] not null default '{}',
  created_by uuid references auth.users on delete set null,
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  revoked_at timestamptz,
  changed_by uuid references auth.users on delete set null   -- who last turned it off or changed it, for the activity log
);
alter table public.integration_keys add column if not exists changed_by uuid references auth.users on delete set null;
create index if not exists integration_keys_ws on public.integration_keys (workspace_id, created_at desc);
alter table public.integration_keys enable row level security;
grant select on public.integration_keys to authenticated;
-- Admins and owners see their brand's keys (the app reads through the server, which never returns the hash).
drop policy if exists "integration keys: admins read" on public.integration_keys;
create policy "integration keys: admins read" on public.integration_keys for select using (public.is_admin(workspace_id));
-- Created and turned off by the server (service role) after checking role and plan.

-- ---------- permanent asset links ----------
-- An unguessable token per asset, made the first time the asset is picked or its link is copied.
-- app.misedam.com/a/<token>/<name> always serves the current version, and stops when the asset is
-- archived, expires, goes obsolete, is deleted, or the brand leaves Pro.
alter table public.assets add column if not exists public_token text unique;

-- Keys in the activity log.
create or replace function public.audit_integrations()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    perform public.audit(new.workspace_id, 'integration.created', 'integration', new.id::text, new.name, jsonb_build_object('sites', new.origins), new.created_by);
  elsif new.revoked_at is not null and old.revoked_at is null then
    perform public.audit(new.workspace_id, 'integration.turned_off', 'integration', new.id::text, new.name, '{}'::jsonb, new.changed_by);
  elsif new.origins is distinct from old.origins then
    perform public.audit(new.workspace_id, 'integration.changed', 'integration', new.id::text, new.name, jsonb_build_object('sites', new.origins), new.changed_by);
  end if;
  return null;
end $$;
drop trigger if exists integration_keys_audit on public.integration_keys;
create trigger integration_keys_audit after insert or update on public.integration_keys for each row execute function public.audit_integrations();
