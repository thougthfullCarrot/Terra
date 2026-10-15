-- Community development reports: members point out a project the map is
-- missing, and they wait in a private review queue until Rod checks them.
--
-- NOT APPLIED YET. This file sits in supabase/pending/ so that merging it does
-- not touch the production database: migrate.yml only runs files added to
-- supabase/migrations/. To launch, move it there (see docs/development-reports.md).
--
-- Who can report: any signed-in account (magic links, so a real inbox). Each
-- account sees only its own reports and their status. Nobody but the service
-- role (the Supabase dashboard) can approve one; only approved reports are
-- visible to everyone, through published_development_reports, without the
-- reporter's id.
--
-- Spam limits, all in the database so a script can't skip them: 5 reports per
-- account per day, length caps, http(s) links only, a pin inside Texas, and a
-- photo only under the reporter's own folder. Duplicates: the same account
-- can't send the same place twice, and a report within about 150 m of (or at
-- the same address as) another open or approved one is marked with that one.
--
-- Safe to run more than once.

create table if not exists public.development_reports (
  id                   uuid primary key default gen_random_uuid(),
  user_id              uuid not null default auth.uid() references auth.users on delete cascade,
  city                 text not null check (char_length(city) between 1 and 40),
  address              text check (char_length(address) between 5 and 200),
  lat                  double precision check (lat between 25.8 and 36.6),
  lng                  double precision check (lng between -106.7 and -93.5),
  name                 text check (char_length(name) between 1 and 120),
  description          text not null check (char_length(description) between 10 and 1000),
  source_url           text check (char_length(source_url) <= 500 and source_url ~* '^https?://[^\s/$.?#][^\s]*$'),
  photo_path           text check (char_length(photo_path) <= 200),
  status               text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'duplicate')),
  review_note          text check (char_length(review_note) <= 500),
  dedupe_key           text not null default '',
  possible_duplicate_of uuid references public.development_reports on delete set null,
  created_at           timestamptz not null default now(),
  reviewed_at          timestamptz,
  constraint development_reports_place check (address is not null or (lat is not null and lng is not null)),
  constraint development_reports_pin_pair check ((lat is null) = (lng is null))
);

create unique index if not exists development_reports_once on public.development_reports (user_id, dedupe_key);
create index if not exists development_reports_queue on public.development_reports (status, created_at);

-- The place a report is about: its address, lowercased and squeezed, else its
-- pin rounded to about 100 m. The same place from the same account is one report.
create or replace function public.development_report_key(p_address text, p_lat double precision, p_lng double precision)
returns text language sql immutable
as $$
  select case
    when nullif(trim(p_address), '') is not null
      then 'a:' || regexp_replace(lower(trim(p_address)), '[^a-z0-9]+', ' ', 'g')
    else 'p:' || round(p_lat::numeric, 3) || ',' || round(p_lng::numeric, 3)
  end
$$;

-- Lookups across every account's reports, which members can't read directly.
create or replace function public.development_reports_today(p_user uuid) returns int
language sql stable security definer
set search_path = public
as $$
  select count(*)::int from development_reports where user_id = p_user and created_at > now() - interval '1 day'
$$;

-- Someone's open or approved report of the same place: the same key, or a pin
-- within about 150 m (0.00135 degrees of latitude, a little more of longitude this far south).
create or replace function public.development_report_match(p_key text, p_lat double precision, p_lng double precision)
returns uuid language sql stable security definer
set search_path = public
as $$
  select id from development_reports r
  where r.status in ('pending', 'approved')
    and (r.dedupe_key = p_key
         or (p_lat is not null and r.lat is not null and abs(r.lat - p_lat) < 0.00135 and abs(r.lng - p_lng) < 0.0016))
  order by r.created_at
  limit 1
$$;
revoke all on function public.development_reports_today(uuid) from public, anon, authenticated;
revoke all on function public.development_report_match(text, double precision, double precision) from public, anon, authenticated;

