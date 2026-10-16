---
name: verify-production
description: Confirm a merged change is actually live on the Terra website (GitHub Pages). Use after a merge or a Website workflow run.
---

# Verify the production build

Production is GitHub Pages at https://thougthfullcarrot.github.io/Terra/, built by the Website workflow (`.github/workflows/site.yml`) on pushes to the default branch `claude/new-session-6xvm0u` and every 2 hours. Vercel is not used.

1. Find the Website run for the merge commit (GitHub Actions, workflow "Website") and confirm it finished green, including the "Check that Pages is turned on" and deploy steps. Read the run summary for job, market and map counts.
2. Confirm the live site serves the new code: fetch a changed `site/*.js` file from the live URL and check it contains the change (Pages can lag a minute or two after deploy).
   ```bash
   curl -s https://thougthfullcarrot.github.io/Terra/app.js | grep -c '<something from the change>'
   ```
3. Open the page in a real browser (Playwright with Chromium; in cloud sessions use `/opt/pw-browsers`) on desktop and phone widths, and check the changed screen renders with no console errors.
4. If a migration was part of the change, check the "Database migrations" run summary too.
5. Report what was checked with the run link and screenshots. Never trigger live payments, send real emails, or change production data while verifying.
