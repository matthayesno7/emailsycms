-- Emailsy CMS: videos as a kind of asset (made with Claude via Figma motion or a video model).
-- Safe to run more than once.
alter table public.assets drop constraint if exists assets_kind_check;
alter table public.assets add constraint assets_kind_check check (kind in ('image', 'logo', 'video', 'product', 'block'));

-- Videos are bigger than images: raise the bucket's per-file limit to 100 MB.
update storage.buckets set file_size_limit = 104857600 where id = 'assets';
