-- Emailsy CMS: where each asset came from, draft/approved state, and one brand kit per workspace.

-- ---------- asset origins ----------
-- uploaded      added by a person (upload, paste, drag)
-- product_feed  created from the product feed, keyed by PID
-- generated     created by AI; carries provenance and starts as a draft
alter table public.assets
  add column if not exists origin text not null default 'uploaded',
  add column if not exists status text not null default 'approved',
  add column if not exists provenance jsonb;

alter table public.assets drop constraint if exists assets_origin_check;
alter table public.assets add constraint assets_origin_check check (origin in ('uploaded', 'product_feed', 'generated'));
alter table public.assets drop constraint if exists assets_status_check;
alter table public.assets add constraint assets_status_check check (status in ('draft', 'approved'));

update public.assets set origin = 'product_feed' where kind = 'product' and origin = 'uploaded';

-- Products always come from the feed, even if a client forgets to say so.
create or replace function public.asset_defaults()
returns trigger language plpgsql as $$
begin
  if new.kind = 'product' and new.origin = 'uploaded' then new.origin = 'product_feed'; end if;
  return new;
end $$;
drop trigger if exists assets_defaults on public.assets;
create trigger assets_defaults before insert on public.assets for each row execute function public.asset_defaults();

create index if not exists assets_ws_origin_idx on public.assets (workspace_id, origin, status);

-- ---------- brand kits ----------
create table if not exists public.brand_kits (
  workspace_id uuid primary key references public.workspaces on delete cascade,
  kit jsonb not null default '{}'::jsonb,        -- see lib/brandKit.ts for the shape
  status text not null default 'draft' check (status in ('draft', 'approved')),
  version int not null default 1,
  source jsonb,                                   -- {type: 'website'|'figma'|'manual', url, file_key, at}
  updated_by uuid references auth.users on delete set null,
  updated_at timestamptz not null default now(),
  approved_by uuid references auth.users on delete set null,
  approved_at timestamptz
);

drop trigger if exists brand_kits_touch on public.brand_kits;
create trigger brand_kits_touch before update on public.brand_kits for each row execute function public.touch_updated_at();

alter table public.brand_kits enable row level security;
drop policy if exists "brand kits: members read" on public.brand_kits;
drop policy if exists "brand kits: members add" on public.brand_kits;
drop policy if exists "brand kits: members edit" on public.brand_kits;
create policy "brand kits: members read" on public.brand_kits for select using (public.is_member(workspace_id));
create policy "brand kits: members add" on public.brand_kits for insert with check (public.is_member(workspace_id));
create policy "brand kits: members edit" on public.brand_kits for update using (public.is_member(workspace_id)) with check (public.is_member(workspace_id));

alter publication supabase_realtime add table public.brand_kits;
