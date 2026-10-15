#!/usr/bin/env bash
# Starts a throwaway Postgres in a temp directory, loads the Supabase stub,
# every migration (except 0004, which needs pg_cron) and the pending ones,
# then runs the database tests against it. Nothing touches Supabase.
#
#   npm run test:db
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
backend="$(cd "$here/../.." && pwd)"
bin="$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | sort -V | tail -1)"
[ -x "$bin/initdb" ] || { echo "Postgres server binaries not found; install postgresql to run the database tests." >&2; exit 1; }
dir="$(mktemp -d)"
port=$(( 20000 + RANDOM % 20000 ))
cleanup() { "$bin/pg_ctl" -D "$dir/data" -m immediate stop >/dev/null 2>&1 || true; rm -rf "$dir"; }
trap cleanup EXIT
run_as=()
if [ "$(id -u)" = 0 ]; then
  id postgres >/dev/null 2>&1 || useradd -r postgres
  chown -R postgres "$dir"
  run_as=(su postgres -s /bin/bash -c)
fi
pg() { if [ ${#run_as[@]} -gt 0 ]; then "${run_as[@]}" "$*"; else bash -c "$*"; fi; }
pg "'$bin/initdb' -D '$dir/data' -U postgres -A trust >/dev/null"
pg "'$bin/pg_ctl' -D '$dir/data' -o '-p $port -k $dir -c listen_addresses=' -l '$dir/log' start -w >/dev/null"
export PGHOST="$dir" PGPORT="$port" PGUSER=postgres PGDATABASE=postgres
psql -q -v ON_ERROR_STOP=1 -f "$here/supabase-stub.sql" >/dev/null
for f in "$backend"/supabase/migrations/*.sql "$backend"/supabase/pending/*.sql; do
  [ -e "$f" ] || continue # pending/ may be empty
  case "$(basename "$f")" in 0004_*) continue ;; esac
  psql -q -v ON_ERROR_STOP=1 -f "$f" >/dev/null 2>"$dir/err" || { echo "Migration $(basename "$f") failed:" >&2; cat "$dir/err" >&2; exit 1; }
done
cd "$backend"
TERRA_TEST_PG="host=$dir port=$port user=postgres dbname=postgres" npx vitest run --no-file-parallelism test/db "$@"
