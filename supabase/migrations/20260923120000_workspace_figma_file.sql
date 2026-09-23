-- Emailsy CMS: a default Figma file per workspace, so Claude knows where to put things.
alter table public.workspaces
  add column if not exists figma_file_url text,
  add column if not exists figma_file_key text,
  add column if not exists figma_file_name text;
