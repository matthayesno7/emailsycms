-- Emailsy: folders, so a brand can organise assets the way they would in Dropbox.
-- One folder per asset (or none). Safe to run more than once.
create table if not exists public.folders (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces on delete cascade,
  name text not null check (char_length(name) between 1 and 60),
  created_by uuid references auth.users on delete set null,
  created_at timestamptz not null default now(),
  unique (workspace_id, name)
);
alter table public.folders enable row level security;
drop policy if exists "folders: members read" on public.folders;
drop policy if exists "folders: members add" on public.folders;
drop policy if exists "folders: members edit" on public.folders;
drop policy if exists "folders: members delete" on public.folders;
create policy "folders: members read" on public.folders for select using (public.is_member(workspace_id));
create policy "folders: members add" on public.folders for insert with check (public.is_member(workspace_id));
create policy "folders: members edit" on public.folders for update using (public.is_member(workspace_id));
create policy "folders: members delete" on public.folders for delete using (public.is_member(workspace_id));

alter table public.assets add column if not exists folder_id uuid references public.folders on delete set null;
create index if not exists assets_folder_idx on public.assets (folder_id);
