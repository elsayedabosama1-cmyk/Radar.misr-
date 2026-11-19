begin;
create extension if not exists pgcrypto;
do $$ begin create type public.mirsad_role as enum ('chairman','editor_in_chief','reporter','audience'); exception when duplicate_object then null; end $$;
do $$ begin create type public.article_status as enum ('draft','submitted_for_review','in_review','changes_requested','approved','scheduled','published','rejected','archived'); exception when duplicate_object then null; end $$;

create table if not exists public.profiles (
 user_id uuid primary key references auth.users(id) on delete cascade,
 display_name text not null default '', avatar_url text,
 role public.mirsad_role not null default 'audience',
 is_active boolean not null default true, suspended_until timestamptz, suspension_reason text,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create or replace function public.touch_updated_at() returns trigger language plpgsql set search_path=public
as $$ begin new.updated_at=now(); return new; end $$;
drop trigger if exists profiles_touch_updated_at on public.profiles;
create trigger profiles_touch_updated_at before update on public.profiles for each row execute function public.touch_updated_at();

create or replace function public.create_audience_profile() returns trigger language plpgsql security definer set search_path=public
as $$ begin
 insert into public.profiles(user_id,display_name,role) values(new.id,coalesce(new.raw_user_meta_data->>'name',''),'audience')
 on conflict(user_id) do nothing; return new;
end $$;
drop trigger if exists on_auth_user_created_mirsad on auth.users;
create trigger on_auth_user_created_mirsad after insert on auth.users for each row execute function public.create_audience_profile();

create or replace function public.current_profile_role() returns public.mirsad_role
language sql stable security definer set search_path=public
as $$ select role from public.profiles where user_id=auth.uid() and is_active and (suspended_until is null or suspended_until<=now()) $$;
create or replace function public.is_chairman() returns boolean language sql stable security definer set search_path=public
as $$ select coalesce(public.current_profile_role()='chairman',false) $$;
create or replace function public.is_editorial_lead() returns boolean language sql stable security definer set search_path=public
as $$ select coalesce(public.current_profile_role() in ('chairman','editor_in_chief'),false) $$;
create or replace function public.is_staff() returns boolean language sql stable security definer set search_path=public
as $$ select coalesce(public.current_profile_role() in ('chairman','editor_in_chief','reporter'),false) $$;

create table if not exists public.articles (
 id uuid primary key default gen_random_uuid(), author_id uuid not null references public.profiles(user_id),
 assigned_to uuid references public.profiles(user_id), title text not null, body text not null default '',
 summary text, section text, governorate text, source_name text, source_url text, image_url text,
 status public.article_status not null default 'draft', editor_note text, scheduled_at timestamptz, published_at timestamptz,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(), version integer not null default 1
);
create index if not exists articles_status_updated_idx on public.articles(status,updated_at desc);
create index if not exists articles_author_idx on public.articles(author_id,updated_at desc);
drop trigger if exists articles_touch_updated_at on public.articles;
create trigger articles_touch_updated_at before update on public.articles for each row execute function public.touch_updated_at();

create table if not exists public.article_reviews (
 id uuid primary key default gen_random_uuid(), article_id uuid not null references public.articles(id) on delete cascade,
 reviewer_id uuid not null references public.profiles(user_id),
 decision text not null check(decision in ('start_review','approve','request_changes','reject','publish','archive')),
 note text, created_at timestamptz not null default now()
);
create index if not exists article_reviews_article_idx on public.article_reviews(article_id,created_at desc);

create table if not exists public.audit_logs (
 id bigint generated always as identity primary key, actor_id uuid references public.profiles(user_id),
 action text not null, entity_type text not null, entity_id text, before_data jsonb, after_data jsonb, created_at timestamptz not null default now()
);
create index if not exists audit_logs_created_idx on public.audit_logs(created_at desc);
create or replace function public.audit_article_changes() returns trigger language plpgsql security definer set search_path=public
as $$ begin
 insert into public.audit_logs(actor_id,action,entity_type,entity_id,before_data,after_data)
 values(auth.uid(),lower(tg_op),'article',coalesce(new.id,old.id)::text,
 case when tg_op='INSERT' then null else to_jsonb(old) end,
 case when tg_op='DELETE' then null else to_jsonb(new) end);
 if tg_op='DELETE' then return old; else return new; end if;
end $$;
drop trigger if exists articles_audit on public.articles;
create trigger articles_audit after insert or update or delete on public.articles for each row execute function public.audit_article_changes();

create or replace function public.audit_profile_security_changes() returns trigger language plpgsql security definer set search_path=public
as $profile_audit$ begin
 if old.role is distinct from new.role or old.is_active is distinct from new.is_active
    or old.suspended_until is distinct from new.suspended_until
    or old.suspension_reason is distinct from new.suspension_reason then
  insert into public.audit_logs(actor_id,action,entity_type,entity_id,before_data,after_data)
  values(auth.uid(),'update','profile',new.user_id::text,
   jsonb_build_object('role',old.role,'is_active',old.is_active,'suspended_until',old.suspended_until,'suspension_reason',old.suspension_reason),
   jsonb_build_object('role',new.role,'is_active',new.is_active,'suspended_until',new.suspended_until,'suspension_reason',new.suspension_reason));
 end if;
 return new;
end $profile_audit$;
drop trigger if exists profiles_security_audit on public.profiles;
create trigger profiles_security_audit after update on public.profiles
for each row execute function public.audit_profile_security_changes();


create table if not exists public.editorial_tasks (
 id uuid primary key default gen_random_uuid(), title text not null, details text,
 assigned_to uuid not null references public.profiles(user_id), created_by uuid not null references public.profiles(user_id),
 priority text not null default 'normal' check(priority in ('low','normal','high','urgent')),
 due_at timestamptz, status text not null default 'open' check(status in ('open','in_progress','completed','cancelled')),
 article_id uuid references public.articles(id) on delete set null, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index if not exists editorial_tasks_assignee_idx on public.editorial_tasks(assigned_to,status,due_at);
create table if not exists public.internal_notifications (
 id uuid primary key default gen_random_uuid(), recipient_id uuid not null references public.profiles(user_id) on delete cascade,
 title text not null, body text, event_type text not null, entity_type text, entity_id text, read_at timestamptz, created_at timestamptz not null default now()
);
create index if not exists internal_notifications_recipient_idx on public.internal_notifications(recipient_id,created_at desc);

alter table public.profiles enable row level security;
alter table public.articles enable row level security;
alter table public.article_reviews enable row level security;
alter table public.audit_logs enable row level security;
alter table public.editorial_tasks enable row level security;
alter table public.internal_notifications enable row level security;

revoke all on public.profiles from anon,authenticated;
grant select on public.profiles to authenticated;
grant update(display_name,avatar_url) on public.profiles to authenticated;
create policy profiles_read_self_or_editors on public.profiles for select to authenticated
using(user_id=auth.uid() or public.is_editorial_lead());
create policy profiles_update_own_display on public.profiles for update to authenticated
using(user_id=auth.uid()) with check(user_id=auth.uid());

revoke all on public.articles from anon,authenticated;
grant select on public.articles to anon,authenticated;
create policy articles_public_read on public.articles for select to anon,authenticated
using(status='published' and published_at is not null and published_at<=now());
create policy articles_staff_read on public.articles for select to authenticated using(public.is_staff());
create policy articles_author_read_own on public.articles for select to authenticated using(author_id=auth.uid());

revoke all on public.article_reviews from anon,authenticated;
grant select on public.article_reviews to authenticated;
create policy article_reviews_read on public.article_reviews for select to authenticated
using(public.is_editorial_lead() or exists(select 1 from public.articles a where a.id=article_id and a.author_id=auth.uid()));
revoke all on public.audit_logs from anon,authenticated;
grant select on public.audit_logs to authenticated;
create policy audit_logs_chairman_read on public.audit_logs for select to authenticated using(public.is_chairman());
revoke all on public.editorial_tasks from anon,authenticated;
grant select on public.editorial_tasks to authenticated;
create policy tasks_read on public.editorial_tasks for select to authenticated
using(public.is_editorial_lead() or assigned_to=auth.uid() or created_by=auth.uid());
revoke all on public.internal_notifications from anon,authenticated;
grant select on public.internal_notifications to authenticated;
create policy notifications_read_own on public.internal_notifications for select to authenticated using(recipient_id=auth.uid());

create or replace function public.create_article(p_title text,p_body text default '',p_section text default null,
 p_governorate text default null,p_source_name text default null,p_source_url text default null,p_image_url text default null)
returns uuid language plpgsql security definer set search_path=public as $$
declare v_id uuid;
begin
 if coalesce(public.current_profile_role()::text,'') not in ('chairman','editor_in_chief','reporter') then raise exception 'staff access required' using errcode='42501'; end if;
 if length(trim(coalesce(p_title,'')))<5 then raise exception 'title is too short'; end if;
 insert into public.articles(author_id,title,body,section,governorate,source_name,source_url,image_url)
 values(auth.uid(),trim(p_title),coalesce(p_body,''),p_section,p_governorate,p_source_name,p_source_url,p_image_url) returning id into v_id;
 return v_id;
end $$;

create or replace function public.save_article_draft(p_article_id uuid,p_title text,p_body text,p_section text default null,
 p_governorate text default null,p_source_name text default null,p_source_url text default null,p_image_url text default null)
returns void language plpgsql security definer set search_path=public as $$
declare a public.articles%rowtype;
begin
 select * into a from public.articles where id=p_article_id for update;
 if not found then raise exception 'article not found'; end if;
 if not (public.is_editorial_lead() or (a.author_id=auth.uid() and public.current_profile_role()='reporter')) then raise exception 'not allowed' using errcode='42501'; end if;
 if a.status not in ('draft','changes_requested') then raise exception 'only drafts or returned articles can be edited'; end if;
 if length(trim(coalesce(p_title,'')))<5 then raise exception 'title is too short'; end if;
 update public.articles set title=trim(p_title),body=coalesce(p_body,''),section=p_section,governorate=p_governorate,
 source_name=p_source_name,source_url=p_source_url,image_url=p_image_url,status='draft',editor_note=null,version=version+1 where id=p_article_id;
end $$;

create or replace function public.submit_article(p_article_id uuid) returns void language plpgsql security definer set search_path=public as $$
declare a public.articles%rowtype;
begin
 select * into a from public.articles where id=p_article_id for update;
 if not found then raise exception 'article not found'; end if;
 if not (public.is_editorial_lead() or (a.author_id=auth.uid() and public.current_profile_role()='reporter')) then raise exception 'not allowed' using errcode='42501'; end if;
 if a.status not in ('draft','changes_requested') then raise exception 'invalid article state'; end if;
 update public.articles set status='submitted_for_review',editor_note=null,version=version+1 where id=p_article_id;
 insert into public.article_reviews(article_id,reviewer_id,decision) values(p_article_id,auth.uid(),'start_review');
end $$;

create or replace function public.editorial_decision(p_article_id uuid,p_decision text,p_note text default null,p_scheduled_at timestamptz default null)
returns void language plpgsql security definer set search_path=public as $$
declare a public.articles%rowtype; v_status public.article_status;
begin
 if not public.is_editorial_lead() then raise exception 'editorial lead required' using errcode='42501'; end if;
 select * into a from public.articles where id=p_article_id for update;
 if not found then raise exception 'article not found'; end if;
 if p_decision='start_review' then
  if a.status not in ('submitted_for_review','in_review') then raise exception 'article is not awaiting review'; end if;
  v_status='in_review';
 elsif p_decision='approve' then v_status='approved';
 elsif p_decision='request_changes' then v_status='changes_requested';
 elsif p_decision='reject' then v_status='rejected';
 elsif p_decision='publish' then
  if a.status not in ('approved','scheduled','published') then raise exception 'article must be approved before publishing'; end if;
  if p_scheduled_at is not null and p_scheduled_at>now() then v_status='scheduled'; else v_status='published'; end if;
 elsif p_decision='archive' then v_status='archived';
 else raise exception 'unsupported editorial decision'; end if;
 update public.articles set status=v_status,editor_note=p_note,
 scheduled_at=case when v_status='scheduled' then p_scheduled_at else null end,
 published_at=case when v_status='published' then coalesce(published_at,now()) else null end,
 version=version+1 where id=p_article_id;
 insert into public.article_reviews(article_id,reviewer_id,decision,note) values(p_article_id,auth.uid(),p_decision,p_note);
end $$;

create or replace function public.set_profile_status(p_user_id uuid,p_active boolean,p_until timestamptz default null,p_reason text default null)
returns void language plpgsql security definer set search_path=public as $$
declare target public.profiles%rowtype;
begin
 if not public.is_chairman() then raise exception 'chairman required' using errcode='42501'; end if;
 select * into target from public.profiles where user_id=p_user_id for update;
 if not found then raise exception 'profile not found'; end if;
 if target.role='chairman' and (not p_active or (p_until is not null and p_until>now())) and
 (select count(*) from public.profiles where role='chairman' and is_active and (suspended_until is null or suspended_until<=now()))<=1
 then raise exception 'cannot suspend the last active chairman'; end if;
 update public.profiles set is_active=p_active,suspended_until=p_until,suspension_reason=p_reason where user_id=p_user_id;
end $$;

create or replace function public.set_profile_role(p_user_id uuid,p_role public.mirsad_role)
returns void language plpgsql security definer set search_path=public as $$
declare target public.profiles%rowtype;
begin
 if not public.is_chairman() then raise exception 'chairman required' using errcode='42501'; end if;
 select * into target from public.profiles where user_id=p_user_id for update;
 if not found then raise exception 'profile not found'; end if;
 if target.role='chairman' and p_role<>'chairman' and
 (select count(*) from public.profiles where role='chairman' and is_active and (suspended_until is null or suspended_until<=now()))<=1
 then raise exception 'cannot demote the last active chairman'; end if;
 update public.profiles set role=p_role where user_id=p_user_id;
end $$;

revoke all on function public.create_article(text,text,text,text,text,text,text) from public;
revoke all on function public.save_article_draft(uuid,text,text,text,text,text,text,text) from public;
revoke all on function public.submit_article(uuid) from public;
revoke all on function public.editorial_decision(uuid,text,text,timestamptz) from public;
revoke all on function public.set_profile_status(uuid,boolean,timestamptz,text) from public;
revoke all on function public.set_profile_role(uuid,public.mirsad_role) from public;
grant execute on function public.create_article(text,text,text,text,text,text,text) to authenticated;
grant execute on function public.save_article_draft(uuid,text,text,text,text,text,text,text) to authenticated;
grant execute on function public.submit_article(uuid) to authenticated;
grant execute on function public.editorial_decision(uuid,text,text,timestamptz) to authenticated;
grant execute on function public.set_profile_status(uuid,boolean,timestamptz,text) to authenticated;
grant execute on function public.set_profile_role(uuid,public.mirsad_role) to authenticated;

create or replace function public.publish_due_articles()
returns integer language plpgsql security definer set search_path=public as $publish_due$
declare v_count integer;
begin
 update public.articles set status='published',published_at=coalesce(published_at,now()),version=version+1
 where status='scheduled' and scheduled_at is not null and scheduled_at<=now();
 get diagnostics v_count = row_count;
 return v_count;
end $publish_due$;
revoke all on function public.publish_due_articles() from public,anon,authenticated;
grant execute on function public.publish_due_articles() to service_role;
commit;
