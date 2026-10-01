-- Mise: connections to where a team already keeps images (Box today; more later).
-- Tokens are only ever read by the server (service role): no client policies on purpose.
create table if not exists public.connections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  provider text not null check (provider in ('box', 'dropbox', 'google')),
  account text,
  access_token text not null,
  refresh_token text,
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, provider)
);
alter table public.connections enable row level security;
