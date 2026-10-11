-- TERRA Pro watchlists: follow markets, project areas and single projects,
-- and get a daily or weekly email of what changed.
--
-- NOT APPLIED YET. This file sits in supabase/pending/ so that merging it does
-- not touch the production database: migrate.yml only runs files added to
-- supabase/migrations/. To launch, move it there (see docs/watchlists.md).
--
-- Who can use it: the same members who see the feed, through access_level()
-- in migration 0005 ('college' for a confirmed .edu address, 'subscriber'
-- for an active subscription). College members get it free.
--
-- Private beta: until private.watch_settings.private_beta is set to false,
-- only accounts listed in private.watch_testers can read, add or change
-- watchlist items or get digests. Both tables sit in the private schema,
-- which members and visitors cannot read, so no tester id is ever public.
-- Testers are added by hand in the SQL editor (docs/watchlists.md).
--
-- Safe to run more than once.

create extension if not exists pgcrypto with schema extensions;

-- ---------------------------------------------------------------------------
-- Digest settings on the profile. Off until the member turns it on.
-- ---------------------------------------------------------------------------

alter table profiles add column if not exists watch_emails boolean not null default false;
alter table profiles add column if not exists digest_frequency text not null default 'weekly';
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'profiles_digest_frequency_check') then
    alter table profiles add constraint profiles_digest_frequency_check check (digest_frequency in ('daily', 'weekly'));
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Private beta: the switch and the tester list. Service role and the
-- database owner only. The beta starts on.
-- ---------------------------------------------------------------------------

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create table if not exists private.watch_settings (
  id           int primary key default 1 check (id = 1),
  private_beta boolean not null default true
);
insert into private.watch_settings (id) values (1) on conflict (id) do nothing;

create table if not exists private.watch_testers (
  user_id  uuid primary key references auth.users on delete cascade,
  added_at timestamptz not null default now()
);

-- Whether one account may use watchlists right now. Not callable by members.
create or replace function private.watch_open_to(p_user uuid) returns boolean
language sql stable security definer
set search_path = private
as $$
  select p_user is not null and (
    not coalesce((select private_beta from private.watch_settings where id = 1), true)
    or exists (select 1 from private.watch_testers where user_id = p_user)
  )
$$;
revoke execute on function private.watch_open_to(uuid) from public, anon, authenticated;

-- The signed-in member's own answer, for the row policies and the site.
-- Takes no argument, so it cannot be used to ask about anyone else.
create or replace function public.watch_beta_access() returns boolean
language sql stable security definer
set search_path = private
as $$
  select private.watch_open_to(auth.uid())
$$;
revoke execute on function public.watch_beta_access() from public, anon;
grant execute on function public.watch_beta_access() to authenticated;

-- ---------------------------------------------------------------------------
-- Watched items. kind:
--   market  - a city's market figures; ref is one metric key or '' for all,
--             filters may hold {"above": n} or {"below": n} for that metric
--   area    - new project filings in a city; filters may hold
--             {"work": ["New construction", ...], "minCost": n}
--   project - one project; ref is its TABS project number
-- ---------------------------------------------------------------------------

create table if not exists watchlist_items (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null default auth.uid() references auth.users on delete cascade,
  kind       text not null check (kind in ('market', 'area', 'project')),
  city       text not null check (char_length(city) between 1 and 40),
  ref        text not null default '' check (char_length(ref) <= 60),
  filters    jsonb not null default '{}'::jsonb
             check (jsonb_typeof(filters) = 'object' and octet_length(filters::text) <= 1000),
  created_at timestamptz not null default now(),
  unique (user_id, kind, city, ref)
);

create index if not exists watchlist_items_user_idx on watchlist_items (user_id);

-- At most 25 items per member. The advisory lock makes two adds at once
-- count one after the other, so neither can slip past the limit.
create or replace function public.watchlist_limit() returns trigger
language plpgsql security definer
set search_path = public
as $$
begin
  perform pg_advisory_xact_lock(hashtext('watchlist:' || new.user_id::text));
  if (select count(*) from public.watchlist_items where user_id = new.user_id) >= 25 then
    raise exception 'You can follow up to 25 items. Remove one to add another.'
      using errcode = 'check_violation', hint = 'watchlist_limit';
  end if;
  return new;
end;
$$;

drop trigger if exists watchlist_items_limit on watchlist_items;
create trigger watchlist_items_limit before insert on watchlist_items
  for each row execute function public.watchlist_limit();

alter table watchlist_items enable row level security;

-- Like the tracker (0008): a lapsed subscriber can still see and remove
-- items, but not add or change them. During the private beta every policy
-- also requires a listed tester. Signed-out visitors match no policy.
drop policy if exists "own watchlist: read" on watchlist_items;
create policy "own watchlist: read" on watchlist_items
  for select to authenticated using (auth.uid() = user_id and public.watch_beta_access());
drop policy if exists "own watchlist: remove" on watchlist_items;
create policy "own watchlist: remove" on watchlist_items
  for delete to authenticated using (auth.uid() = user_id and public.watch_beta_access());
drop policy if exists "own watchlist: add" on watchlist_items;
create policy "own watchlist: add" on watchlist_items
  for insert to authenticated with check (auth.uid() = user_id and public.watch_beta_access() and public.access_level() in ('college', 'subscriber'));
