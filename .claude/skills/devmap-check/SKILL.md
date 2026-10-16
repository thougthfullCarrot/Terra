---
name: devmap-check
description: Run the development map browser check (filters, loading, empty states) against a built site. Use after changing the dev map, its filters, or permit grouping.
---

# Development map browser check

The same check the Website workflow runs on pull requests (`.github/workflows/site.yml`, "Check the development map filters on real data").

1. Build the site first (see the `site-build-and-test` skill). The check needs `site/market.json`; without it there is no map data to test.
2. From `backend/`:
   ```bash
   npm ci
   # Cloud sessions have Chromium at /opt/pw-browsers already; do not run playwright install there.
   node test/browser/devmap-check.mjs ../site /tmp/devmap-shots 2>&1 | tee /tmp/devmap.log
   npx tsx test/browser/permit-dedupe-report.ts 2>&1 | tee /tmp/permits.log
   ```
3. Read the log for failures, and look at the screenshots in `/tmp/devmap-shots` (desktop and phone).
4. Fort Worth permits must show one project per permit number (PR #73). Duplicates in the permit report are a regression.

Free tier only: everything runs locally or on GitHub Actions minutes. Never publish anything from this check.
