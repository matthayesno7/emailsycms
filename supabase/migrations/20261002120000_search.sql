-- Mise: AI search. Each asset gets an embedding (Voyage) of what auto-organise found, plus a
-- full-text index on the same words. search_assets() blends the two and applies filters.
-- Safe to run more than once.

create extension if not exists vector with schema extensions;

-- ---------- full text: name, tags and colours count most, then descriptions, then text in the image ----------
create or replace function public.asset_tsv(name text, tags text[], colour_names text[], description text, fields jsonb, text_in_image text, pid text)
returns tsvector language sql immutable as $$
  select setweight(to_tsvector('english', regexp_replace(coalesce(name, ''), '[_\-.]+', ' ', 'g')), 'A')
      || setweight(to_tsvector('english', array_to_string(coalesce(tags, '{}'), ' ') || ' ' || array_to_string(coalesce(colour_names, '{}'), ' ')), 'A')
      || setweight(to_tsvector('english', coalesce(description, '') || ' ' || coalesce(fields->>'description', '') || ' ' || coalesce(fields->>'alt', '')), 'B')
      || setweight(to_tsvector('simple', coalesce(text_in_image, '') || ' ' || coalesce(pid, '')), 'C')
$$;

alter table public.assets drop column if exists search;
alter table public.assets add column search tsvector
  generated always as (public.asset_tsv(name, tags, colour_names, description, fields, text_in_image, pid)) stored;
create index if not exists assets_search_idx on public.assets using gin (search);

-- ---------- embeddings ----------
-- Kept in their own table so loading the library (and live updates) never ships the vectors.
create table if not exists public.asset_embeddings (
  asset_id uuid primary key references public.assets on delete cascade,
  workspace_id uuid not null references public.workspaces on delete cascade,
  embedding extensions.vector(1024) not null,
  model text,
  updated_at timestamptz not null default now()
);
create index if not exists asset_embeddings_hnsw_idx on public.asset_embeddings using hnsw (embedding extensions.vector_cosine_ops);
create index if not exists asset_embeddings_ws_idx on public.asset_embeddings (workspace_id);
alter table public.asset_embeddings enable row level security;
-- Members can search (read); only the server writes.
drop policy if exists "embeddings: members read" on public.asset_embeddings;
create policy "embeddings: members read" on public.asset_embeddings for select using (public.is_member(workspace_id));

alter table public.assets add column if not exists embed_pending boolean not null default true;
update public.assets set embed_pending = false where kind = 'block';
create index if not exists assets_embed_queue_idx on public.assets (updated_at) where embed_pending;

-- Re-embed whenever the searchable words change (a person's edit, or auto-organise finishing).
create or replace function public.asset_embed_stale()
returns trigger language plpgsql as $$
begin
  if new.kind <> 'block' and (
       new.name is distinct from old.name or new.description is distinct from old.description
    or new.tags is distinct from old.tags or new.text_in_image is distinct from old.text_in_image
    or new.colour_names is distinct from old.colour_names or new.kind is distinct from old.kind
    or (new.fields->>'description') is distinct from (old.fields->>'description')) then
    new.embed_pending = true;
  end if;
  return new;
end $$;
drop trigger if exists assets_embed_stale on public.assets;
create trigger assets_embed_stale before update on public.assets for each row execute function public.asset_embed_stale();

-- ---------- hybrid search ----------
-- Full-text and vector results are each ranked, then blended with reciprocal rank fusion.
-- Runs as the caller, so row level security limits it to the caller's workspaces.
drop function if exists public.search_assets(uuid[], text, extensions.vector, text[], text[], text, uuid[], boolean, text, text, int);
create or replace function public.search_assets(
  p_ws uuid[],
  p_q text default null,
  p_emb extensions.vector(1024) default null,
  p_kinds text[] default null,
  p_colours text[] default null,
  p_orientation text default null,          -- landscape | portrait | square
  p_folders uuid[] default null,
  p_on_brand boolean default null,
  p_origin text default null,
  p_status text default null,
  p_n int default 60)
returns table (id uuid, score float8, fts_rank int, vec_rank int, similarity float8)
language sql stable set search_path = public, extensions as $$
  with base as (
    select a.id, a.search, a.created_at from public.assets a
    where a.workspace_id = any(p_ws) and a.kind <> 'block'
      and (p_kinds is null or a.kind = any(p_kinds))
      and (p_colours is null or a.colour_names && p_colours)
      and (p_folders is null or a.folder_id = any(p_folders))
      and (p_on_brand is null or a.on_brand = p_on_brand)
      and (p_origin is null or a.origin = p_origin)
      and (p_status is null or a.status = p_status)
      and (p_orientation is null or (a.width > 0 and a.height > 0 and case p_orientation
            when 'landscape' then a.width > a.height * 1.1
            when 'portrait' then a.height > a.width * 1.1
            else abs(a.width - a.height) <= greatest(a.width, a.height) * 0.1 end))
  ),
  -- Any of the words, ranked by how many match and how important the field is.
  tsq as (
    select case when coalesce(trim(p_q), '') = '' then null
      else nullif(replace(plainto_tsquery('english', p_q)::text, ' & ', ' | '), '')::tsquery end as query
  ),
  fts as (
    select b.id, row_number() over (order by ts_rank_cd(b.search, t.query, 1) desc) as r
    from base b, tsq t where t.query is not null and b.search @@ t.query
    order by r limit 200
  ),
  vec as (
    select b.id, row_number() over (order by e.embedding <=> p_emb) as r, 1 - (e.embedding <=> p_emb) as sim
    from base b join public.asset_embeddings e on e.asset_id = b.id
    where p_emb is not null
    order by e.embedding <=> p_emb limit 200
  ),
  blended as (
    select coalesce(f.id, v.id) as id,
           -- meaning counts a little more than shared keywords
           (coalesce(0.8 / (60 + f.r), 0) + coalesce(1.0 / (60 + v.r), 0))::float8 as score,
           f.r::int as fts_rank, v.r::int as vec_rank, v.sim::float8 as similarity
    from fts f full join vec v on f.id = v.id
  ),
  -- Filters only, no words: newest first.
  filtered as (
    select b.id, 0::float8, null::int, null::int, null::float8 from base b
    where coalesce(trim(p_q), '') = '' and p_emb is null
    order by b.created_at desc limit p_n
  )
  select * from (select * from blended order by score desc limit p_n) x
  union all
  select * from filtered;
$$;
