-- =====================================================================
-- CHAT SETUP. Run ONCE in Supabase: SQL Editor > New query > paste > Run.
-- Safe to run again. It does not touch your existing data.
-- =====================================================================
alter table public.schools add column if not exists chat_private boolean not null default true;

create table if not exists public.chat_threads (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('school','private')),
  school_a uuid references public.schools on delete cascade,
  school_b uuid references public.schools on delete cascade,
  user_a uuid references auth.users on delete cascade,
  user_b uuid references auth.users on delete cascade,
  created_at timestamptz not null default now());
alter table public.chat_threads drop constraint if exists chat_threads_kind_check;
alter table public.chat_threads add constraint chat_threads_kind_check check (kind in ('school','private','global'));
create unique index if not exists chat_global_uq on public.chat_threads (kind) where kind = 'global';
create unique index if not exists chat_school_pair_uq on public.chat_threads (school_a, school_b) where kind = 'school';
create unique index if not exists chat_private_pair_uq on public.chat_threads (user_a, user_b) where kind = 'private';

create table if not exists public.chat_messages (
  id bigint generated always as identity primary key,
  thread_id uuid not null references public.chat_threads on delete cascade,
  sender uuid not null references auth.users on delete cascade,
  sender_name text not null,
  sender_school uuid references public.schools on delete set null,
  body text not null check (char_length(body) between 1 and 1000),
  hidden boolean not null default false,
  created_at timestamptz not null default now());
create index if not exists chat_messages_thread_idx on public.chat_messages (thread_id, id);

create table if not exists public.chat_reports (
  id bigint generated always as identity primary key,
  message_id bigint not null references public.chat_messages on delete cascade,
  thread_id uuid,
  reporter uuid references auth.users on delete set null,
  reporter_school uuid,
  reason text,
  created_at timestamptz not null default now());
create unique index if not exists chat_reports_uq on public.chat_reports (message_id, reporter);

alter table public.chat_threads enable row level security;
alter table public.chat_messages enable row level security;
alter table public.chat_reports enable row level security;

-- helper functions ----------------------------------------------------
create or replace function public.chat_can_read(t uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from chat_threads th where th.id = t and (
      public.my_role() = 'platform_admin'
      or (th.kind = 'global' and coalesce(public.my_role(), '') in ('school_admin', 'cadet'))
      or (th.kind = 'school' and public.my_school() in (th.school_a, th.school_b))
      or (th.kind = 'private' and (
            auth.uid() in (th.user_a, th.user_b)
            or (public.my_role() = 'school_admin' and public.my_school() in (th.school_a, th.school_b))))
    ))
$$;

create or replace function public.chat_name(u uuid) returns text
language sql stable security definer set search_path = public as $$
  select coalesce(nullif(c.full_name, ''), nullif(s.oc_name, ''), 'School administrator')
  from profiles p left join cadets c on c.id = p.cadet_id left join schools s on s.id = p.school_id
  where p.id = u
$$;

create or replace function public.chat_person(u uuid) returns text
language sql stable security definer set search_path = public as $$
  select public.chat_name(u) || ' (' || coalesce(nullif(s.abbreviation, ''), s.name, '') || ')'
  from profiles p left join schools s on s.id = p.school_id where p.id = u
$$;

-- who can I talk to at another school (names and roles only, nothing private)
create or replace function public.chat_dir(p_school uuid)
returns table (profile_id uuid, person_name text, label text)
language sql stable security definer set search_path = public as $$
  select p.id, public.chat_name(p.id),
         case when p.role = 'school_admin' then 'Administrator' else coalesce(nullif(c.rank, ''), 'Cadet') end
  from profiles p left join cadets c on c.id = p.cadet_id
  where p.school_id = p_school and p.role in ('school_admin', 'cadet')
    and coalesce(public.my_role(), '') in ('school_admin', 'cadet')
    and exists (select 1 from schools s where s.id = p_school and s.active)
  order by (p.role = 'school_admin') desc, 2
$$;

