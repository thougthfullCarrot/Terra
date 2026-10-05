-- The website's application tracker: the jobs a member saved or applied to,
-- with where each one stands, a note and a follow-up date. Kept per account,
-- so it follows the member to any device.
--
-- `job` keeps the posting's title, firm, city and links as they were when it
-- was tracked, so an application still reads properly after the posting
-- leaves the boards. (0001's `applications` and `saved` tables reference the
-- app's `postings` table, which the website doesn't fill, so they can't be
-- reused here.)
--
-- Safe to run more than once.

create table if not exists tracked_jobs (
  user_id    uuid not null references auth.users on delete cascade,
  job_id     text not null,
  stage      text not null default 'Saved'
             check (stage in ('Saved', 'Applied', 'Interviewing', 'Offer', 'Not selected')),
  note       text check (char_length(note) <= 2000),
  follow_up  date,
  job        jsonb not null default '{}',
  -- The Texas date the morning email last reminded the member about this job (Job alerts workflow).
  reminded_on date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, job_id)
);

create index if not exists tracked_jobs_follow_up_idx on tracked_jobs (follow_up) where follow_up is not null;

drop trigger if exists tracked_jobs_touch on tracked_jobs;
create trigger tracked_jobs_touch before update on tracked_jobs
  for each row execute function touch_updated_at();

alter table tracked_jobs enable row level security;

-- Members only, like the feed: a lapsed subscriber can still see and remove
-- what they tracked, but not add to it.
drop policy if exists "own tracker: read" on tracked_jobs;
create policy "own tracker: read" on tracked_jobs
  for select using (auth.uid() = user_id);
drop policy if exists "own tracker: remove" on tracked_jobs;
create policy "own tracker: remove" on tracked_jobs
  for delete using (auth.uid() = user_id);
drop policy if exists "own tracker: add" on tracked_jobs;
create policy "own tracker: add" on tracked_jobs
  for insert with check (auth.uid() = user_id and public.access_level() in ('college', 'subscriber'));
drop policy if exists "own tracker: change" on tracked_jobs;
create policy "own tracker: change" on tracked_jobs
  for update using (auth.uid() = user_id)
  with check (auth.uid() = user_id and public.access_level() in ('college', 'subscriber'));
