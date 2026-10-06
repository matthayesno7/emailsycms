-- Mise: Enterprise accounts. One contract covers several brands: owners and admins on the account
-- add brands straight from the app (no checkout), each one on Enterprise, up to the brands agreed.
-- Safe to run more than once. Needs 20261006180000_roles_and_audit.sql first.

create table if not exists public.enterprise_accounts (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  brand_limit int check (brand_limit is null or brand_limit > 0),   -- empty: as many brands as they like
  created_at timestamptz not null default now()
);
alter table public.enterprise_accounts enable row level security;
grant select on public.enterprise_accounts to authenticated;

alter table public.workspace_billing add column if not exists account_id uuid references public.enterprise_accounts on delete set null;
create index if not exists workspace_billing_account on public.workspace_billing (account_id);

-- People in any of the account's brands can see the account's name and how many brands it covers.
drop policy if exists "enterprise: members read" on public.enterprise_accounts;
create policy "enterprise: members read" on public.enterprise_accounts for select
  using (exists (select 1 from public.workspace_billing b where b.account_id = enterprise_accounts.id and public.is_member(b.workspace_id)));

-- The Enterprise account a person can add brands to: one where they own or administer a brand.
-- The brand they're in (p_from) wins when it's on an account.
create or replace function public.brand_account_for(p_user uuid, p_from uuid default null)
returns uuid language sql security definer stable set search_path = public as $$
  select b.account_id
    from public.workspace_billing b
    join public.workspace_members m on m.workspace_id = b.workspace_id and m.user_id = p_user and m.role in ('owner', 'admin')
   where b.account_id is not null and public.plan_of(b.workspace_id) = 'enterprise'
   order by (b.workspace_id = p_from) desc, b.updated_at
   limit 1;
$$;
revoke all on function public.brand_account_for(uuid, uuid) from public, anon, authenticated;

-- Making a brand, for the app (create_workspace) and for Claude (the server calls create_brand_for).
-- On an Enterprise account: the brand joins the account on Enterprise, and the owners and admins of
-- the brand it was made from come along with the same roles. Otherwise one free brand per person;
-- any further brand goes through checkout as Pro.
create or replace function public.create_brand_for(p_user uuid, p_name text, p_from uuid default null)
returns public.workspaces language plpgsql security definer set search_path = public as $$
declare w public.workspaces; acct uuid; lim int; n int;
begin
  if p_user is null then raise exception 'not signed in'; end if;
  acct := public.brand_account_for(p_user, p_from);
  if acct is not null then
    select brand_limit into lim from public.enterprise_accounts where id = acct for update;
    select count(*) into n from public.workspace_billing where account_id = acct;
    if lim is not null and n >= lim then
      raise exception 'BRAND_LIMIT: Your Enterprise plan covers % brands. Book a call to add more.', lim;
    end if;
  elsif exists (select 1 from public.workspace_members m where m.user_id = p_user and m.role = 'owner') then
    raise exception 'FREE_BRAND_LIMIT' using hint = 'Each extra brand is on Pro.';
  end if;

  insert into public.workspaces (name, created_by) values (left(coalesce(nullif(trim(p_name), ''), 'New brand'), 60), p_user) returning * into w;
  if acct is not null then
    insert into public.workspace_billing (workspace_id, plan, subscription_status, account_id) values (w.id, 'enterprise', 'active', acct);
  end if;
  insert into public.workspace_members (workspace_id, user_id, role) values (w.id, p_user, 'owner');
  if acct is not null and p_from is not null and exists (select 1 from public.workspace_billing where workspace_id = p_from and account_id = acct) then
    insert into public.workspace_members (workspace_id, user_id, role)
      select w.id, m.user_id, m.role from public.workspace_members m
       where m.workspace_id = p_from and m.role in ('owner', 'admin') and m.user_id <> p_user
    on conflict do nothing;
  end if;
  return w;
end $$;
revoke all on function public.create_brand_for(uuid, text, uuid) from public, anon, authenticated;
grant execute on function public.create_brand_for(uuid, text, uuid) to service_role;

-- The app's call. (Replaces the one-argument version; a new person's first brand still calls it with a name only.)
drop function if exists public.create_workspace(text);
create or replace function public.create_workspace(ws_name text, from_ws uuid default null)
returns public.workspaces language plpgsql security definer set search_path = public as $$
begin
  return public.create_brand_for(auth.uid(), ws_name, from_ws);
end $$;
grant execute on function public.create_workspace(text, uuid) to authenticated;

-- For Mise staff, in the SQL editor: put a brand on Enterprise and open an account for it.
--   select public.make_enterprise('<brand id>', 'Acme Ltd', 5);     -- 5 brands; null for no limit
-- Another existing brand joins the same account with:
--   select public.make_enterprise('<other brand id>', 'Acme Ltd');   -- matched by the account name
create or replace function public.make_enterprise(p_ws uuid, p_account text, p_brand_limit int default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare acct uuid;
begin
  if not exists (select 1 from public.workspaces where id = p_ws) then raise exception 'No brand with id %', p_ws; end if;
  select id into acct from public.enterprise_accounts where lower(name) = lower(trim(p_account)) limit 1;
  if acct is null then
    insert into public.enterprise_accounts (name, brand_limit) values (trim(p_account), p_brand_limit) returning id into acct;
  elsif p_brand_limit is not null then
    update public.enterprise_accounts set brand_limit = p_brand_limit where id = acct;
  end if;
  insert into public.workspace_billing (workspace_id, plan, subscription_status, account_id)
    values (p_ws, 'enterprise', 'active', acct)
  on conflict (workspace_id) do update set plan = 'enterprise', subscription_status = 'active', account_id = acct, updated_at = now();
  return acct;
end $$;
revoke all on function public.make_enterprise(uuid, text, int) from public, anon, authenticated;
