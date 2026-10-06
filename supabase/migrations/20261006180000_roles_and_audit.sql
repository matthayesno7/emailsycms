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
