#!/usr/bin/env bash
# Free-access gate: the free-for-everyone site may only publish once the
# database lets every confirmed account in (migration 0021_free_access).
# Asks the live project for public.free_access_version(), which only that
# migration creates; anything but 21 fails, and site.yml's deploy job stops
# before publishing. Read-only: one anonymous RPC call, no secrets.
#
#   SUPABASE_URL=... SUPABASE_ANON_KEY=... .github/scripts/free-access-gate.sh
set -euo pipefail
if [ -z "${SUPABASE_URL:-}" ] || [ -z "${SUPABASE_ANON_KEY:-}" ]; then
  # No accounts: the open site has no sign-in to gate.
  echo "::notice::Accounts are not configured; the free-access gate does not apply."
  exit 0
fi
answer="$(curl -sS -m 20 -X POST "${SUPABASE_URL%/}/rest/v1/rpc/free_access_version" \
  -H "apikey: $SUPABASE_ANON_KEY" -H "Authorization: Bearer $SUPABASE_ANON_KEY" \
  -H 'Content-Type: application/json' -d '{}' || true)"
if [ "$answer" != "21" ]; then
  echo "::error::Free-access gate: the database has not applied 0021_free_access (free_access_version() answered: ${answer:-nothing}). Not publishing a site that promises free access. See docs/free-access.md."
  exit 1
fi
echo "Free-access gate: 0021_free_access is live."
