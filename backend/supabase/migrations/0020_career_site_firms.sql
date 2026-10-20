-- Employers found on their own official career sites (Discover ATS run
-- 39450108559, 2026-10-20, batch 3). RCLCO's Greenhouse board was never on
-- the firm list, so its Texas postings (the 2027 Summer Intern, Real Estate
-- Economics & Consulting, Austin) were never fetched.
--
-- Uses only the columns 0001_init.sql created (production lacks sector and
-- cre_only). The site reads firms from the Sheet's Firms tab; the build adds
-- this batch there once, like 0018 (src/sheets/firms.ts).
--
-- Idempotent: a firm already present by name, or by board, is left as it is.
insert into firms (name, ats, ats_slug, ats_host, slug_verified, active) values
  ('RCLCO', 'greenhouse', 'rclco', null, true, true)
on conflict do nothing;
