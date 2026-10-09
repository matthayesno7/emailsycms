-- Mise: Create boards. A board is a canvas where people make and edit with AI: the files they start
-- from, everything made from them, and the conversation. The files themselves live in the library as
-- usual (AI results as drafts in Review); a board only remembers what's on it and where.
-- Safe to run more than once. Needs 20261006180000_roles_and_audit.sql first.

create table if not exists public.boards (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces on delete cascade,
  name text not null default 'Untitled board' check (char_length(name) between 1 and 120),
  items jsonb not null default '[]'::jsonb,    -- [{ id, asset_id?, x, y, w, pending?, error? }]
  thread jsonb not null default '[]'::jsonb,   -- [{ id, role: 'you'|'mise', text, at, refs?, made? }]
  created_by uuid references auth.users on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists boards_ws on public.boards (workspace_id, updated_at desc);
alter table public.boards enable row level security;
grant select, insert, update, delete on public.boards to authenticated;

-- Everyone in the brand can see its boards; people who can add files can make and change them;
-- the person who made a board, or an editor and up, can delete it.
drop policy if exists "boards: members read" on public.boards;
create policy "boards: members read" on public.boards for select using (public.is_member(workspace_id));
drop policy if exists "boards: adders create" on public.boards;
create policy "boards: adders create" on public.boards for insert with check (public.can_add(workspace_id) and created_by = auth.uid());
drop policy if exists "boards: adders change" on public.boards;
create policy "boards: adders change" on public.boards for update using (public.can_add(workspace_id)) with check (public.can_add(workspace_id));
drop policy if exists "boards: owner or editors delete" on public.boards;
create policy "boards: owner or editors delete" on public.boards for delete using (created_by = auth.uid() or public.can_manage(workspace_id));
