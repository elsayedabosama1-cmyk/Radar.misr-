-- Mirsad provider-neutral PostgreSQL schema for Neon.
-- Review before applying to a new Neon project. Never run the legacy Supabase SQL.
begin;
create extension if not exists pgcrypto;

do $$ begin
  create type public.mirsad_role as enum ('chairman','editor_in_chief','reporter','audience');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.article_status as enum ('draft','submitted_for_review','in_review','changes_requested','approved','scheduled','published','rejected','archived');
exception when duplicate_object then null; end $$;

create table if not exists public.profiles (
  id uuid primary key default gen_random_uuid(),
  auth_user_id text not null unique,
  email text not null default '',
  display_name text not null default '',
  avatar_url text,
  role public.mirsad_role not null default 'audience',
  is_active boolean not null default true,
  suspended_until timestamptz,
  suspension_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint profiles_suspension_reason_len check (char_length(coalesce(suspension_reason,'')) <= 500)
);
create index if not exists profiles_role_active_idx on public.profiles(role,is_active);
create unique index if not exists profiles_single_chairman_idx on public.profiles(role) where role='chairman';

create table if not exists public.articles (
  id uuid primary key default gen_random_uuid(),
  author_id uuid not null references public.profiles(id),
  assigned_to uuid references public.profiles(id),
  title text not null,
  body text not null default '',
  summary text,
  section text,
  governorate text,
  source_name text,
  source_url text,
  image_url text,
  status public.article_status not null default 'draft',
  editor_note text,
  scheduled_at timestamptz,
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version integer not null default 1 check (version > 0),
  constraint articles_title_len check (char_length(title) between 3 and 300),
  constraint articles_body_len check (char_length(body) <= 200000)
);
create index if not exists articles_status_updated_idx on public.articles(status,updated_at desc);
create index if not exists articles_author_idx on public.articles(author_id,updated_at desc);
create index if not exists articles_published_idx on public.articles(published_at desc) where status='published';

create table if not exists public.article_reviews (
  id uuid primary key default gen_random_uuid(),
  article_id uuid not null references public.articles(id) on delete cascade,
  reviewer_id uuid not null references public.profiles(id),
  decision text not null check (decision in ('start_review','approve','request_changes','reject','publish','schedule','archive','restore')),
  note text,
  created_at timestamptz not null default now()
);
create index if not exists article_reviews_article_idx on public.article_reviews(article_id,created_at desc);

create table if not exists public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid references public.profiles(id),
  action text not null,
  entity_type text not null,
  entity_id text,
  before_data jsonb,
  after_data jsonb,
  created_at timestamptz not null default now()
);
create index if not exists audit_logs_created_idx on public.audit_logs(created_at desc);
create index if not exists audit_logs_entity_idx on public.audit_logs(entity_type,entity_id,created_at desc);

create table if not exists public.editorial_tasks (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  details text,
  assigned_to uuid not null references public.profiles(id),
  created_by uuid not null references public.profiles(id),
  priority text not null default 'normal' check(priority in ('low','normal','high','urgent')),
  due_at timestamptz,
  status text not null default 'open' check(status in ('open','in_progress','completed','cancelled')),
  article_id uuid references public.articles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists editorial_tasks_assignee_idx on public.editorial_tasks(assigned_to,status,due_at);

create table if not exists public.internal_notifications (
  id uuid primary key default gen_random_uuid(),
  recipient_id uuid not null references public.profiles(id) on delete cascade,
  title text not null,
  body text,
  event_type text not null,
  entity_type text,
  entity_id text,
  read_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists notifications_recipient_idx on public.internal_notifications(recipient_id,created_at desc);

create table if not exists public.news_sources (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  region text not null check(region in ('local','arabic','international')),
  category text,
  url text not null,
  import_method text not null default 'manual' check(import_method in ('manual','rss','api')),
  active boolean not null default true,
  trust_level smallint not null default 3 check(trust_level between 1 and 5),
  reuse_rights text not null default 'unknown' check(reuse_rights in ('unknown','link_only','licensed','public_domain','permission_required','prohibited')),
  last_checked_at timestamptz,
  last_imported_at timestamptz,
  connection_status text not null default 'unknown' check(connection_status in ('unknown','healthy','warning','failed','disabled')),
  notes text,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists news_sources_active_region_idx on public.news_sources(active,region);

-- The Worker must use a separate login role and must never use the project-owner credential.
do $$ begin
  if not exists (select 1 from pg_roles where rolname='mirsad_app') then
    create role mirsad_app nologin;
  end if;
end $$;
grant usage on schema public to mirsad_app;
grant select,insert on public.profiles to mirsad_app;
grant update(display_name,avatar_url,role,is_active,suspended_until,suspension_reason,updated_at) on public.profiles to mirsad_app;
grant select,insert,update on public.articles to mirsad_app;
grant select,insert on public.article_reviews to mirsad_app;
grant select,insert on public.audit_logs to mirsad_app;
grant select,insert,update on public.editorial_tasks to mirsad_app;
grant select,insert,update on public.internal_notifications to mirsad_app;
grant select,insert,update on public.news_sources to mirsad_app;
-- Application role intentionally has no DELETE privileges.
commit;
