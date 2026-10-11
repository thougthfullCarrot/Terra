#!/usr/bin/env bash
# Print the migration files a push introduced, one per line, in name order.
#
#   new-migrations.sh <before-sha> <after-sha> [dir]
#
# A file counts as new when it appears under <dir> and was not there before:
# added outright, or moved in from elsewhere (pending/ -> migrations/). The
# diff is limited to <dir>, so a move in from outside shows as an addition.
# A file renamed or edited inside <dir> was already there and is not re-run;
# deleted files are never listed. Only reads git; touches no credentials.
set -euo pipefail
before="$1" after="$2" dir="${3:-backend/supabase/migrations}"
git diff --name-only --diff-filter=A "$before" "$after" -- "$dir" | grep '\.sql$' | LC_ALL=C sort || true