drop policy if exists "own watchlist: change" on watchlist_items;
create policy "own watchlist: change" on watchlist_items
  for update to authenticated using (auth.uid() = user_id and public.watch_beta_access())
  with check (auth.uid() = user_id and public.watch_beta_access() and public.access_level() in ('college', 'subscriber'));

-- ---------------------------------------------------------------------------
-- What each member was sent, one row per change. state:
--   pending - claimed by a run and handed to the mail server; whether it
--             arrived is not known until the run marks it sent
--   sent    - the mail server accepted the email
--   failed  - gave up after the retry limit
-- Written by the Job alerts workflow with the service role.
-- ---------------------------------------------------------------------------

create table if not exists watch_sends (
  user_id    uuid not null references auth.users on delete cascade,
  event_id   text not null check (char_length(event_id) <= 200),
  state      text not null default 'pending' check (state in ('pending', 'sent', 'failed')),
  attempts   int  not null default 0,
  last_error text check (char_length(last_error) <= 300),
  updated_at timestamptz not null default now(),
  sent_at    timestamptz,
  primary key (user_id, event_id)
);

create index if not exists watch_sends_updated_idx on watch_sends (updated_at);

alter table watch_sends enable row level security;
drop policy if exists "own watch history" on watch_sends;
create policy "own watch history" on watch_sends
  for select to authenticated using (auth.uid() = user_id and public.watch_beta_access());

-- The day each member's last digest went out, so the next one covers
-- everything since. Service role only.
create table if not exists watch_digests (
  user_id  uuid primary key references auth.users on delete cascade,
  last_day date not null
);
alter table watch_digests enable row level security;

-- ---------------------------------------------------------------------------
-- A compact copy of each day's market file, for spotting changes. Kept 90
-- days by the Website workflow. No policies: service role only.
-- ---------------------------------------------------------------------------

create table if not exists market_history (
  day        date primary key,
  data       jsonb not null,
  created_at timestamptz not null default now()
);
alter table market_history enable row level security;

-- ---------------------------------------------------------------------------
-- Who gets a watch digest: members with it on, a confirmed address, at least
-- one watched item, and access (mirrors alert_recipients() in 0007).
-- ---------------------------------------------------------------------------

create or replace function public.watch_recipients()
returns table (
  user_id          uuid,
  email            text,
  digest_frequency text,
  last_day         date,
  items            jsonb
)
language sql stable security definer
set search_path = public, auth, private
as $$
  select u.id, u.email, p.digest_frequency, d.last_day,
         (select jsonb_agg(jsonb_build_object('id', w.id, 'kind', w.kind, 'city', w.city, 'ref', w.ref, 'filters', w.filters)
                           order by w.created_at)
          from public.watchlist_items w where w.user_id = u.id)
  from auth.users u
  join public.profiles p on p.id = u.id
  left join public.watch_digests d on d.user_id = u.id
  where p.watch_emails
    and u.email_confirmed_at is not null
    and coalesce(u.raw_app_meta_data->>'terra_test_user', 'false') <> 'true'
    and exists (select 1 from public.watchlist_items w where w.user_id = u.id)
    and private.watch_open_to(u.id)
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

revoke execute on function public.watch_recipients() from public, anon, authenticated;
grant execute on function public.watch_recipients() to service_role;

-- ---------------------------------------------------------------------------
-- One-click unsubscribe. Each email carries a link with an HMAC of the
-- member's id and the kind of email ('jobs' or 'watch'), signed with a
-- random key that never leaves the database except to the sender (service
-- role). The link works without signing in, and only turns emails off.
-- ---------------------------------------------------------------------------

create table if not exists private.alert_link_secret (
  id     int primary key default 1 check (id = 1),
  secret bytea not null default extensions.gen_random_bytes(32)
);
insert into private.alert_link_secret (id) values (1) on conflict (id) do nothing;

create or replace function public.alert_link_secret() returns text
language sql stable security definer
set search_path = private
as $$
  select encode(secret, 'hex') from private.alert_link_secret where id = 1
$$;
revoke execute on function public.alert_link_secret() from public, anon, authenticated;
grant execute on function public.alert_link_secret() to service_role;

create or replace function public.unsubscribe_alerts(p_user uuid, p_scope text, p_token text) returns boolean
language plpgsql security definer
set search_path = public, private
as $$
declare
  expected text;
begin
  if p_user is null or p_scope not in ('jobs', 'watch') or p_token is null then
    return false;
  end if;
  select encode(extensions.hmac(convert_to(p_user::text || ':' || p_scope, 'UTF8'), secret, 'sha256'), 'hex')
    into expected from private.alert_link_secret where id = 1;
  if expected is null or lower(p_token) <> expected then
    return false;
  end if;
  if p_scope = 'jobs' then
    update public.profiles set email_alerts = false where id = p_user;
  else
    update public.profiles set watch_emails = false where id = p_user;
  end if;
  return true;
end;
$$;
revoke execute on function public.unsubscribe_alerts(uuid, text, text) from public;
grant execute on function public.unsubscribe_alerts(uuid, text, text) to anon, authenticated;
