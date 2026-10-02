-- Mise: monthly AI allowances per workspace (cost guards) and in-app feedback. Safe to run more than once.

-- ---------- AI usage: one row per workspace, month and kind ----------
-- kinds: tag (auto-organise), search (plain-English search), design (Studio), kit (brand kit from a website)
create table if not exists public.ai_usage (
  workspace_id uuid not null references public.workspaces on delete cascade,
  month date not null,
  kind text not null,
  used int not null default 0,
  alerted int not null default 0,          -- highest alert sent this month: 0, 80 or 100 (percent)
  updated_at timestamptz not null default now(),
  primary key (workspace_id, month, kind)
);
alter table public.ai_usage enable row level security;
drop policy if exists "ai usage: members read" on public.ai_usage;
create policy "ai usage: members read" on public.ai_usage for select using (public.is_member(workspace_id));

-- Per-workspace overrides, e.g. {"tag": 20000} for a design partner. Set by hand in Supabase.
alter table public.workspaces add column if not exists ai_caps jsonb not null default '{}'::jsonb;

-- Take n from this month's allowance, if there's room. Server only (service role).
-- Returns ok, used (after), cap, and alert: 80 or 100 the first time usage crosses that line this month.
create or replace function public.ai_usage_take(p_ws uuid, p_kind text, p_n int, p_cap int)
returns table (ok boolean, used int, cap int, alert int)
language plpgsql security definer set search_path = public as $$
declare m date := date_trunc('month', now())::date; c int; u int; a int; pct int; newalert int := 0;
begin
  select coalesce(nullif(w.ai_caps->>p_kind, '')::int, p_cap) into c from public.workspaces w where w.id = p_ws;
  if c is null then c := p_cap; end if;
  insert into public.ai_usage (workspace_id, month, kind) values (p_ws, m, p_kind) on conflict do nothing;
  select au.used, au.alerted into u, a from public.ai_usage au where au.workspace_id = p_ws and au.month = m and au.kind = p_kind for update;
  if u + p_n > c then
    if a < 100 then update public.ai_usage set alerted = 100, updated_at = now() where workspace_id = p_ws and month = m and kind = p_kind; newalert := 100; end if;
    return query select false, u, c, newalert; return;
  end if;
  u := u + p_n;
  pct := case when c > 0 then (u * 100) / c else 100 end;
  if pct >= 80 and a < 80 then newalert := 80; end if;
  update public.ai_usage set used = u, alerted = greatest(alerted, newalert), updated_at = now() where workspace_id = p_ws and month = m and kind = p_kind;
  return query select true, u, c, newalert;
end $$;
revoke all on function public.ai_usage_take(uuid, text, int, int) from public, anon, authenticated;

-- ---------- feedback from the app ----------
create table if not exists public.feedback (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users on delete set null,
  email text,
  workspace_id uuid references public.workspaces on delete set null,
  kind text not null default 'idea' check (kind in ('bug', 'idea', 'question', 'praise')),
  message text not null check (char_length(message) between 1 and 4000),
  page text,
  user_agent text,
  created_at timestamptz not null default now()
);
alter table public.feedback enable row level security;
-- Anyone signed in can send feedback; nobody reads it through the app (read it in Supabase).
drop policy if exists "feedback: send" on public.feedback;
create policy "feedback: send" on public.feedback for insert with check (auth.uid() = user_id);
