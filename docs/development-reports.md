# Development reports

Members can report a project the development map is missing ("Report a
development" under each metro's map). Reports wait in a private review queue
and only verified ones appear on the map.

## Turning it on

1. Move `backend/supabase/pending/0019_development_reports.sql` to
   `backend/supabase/migrations/` (check both folders for the next free number
   first). Merging that applies it through migrate.yml.
2. Set the repository variable `DEVELOPMENT_REPORTS_ENABLED` to `true`. The
   next Website build shows the form.

Everything stays on the Supabase free tier: one table, and a private photo
bucket capped at 5 MB a photo (the free plan has 1 GB of storage).

## What the database enforces

- Signed-in accounts only, 5 reports per account per day.
- Address or a pin inside Texas, description 10 to 1,000 characters, http(s)
  links only, photos only in the reporter's own folder.
- The same account can't report the same place twice. A report at the same
  address as, or within about 150 m of, another pending or approved report is
  marked in `possible_duplicate_of`.
- Members see only their own reports and can't edit or delete them. Nobody but
  the service role can change a status.

The form also has a hidden honeypot field; bots that fill it are dropped
without a database write.

## Reviewing

In the Supabase dashboard, open Table editor → `development_reports`, filter
`status = pending`, and check each one (TDLR TABS search, the city's permits,
the source link, the photo in Storage → `development-report-photos`). Then set
`status` to `approved`, `rejected` or `duplicate`, with a short `review_note`
the reporter sees. `reviewed_at` fills itself. Approved reports appear on the
map from `published_development_reports`, which never includes the reporter.

## Rolling back

```sql
drop view if exists public.published_development_reports;
drop table if exists public.development_reports;
drop function if exists public.development_report_before_insert, public.development_report_reviewed,
  public.development_reports_today, public.development_report_match, public.development_report_key;
delete from storage.buckets where id = 'development-report-photos';
```
