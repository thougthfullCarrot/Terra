-- Terra — Texas CRE job tracker.
-- Core schema: firms the collector polls, normalized postings, user profiles,
-- server-computed matches, and the two user-owned lists (saved, applications).

create extension if not exists "uuid-ossp";

-- ---------------------------------------------------------------------------
-- Enumerated domains. Kept as check constraints rather than pg enums so the
-- collector can add a sector without a migration lock.
-- ---------------------------------------------------------------------------

create table firms (
  id          bigserial primary key,
  name        text not null unique,
  ats         text not null check (ats in ('greenhouse', 'lever', 'workday', 'icims')),
  ats_slug    text not null,
  -- Workday/iCIMS need a per-tenant host; null for greenhouse/lever.
  ats_host    text,
  active      boolean not null default true,
  -- Seeded slugs are educated guesses until a poll returns a 200 with jobs.
  -- The collector flips this once a fetch succeeds, so an unverified firm list
  -- is visible rather than silently returning nothing.
  slug_verified boolean not null default false,
  last_polled timestamptz,
  last_error  text,
  unique (ats, ats_slug)
);

create table postings (
  id            text primary key,        -- sha1(firm + role + city)
  role          text not null,
  firm          text not null,
  city          text not null check (city in (
                  'Dallas', 'Fort Worth', 'Houston', 'Austin', 'San Antonio', 'El Paso')),
  sector        text not null check (sector in (
                  'Investment', 'Brokerage', 'Development', 'Property Mgmt',
                  'Asset Mgmt', 'Appraisal', 'Capital Markets')),
  kind          text not null check (kind in ('Internship', 'Entry-level')),
  pay           text,                    -- display string: '$24/hr' or '$62-70k'
  deadline      date,
  posted_at     timestamptz not null,
  description   text,
  reqs          text[] not null default '{}',
  apply_url     text not null,
  source        text,                    -- display provenance
  first_seen    timestamptz not null default now(),
  last_seen     timestamptz not null default now(),
  active        boolean not null default true
);

create index postings_city_kind_active_idx on postings (city, kind, active);
create index postings_posted_at_idx on postings (posted_at desc);
create index postings_last_seen_idx on postings (last_seen) where active;

create table profiles (
  id               uuid primary key references auth.users on delete cascade,
  name             text,
  school           text,
  grad_year        int,
  home_city        text,
  skills           text[] not null default '{}',
  sectors          text[] not null default '{}',
  relocation_open  boolean not null default false,
  resume_url       text,
  -- The four toggles on the Profile screen.
  alert_digest     boolean not null default true,
  alert_deadlines  boolean not null default true,
  alert_interns    boolean not null default false,
  alert_market     boolean not null default true,
  push_token       text,
  created_at       timestamptz not null default now()
);

create table matches (
  profile_id uuid not null references profiles on delete cascade,
  posting_id text not null references postings on delete cascade,
  score      int  not null check (score between 0 and 100),
  note       text,                        -- 'Austin · modeling · rising senior'
  lines      text[] not null default '{}',-- 3-4 sentences, rendered verbatim
  scored_at  timestamptz not null default now(),
  primary key (profile_id, posting_id)
);

create index matches_profile_score_idx on matches (profile_id, score desc);

create table applications (
  profile_id uuid not null references profiles on delete cascade,
  posting_id text not null references postings on delete cascade,
  stage      text not null check (stage in ('Applied', 'Interview', 'Offer')),
  note       text,
  updated_at timestamptz not null default now(),
  primary key (profile_id, posting_id)
);

create table saved (
  profile_id uuid not null references profiles on delete cascade,
  posting_id text not null references postings on delete cascade,
  saved_at   timestamptz not null default now(),
  primary key (profile_id, posting_id)
);

-- Market data is maintained by hand each quarter from free brokerage research,
-- one row per tracked city plus a 'Texas' statewide roll-up.
create table markets (
  city       text primary key,
  data       jsonb not null,   -- { trend, dir, summary, stats, sectors, news, hiring }
  quarter    text not null,    -- 'Q3 2026'
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Row level security. Postings and markets are public reads; everything keyed
-- by profile is readable and writable only by its owner. The collector uses the
-- service role, which bypasses RLS.
-- ---------------------------------------------------------------------------

alter table postings   enable row level security;
alter table markets    enable row level security;
alter table profiles   enable row level security;
alter table matches    enable row level security;
alter table applications enable row level security;
alter table saved      enable row level security;
alter table firms      enable row level security;

create policy "postings are public" on postings for select using (true);
create policy "markets are public"  on markets  for select using (true);

create policy "own profile" on profiles
  for all using (auth.uid() = id) with check (auth.uid() = id);

create policy "own matches" on matches
  for select using (auth.uid() = profile_id);

create policy "own applications" on applications
  for all using (auth.uid() = profile_id) with check (auth.uid() = profile_id);

create policy "own saved" on saved
  for all using (auth.uid() = profile_id) with check (auth.uid() = profile_id);

-- firms has no policy: service role only.

create or replace function touch_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger applications_touch before update on applications
  for each row execute function touch_updated_at();
