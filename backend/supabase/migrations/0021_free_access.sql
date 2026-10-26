-- TERRA is free for everyone (Rod, 2026-10-26): any signed-in account with a
-- confirmed email gets full access. No college email, subscription or payment.
--
-- Parked in pending/ so merging the PR does NOT apply it: migrate.yml only runs
-- files added to supabase/migrations/. To launch, move it there once Rod
-- approves. Rollback: supabase/rollback/0021_free_access_rollback.sql.
--
-- What changes:
--   * access_level() returns 'member' for any confirmed address. 'college' and
--     'subscriber' still come back first for those accounts, so nothing that
--     reads the label breaks, and subscriptions are left exactly as they are.
--     An unconfirmed address gets 'none' whatever its subscription (before,
--     an active subscription opened an unconfirmed account).
--   * free_access_version() exists so site.yml can check, before deploying,
--     that this migration ran (the free-access gate). It reveals nothing.
--   * The policies that checked ('college', 'subscriber') also accept 'member'.
--   * Alert and watch-digest recipients drop the college/subscriber test; they
--     still need a confirmed address and the member's own opt-in.
-- What doesn't: sign-in still proves the address (email code), an unconfirmed
-- account still sees nothing, signed-out visitors still see nothing, and every
-- per-user table keeps its own-rows-only policies. Stripe is untouched.

create or replace function public.access_level() returns text
language sql stable security definer
set search_path = public, auth
as $$
  select case
    -- No confirmed address, no access: not even an active or trialing subscription opens it.
    when u.email_confirmed_at is null then 'none'
    when public.is_college_email(u.email) then 'college'
    when exists (
      select 1 from public.subscriptions s
      where s.user_id = u.id
        and s.status in ('active', 'trialing')
        and (s.current_period_end is null or s.current_period_end > now())
    ) then 'subscriber'
    else 'member'
  end
  from auth.users u
  where u.id = auth.uid()
$$;

revoke execute on function public.access_level() from public, anon;
grant execute on function public.access_level() to authenticated;

drop policy if exists "members read the feed" on site_snapshots;
create policy "members read the feed" on site_snapshots
  for select to authenticated
  using (public.access_level() in ('college', 'subscriber', 'member'));

drop policy if exists "own tracker: add" on tracked_jobs;
create policy "own tracker: add" on tracked_jobs
  for insert with check (auth.uid() = user_id and public.access_level() in ('college', 'subscriber', 'member'));
drop policy if exists "own tracker: change" on tracked_jobs;
create policy "own tracker: change" on tracked_jobs
  for update using (auth.uid() = user_id)
  with check (auth.uid() = user_id and public.access_level() in ('college', 'subscriber', 'member'));

drop policy if exists "own watchlist: add" on watchlist_items;
create policy "own watchlist: add" on watchlist_items
  for insert to authenticated with check (auth.uid() = user_id and public.watch_beta_access() and public.access_level() in ('college', 'subscriber', 'member'));
drop policy if exists "own watchlist: change" on watchlist_items;
create policy "own watchlist: change" on watchlist_items
  for update to authenticated using (auth.uid() = user_id and public.watch_beta_access())
  with check (auth.uid() = user_id and public.watch_beta_access() and public.access_level() in ('college', 'subscriber', 'member'));

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
$$;


revoke execute on function public.alert_recipients() from public, anon, authenticated;
grant execute on function public.alert_recipients() to service_role;

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
$$;


revoke execute on function public.watch_recipients() from public, anon, authenticated;
grant execute on function public.watch_recipients() to service_role;

-- The deploy gate's marker (site.yml "Free-access gate"): the site's free-access
-- pages publish only once this answers 21.
create or replace function public.free_access_version() returns int
language sql immutable as $$ select 21 $$;
grant execute on function public.free_access_version() to anon, authenticated;
