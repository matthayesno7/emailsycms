-- Mise: files made on a Create board stay on the board until someone saves them.
-- on_board = true: the file exists (so the board can show it and work on it again) but it isn't in
-- the library, Review, search, sharing or the Claude connector yet. Saving sets it to false.
alter table public.assets add column if not exists on_board boolean not null default false;
create index if not exists assets_on_board_idx on public.assets (workspace_id) where on_board;