-- Runs as the caller, so current_user says whether it's a member or the dashboard.
create or replace function public.development_report_before_insert() returns trigger
language plpgsql
set search_path = public
as $$
begin
  if current_user <> 'service_role' and current_user <> 'postgres' then
    if auth.uid() is null then
      raise exception 'Sign in to report a development.' using errcode = '42501';
    end if;
    -- Members can't pick their account, their status or the review.
    new.user_id := auth.uid();
    new.status := 'pending';
    new.review_note := null;
    new.reviewed_at := null;
    if new.photo_path is not null and split_part(new.photo_path, '/', 1) <> auth.uid()::text then
      raise exception 'That photo is not in your own folder.' using errcode = '42501';
    end if;
    if development_reports_today(new.user_id) >= 5 then
      raise exception 'You can send 5 reports a day. Try again tomorrow.' using errcode = 'P0001';
    end if;
  end if;
  new.address := nullif(trim(new.address), '');
  new.name := nullif(trim(new.name), '');
  new.source_url := nullif(trim(new.source_url), '');
  new.description := trim(new.description);
  if new.address is null and (new.lat is null or new.lng is null) then
    raise exception 'Add an address or drop a pin.' using errcode = '23514';
  end if;
  new.dedupe_key := development_report_key(new.address, new.lat, new.lng);
  if exists (select 1 from development_reports r where r.user_id = new.user_id and r.dedupe_key = new.dedupe_key) then
    raise exception 'You already reported this place.' using errcode = '23505';
  end if;
  new.possible_duplicate_of := development_report_match(new.dedupe_key, new.lat, new.lng);
  return new;
end $$;
grant execute on function public.development_reports_today(uuid) to authenticated;
grant execute on function public.development_report_match(text, double precision, double precision) to authenticated;

drop trigger if exists development_reports_before_insert on public.development_reports;
create trigger development_reports_before_insert before insert on public.development_reports
  for each row execute function public.development_report_before_insert();

create or replace function public.development_report_reviewed() returns trigger
language plpgsql
set search_path = public
as $$
begin
  -- One pin per place: approving a second report of a place already on the
  -- map is refused, so the reviewer marks it 'duplicate' instead.
  if new.status = 'approved' and old.status is distinct from 'approved' and exists (
    select 1 from development_reports r
    where r.id <> new.id and r.status = 'approved'
      and (r.dedupe_key = new.dedupe_key
           or (new.lat is not null and r.lat is not null and abs(r.lat - new.lat) < 0.00135 and abs(r.lng - new.lng) < 0.0016))
  ) then
    raise exception 'Another approved report already covers this place; mark this one duplicate.' using errcode = '23505';
  end if;
  if new.status is distinct from old.status then
    new.reviewed_at := case when new.status = 'pending' then null else now() end;
  end if;
  return new;
end $$;

drop trigger if exists development_reports_reviewed on public.development_reports;
create trigger development_reports_reviewed before update on public.development_reports
  for each row execute function public.development_report_reviewed();

alter table public.development_reports enable row level security;
revoke all on public.development_reports from anon, authenticated;
grant select, insert on public.development_reports to authenticated;
grant all on public.development_reports to service_role;

drop policy if exists "reports: read own" on public.development_reports;
create policy "reports: read own" on public.development_reports for select to authenticated
  using (user_id = auth.uid());
drop policy if exists "reports: add own" on public.development_reports;
create policy "reports: add own" on public.development_reports for insert to authenticated
  with check (user_id = auth.uid());
-- No update or delete policy: members can't change a report once sent.

-- What the map shows: approved reports only, never who sent them. The view runs
-- as its owner, so it reads past the table's row security on purpose.
create or replace view public.published_development_reports as
  select id, city, name, description, address, lat, lng, source_url, reviewed_at as verified_at
  from public.development_reports
  where status = 'approved';
revoke all on public.published_development_reports from anon, authenticated;
grant select on public.published_development_reports to anon, authenticated;

-- Photos: private, images up to 5 MB, under '<user id>/...'. Members upload and
-- see their own; Rod sees them in the dashboard. Published pins show no photo.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('development-report-photos', 'development-report-photos', false, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

drop policy if exists "report photos: read own" on storage.objects;
create policy "report photos: read own" on storage.objects for select to authenticated
  using (bucket_id = 'development-report-photos' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists "report photos: add own" on storage.objects;
create policy "report photos: add own" on storage.objects for insert to authenticated
  with check (bucket_id = 'development-report-photos' and (storage.foldername(name))[1] = auth.uid()::text);