create or replace function public.chat_my_threads()
returns table (thread_id uuid, kind text, title text, subtitle text, last_body text, last_at timestamptz, oversight boolean)
language sql stable security definer set search_path = public as $$
  select th.id, th.kind,
    case when th.kind = 'global' then 'All schools'
         when th.kind = 'school' then
           (select s.name from schools s where s.id = case when th.school_a = public.my_school() then th.school_b else th.school_a end)
         when auth.uid() = th.user_a then public.chat_person(th.user_b)
         when auth.uid() = th.user_b then public.chat_person(th.user_a)
         else public.chat_person(th.user_a) || ' and ' || public.chat_person(th.user_b) end,
    case when th.kind = 'global' then 'Everyone on the platform'
         when th.kind = 'school' then 'School channel'
         when auth.uid() in (th.user_a, th.user_b) then 'Private chat'
         else 'Monitoring' end,
    lm.body, coalesce(lm.created_at, th.created_at),
    (th.kind = 'private' and auth.uid() not in (th.user_a, th.user_b))
  from chat_threads th
  left join lateral (select m.body, m.created_at from chat_messages m
                     where m.thread_id = th.id and not m.hidden order by m.id desc limit 1) lm on true
  where coalesce(public.my_role(), '') in ('school_admin', 'cadet') and public.chat_can_read(th.id)
  order by 6 desc
$$;

create or replace function public.chat_open_global() returns uuid
language plpgsql security definer set search_path = public as $$
declare tid uuid;
begin
  if coalesce(public.my_role(), '') not in ('school_admin', 'cadet') or public.my_school() is null then raise exception 'You cannot use chat.'; end if;
  select id into tid from chat_threads where kind = 'global';
  if tid is null then insert into chat_threads (kind) values ('global') returning id into tid; end if;
  return tid;
end $$;

