-- Daily job alerts by email, for members (college emails and subscribers).
--
-- A member turns alerts on in their profile and picks which cities and role
-- types they want; with a resume on file they can also ask for good matches
-- only. Every morning the Job alerts workflow (alerts.yml) reads the feed,
-- sends each member the new jobs that fit, and logs what it sent here so the
-- same job is never sent twice.
--
-- Safe to run more than once.

alter table profiles add column if not exists email_alerts     boolean not null default false;
-- Empty means every city / every role type.
alter table profiles add column if not exists alert_cities     text[]  not null default '{}';
alter table profiles add column if not exists alert_kinds      text[]  not null default '{}';
-- Only jobs scoring at least this against the resume; 0 sends every new job that passes the filters.
alter table profiles add column if not exists alert_min_match  int     not null default 0
  check (alert_min_match between 0 and 100);

create table if not exists alert_sends (
  user_id uuid not null references auth.users on delete cascade,
  job_id  text not null,
  sent_at timestamptz not null default now(),
  primary key (user_id, job_id)
);

create index if not exists alert_sends_sent_at_idx on alert_sends (sent_at);

-- Written by the workflow with the service role only; members can see their own history.
alter table alert_sends enable row level security;
drop policy if exists "own alert history" on alert_sends;
create policy "own alert history" on alert_sends
  for select using (auth.uid() = user_id);

-- Who gets an alert today: members with alerts on and a confirmed address.
-- Mirrors access_level() so a lapsed subscription stops the emails, and skips
-- the test accounts (src/testUsers), whose addresses are made up.
create or replace function public.alert_recipients()
returns table (
  user_id         uuid,
  email           text,
  school          text,
  grad_year       int,
  home_city       text,
  sectors         text[],
  relocation_open boolean,
  resume_text     text,
  alert_cities    text[],
  alert_kinds     text[],
  alert_min_match int
)
language sql stable security definer
set search_path = public, auth
as $$
  select u.id, u.email, p.school, p.grad_year, p.home_city, p.sectors, p.relocation_open,
         p.resume_text, p.alert_cities, p.alert_kinds, p.alert_min_match
  from auth.users u
  join public.profiles p on p.id = u.id
  where p.email_alerts
    and u.email_confirmed_at is not null
    and coalesce(u.raw_app_meta_data->>'terra_test_user', 'false') <> 'true'
    and (
      public.is_college_email(u.email)
      or exists (
        select 1 from public.subscriptions s
        where s.user_id = u.id
          and s.status in ('active', 'trialing')
          and (s.current_period_end is null or s.current_period_end > now())
      )
    )
$$;

-- Service role only: it returns other people's email addresses.
revoke execute on function public.alert_recipients() from public, anon, authenticated;
grant execute on function public.alert_recipients() to service_role;
