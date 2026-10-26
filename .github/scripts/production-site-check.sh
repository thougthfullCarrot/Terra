#!/usr/bin/env bash
# Production site check: run on the built site folder just before it is
# packaged for Pages on the default branch. Fails unless the site requires
# sign-in: config.js names a Supabase project and an anon key, and no
# members-only data file (postings.json, market.json, developments/) is in
# the folder. TERRA must never fall back to a public app. Local and fixture
# previews (npm run build:site, the browser checks) never run this.
#
#   .github/scripts/production-site-check.sh site
set -euo pipefail
dir="${1:?usage: production-site-check.sh <site dir>}"
fail() { echo "::error::Production site check: $1 Not publishing."; exit 1; }
[ -f "$dir/config.js" ] || fail "config.js is missing."
node --input-type=module -e '
  const { CONFIG } = await import(process.argv[1]);
  const ok = /^https:\/\/[a-z0-9]+\.supabase\.co$/.test(CONFIG?.supabaseUrl ?? "") && Boolean(CONFIG?.supabaseAnonKey);
  process.exit(ok ? 0 : 1);
' "$(cd "$dir" && pwd)/config.js" || fail "config.js has no Supabase project URL and anon key, so the site would open without sign-in."
for private in postings.json market.json developments; do
  [ ! -e "$dir/$private" ] || fail "$private is in the public site; it is members-only."
done
echo "Production site check: sign-in required, no members-only files published."
