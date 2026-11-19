-- Idempotent offline draft synchronization foundation.
begin;
alter table public.articles add column if not exists external_key text;
create unique index if not exists articles_author_external_key_uq
  on public.articles(author_id, external_key) where external_key is not null;
create table if not exists public.sync_receipts (
  actor_id uuid not null references public.profiles(id) on delete cascade,
  operation_id text not null,
  operation_kind text not null,
  result jsonb not null,
  created_at timestamptz not null default now(),
  primary key(actor_id, operation_id),
  constraint sync_receipts_operation_id_len check(char_length(operation_id) between 1 and 180)
);
create index if not exists sync_receipts_created_idx on public.sync_receipts(created_at);
grant select,insert on public.sync_receipts to mirsad_app;
grant update(external_key) on public.articles to mirsad_app;
commit;
