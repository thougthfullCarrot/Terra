-- Website accounts: who may see the job feed.
--
-- Anyone can sign in with a magic link, which proves they own the address.
-- A confirmed college (.edu) address gets the feed free; any other address
-- needs an active Stripe subscription, which the stripe-webhook edge function
-- records in `subscriptions`. The feed itself lives in `site_snapshots`, which
-- the Website workflow writes with the service role and only those two kinds
-- of user can read, so the gate holds even against someone calling the API
-- directly rather than using the site.

-- True for addresses at a .edu domain or subdomain (jane@utexas.edu,
-- jane@mail.utexas.edu); false for look-alikes such as jane@edu.com.
create or replace function public.is_college_email(email text) returns boolean
language sql immutable as $$
  select coalesce(split_part(lower(trim(email)), '@', 2) ~ '(^|\.)edu$', false)
$$;

create table subscriptions (
  user_id                uuid primary key references auth.users on delete cascade,
  stripe_customer_id     text not null unique,
  stripe_subscription_id text not null unique,
  -- Stripe's own status string: active, trialing, past_due, canceled, ...
  status                 text not null,
  current_period_end     timestamptz,
  updated_at             timestamptz not null default now()
);

create trigger subscriptions_touch before update on subscriptions
  for each row execute function touch_updated_at();

alter table subscriptions enable row level security;

-- Users can see their own billing state; only the webhook (service role) writes.
create policy "own subscription" on subscriptions
  for select using (auth.uid() = user_id);

-- 'college', 'subscriber' or 'none' for the signed-in user; null when signed out.
-- security definer so it can read auth.users for the confirmed address.
create or replace function public.access_level() returns text
language sql stable security definer
set search_path = public, auth
as $$
  select case
    when u.email_confirmed_at is not null and public.is_college_email(u.email) then 'college'
    when exists (
      select 1 from public.subscriptions s
      where s.user_id = u.id
        and s.status in ('active', 'trialing')
        and (s.current_period_end is null or s.current_period_end > now())
    ) then 'subscriber'
    else 'none'
  end
  from auth.users u
  where u.id = auth.uid()
$$;

revoke execute on function public.access_level() from public, anon;
grant execute on function public.access_level() to authenticated;

-- The website's feed, one row ('current') replaced on every build.
create table site_snapshots (
  id         text primary key,
  data       jsonb not null,
  updated_at timestamptz not null default now()
);

alter table site_snapshots enable row level security;

create policy "members read the feed" on site_snapshots
  for select to authenticated
  using (public.access_level() in ('college', 'subscriber'));

-- ---------------------------------------------------------------------------
-- Profile page: college, grad year, major and city use the existing columns
-- plus `major`. The picture and resume are files in Storage under the user's
-- own folder; the profile row keeps their paths. `resume_text` is the plain
-- text the browser pulled out of the resume, which the job matcher reads.
-- ---------------------------------------------------------------------------

alter table profiles add column if not exists major       text;
alter table profiles add column if not exists avatar_path text;
alter table profiles add column if not exists resume_path text;
alter table profiles add column if not exists resume_text text;

-- Both private: a resume is personal, and a picture is shown through a
-- short-lived signed URL rather than a public link.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('avatars', 'avatars', false, 2097152, array['image/jpeg', 'image/png', 'image/webp', 'image/gif']),
  ('resumes', 'resumes', false, 5242880, array[
    'application/pdf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'text/plain'
  ])
on conflict (id) do nothing;

-- Each user reads and writes only objects under '<their user id>/...'.
create policy "own files: read" on storage.objects for select to authenticated
  using (bucket_id in ('avatars', 'resumes') and (storage.foldername(name))[1] = auth.uid()::text);
create policy "own files: add" on storage.objects for insert to authenticated
  with check (bucket_id in ('avatars', 'resumes') and (storage.foldername(name))[1] = auth.uid()::text);
create policy "own files: replace" on storage.objects for update to authenticated
  using (bucket_id in ('avatars', 'resumes') and (storage.foldername(name))[1] = auth.uid()::text);
create policy "own files: remove" on storage.objects for delete to authenticated
  using (bucket_id in ('avatars', 'resumes') and (storage.foldername(name))[1] = auth.uid()::text);
