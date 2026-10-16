---
name: site-build-and-test
description: Build the Terra website and run the repo's checks (typecheck, unit tests, DB tests, mobile). Use before pushing any code change.
---

# Build the site and run the tests

Mirrors `.github/workflows/ci.yml` and the build steps in `site.yml`. Run these before every push.

Backend (from `backend/`):
```bash
npm ci
npm run typecheck
npm test            # vitest
npm run test:db     # RLS and watchlist limits on a throwaway local Postgres; never touches Supabase
npm run build:site  # builds site/*.js
for f in ../site/*.js; do node --check --input-type=module < "$f" || echo "SYNTAX ERROR: $f"; done
```

Mobile (from `mobile/`), only when mobile code changed:
```bash
npm ci && npm run typecheck && npm test && npm run bundle
```

Notes:
- A syntax error in any one `site/*.js` blanks the whole site, so the parse loop matters.
- Data exports (jobs, market, news, events) need API keys held as GitHub secrets. Do not ask for keys in chat; let the Website workflow run them.
- To look at the site locally, serve `site/` with `npx http-server site` or `python3 -m http.server -d site`.
