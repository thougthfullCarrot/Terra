#!/usr/bin/env bash
# Temporary: runs the market export against the live sources.
set -o pipefail
pip install -q openpyxl
for y in 2024 2023; do
  curl -sSL -o /tmp/t$y.xlsx -w "$y status=%{http_code} type=%{content_type} size=%{size_download}\n" "https://comptroller.texas.gov/taxes/property-tax/docs/$y-total-rates-levies.xlsx"
  unzip -l /tmp/t$y.xlsx | grep xml
  python3 -c "
import openpyxl
wb=openpyxl.load_workbook('/tmp/t$y.xlsx',read_only=True)
for ws in wb.worksheets:
    print('sheet',ws.title)
    for i,r in enumerate(ws.iter_rows(values_only=True)):
        if i<5 or (r and any(str(c).strip() in ('Dallas','Dallas ISD') for c in r if c)): print(i,r)
"
done
cd backend
npm ci --silent
npm run --silent export:market -- --out /tmp/market.json --previous /nonexistent 2>&1 | grep -i "tax\|txdot\|error"
echo "=== FULL"
jq . /tmp/market.json
