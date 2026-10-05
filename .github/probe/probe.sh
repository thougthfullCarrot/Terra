#!/usr/bin/env bash
# Temporary: runs the market export against the live sources.
set -o pipefail
cd backend
npm ci --silent
npm run --silent export:market -- --out /tmp/market.json --previous /nonexistent 2>&1 | grep -v "^[A-Z].*: missing\|all figures$" 
echo "=== JSON"
jq -c '{rates, counties}' /tmp/market.json
jq -c '.markets[] | {city, v: (.values | with_entries(select(.key|test("^(pep|migration|netMig|domestic|international|natural|tax|oz|txdot)"))))}' /tmp/market.json
echo "=== FULL"
gzip -c /tmp/market.json | base64 -w0; echo