create or replace function public.chat_open_school(p_other uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare mys uuid := public.my_school(); a uuid; b uuid; tid uuid;
begin
  if coalesce(public.my_role(), '') not in ('school_admin', 'cadet') or mys is null then raise exception 'You cannot use chat.'; end if;
  if p_other = mys then raise exception 'Choose a different school.'; end if;
  if not exists (select 1 from schools where id = p_other and active) then raise exception 'That school is not available.'; end if;
  a := least(mys, p_other); b := greatest(mys, p_other);
  select id into tid from chat_threads where kind = 'school' and school_a = a and school_b = b;
  if tid is null then
    insert into chat_threads (kind, school_a, school_b) values ('school', a, b) returning id into tid;
  end if;
  return tid;
end $$;

create or replace function public.chat_open_private(p_user uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); mys uuid := public.my_school(); theirs uuid; ua uuid; ub uuid; sa uuid; sb2 uuid; tid uuid;
begin
  if coalesce(public.my_role(), '') not in ('school_admin', 'cadet') or mys is null then raise exception 'You cannot use chat.'; end if;
  if p_user = me then raise exception 'Choose someone else.'; end if;
  select school_id into theirs from profiles where id = p_user and role in ('school_admin', 'cadet');
  if theirs is null or not exists (select 1 from schools where id = theirs and active) then raise exception 'That person is not available.'; end if;
  if theirs <> mys and exists (select 1 from schools where id in (mys, theirs) and not chat_private) then
    raise exception 'Private chat is turned off for one of the schools.';
  end if;
  if me < p_user then ua := me; ub := p_user; sa := mys; sb2 := theirs; else ua := p_user; ub := me; sa := theirs; sb2 := mys; end if;
  select id into tid from chat_threads where kind = 'private' and user_a = ua and user_b = ub;
  if tid is null then
    insert into chat_threads (kind, school_a, school_b, user_a, user_b) values ('private', sa, sb2, ua, ub) returning id into tid;
  end if;
  return tid;
end $$;

create or replace function public.chat_send(p_thread uuid, p_body text) returns bigint
language plpgsql security definer set search_path = public as $$
declare th chat_threads%rowtype; me uuid := auth.uid(); mys uuid := public.my_school(); txt text := btrim(coalesce(p_body, '')); mid bigint;
begin
  if coalesce(public.my_role(), '') not in ('school_admin', 'cadet') or mys is null then raise exception 'You cannot use chat.'; end if;
  if char_length(txt) < 1 or char_length(txt) > 1000 then raise exception 'Write a message of 1 to 1000 characters.'; end if;
  select * into th from chat_threads where id = p_thread;
  if not found then raise exception 'Conversation not found.'; end if;
  if th.kind = 'school' then
    if mys not in (th.school_a, th.school_b) then raise exception 'You are not part of this conversation.'; end if;
  elsif th.kind = 'private' then
    if me not in (th.user_a, th.user_b) then raise exception 'You are not part of this conversation.'; end if;
    if th.school_a <> th.school_b and exists (select 1 from schools where id in (th.school_a, th.school_b) and not chat_private) then
      raise exception 'Private chat is turned off for one of the schools.';
    end if;
  end if;
  if (select count(*) from chat_messages where sender = me and created_at > now() - interval '1 minute') >= 20 then
    raise exception 'You are sending messages too fast. Please wait a moment.';
  end if;
  insert into chat_messages (thread_id, sender, sender_name, sender_school, body)
  values (p_thread, me, public.chat_name(me), mys, txt) returning id into mid;
  return mid;
end $$;

create or replace function public.chat_hide(p_message bigint) returns void
language plpgsql security definer set search_path = public as $$
declare t uuid; s uuid; k text;
begin
  if coalesce(public.my_role(), '') not in ('school_admin', 'platform_admin') then raise exception 'Only administrators can remove messages.'; end if;
  select m.thread_id, m.sender_school, th.kind into t, s, k
  from chat_messages m join chat_threads th on th.id = m.thread_id where m.id = p_message;
  if t is null or not public.chat_can_read(t) then raise exception 'Message not found.'; end if;
  if k = 'global' and public.my_role() = 'school_admin' and s is distinct from public.my_school() then
    raise exception 'You can only remove messages sent by people from your own school.';
  end if;
  update chat_messages set hidden = true where id = p_message;
end $$;

create or replace function public.chat_report(p_message bigint, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
declare t uuid;
begin
  if coalesce(public.my_role(), '') not in ('school_admin', 'cadet') then raise exception 'You cannot use chat.'; end if;
  select thread_id into t from chat_messages where id = p_message;
  if t is null or not public.chat_can_read(t) then raise exception 'Message not found.'; end if;
  insert into chat_reports (message_id, thread_id, reporter, reporter_school, reason)
  values (p_message, t, auth.uid(), public.my_school(), left(coalesce(p_reason, ''), 300))
  on conflict (message_id, reporter) do nothing;
end $$;

create or replace function public.chat_reports_list()
returns table (report_id bigint, message_id bigint, thread_id uuid, sender_name text, body text, hidden boolean, reason text, created_at timestamptz)
language sql stable security definer set search_path = public as $$
  select r.id, r.message_id, r.thread_id, m.sender_name, m.body, m.hidden, r.reason, r.created_at
  from chat_reports r join chat_messages m on m.id = r.message_id
  where coalesce(public.my_role(), '') in ('school_admin', 'platform_admin')
    and (public.my_role() = 'platform_admin' or r.reporter_school = public.my_school() or m.sender_school = public.my_school())
  order by r.id desc limit 50
$$;

-- security rules -------------------------------------------------------
drop policy if exists chat_threads_read on public.chat_threads;
create policy chat_threads_read on public.chat_threads for select to authenticated using (public.chat_can_read(id));
drop policy if exists chat_messages_read on public.chat_messages;
create policy chat_messages_read on public.chat_messages for select to authenticated
  using (public.chat_can_read(thread_id) and (not hidden or public.my_role() in ('school_admin', 'platform_admin')));

revoke all on public.chat_threads, public.chat_messages, public.chat_reports from anon, authenticated;
grant select on public.chat_threads, public.chat_messages to authenticated;
grant all on public.chat_threads, public.chat_messages, public.chat_reports to service_role;

do $$
declare f text;
begin
  foreach f in array array['chat_can_read(uuid)', 'chat_dir(uuid)', 'chat_my_threads()', 'chat_open_global()', 'chat_open_school(uuid)', 'chat_open_private(uuid)',
                           'chat_send(uuid,text)', 'chat_hide(bigint)', 'chat_report(bigint,text)', 'chat_reports_list()'] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
  foreach f in array array['chat_person(uuid)', 'chat_name(uuid)'] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
  end loop;
end $$;

notify pgrst, 'reload schema';
