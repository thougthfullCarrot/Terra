#!/usr/bin/env bash
# Temporary: what industry job boards and chapter event calendars publish.
UA='Mozilla/5.0 (compatible; TerraBot/1.0; +https://thougthfullcarrot.github.io/Terra/)'
look() {
  local url=$1
  local code=$(curl -sSL -A "$UA" -m 25 -o /tmp/p.html -w '%{http_code} %{url_effective}' "$url" 2>&1)
  echo "== $url -> $code ($(wc -c </tmp/p.html 2>/dev/null) bytes)"
  grep -oiE '(href|src)="[^"]*(\.ics|ical|webcal|/rss|\.rss|feed|eventbrite|memberclicks|growthzone|wildapricot|ymcareers|tribe-events|/events?/[^"]*)[^"]*"' /tmp/p.html | sort -u | head -12
  grep -oiE '"@type" *: *"Event"|tribe-events|wp-json|memberclicks|growthzone|wild ?apricot|YM Careers|Personify|Higher Logic|Cvent|eventbrite|Novi' /tmp/p.html | sort | uniq -c | head -8
}
robots() { echo "-- robots $1"; curl -sSL -A "$UA" -m 20 "$1/robots.txt" | grep -iE '^(user-agent|disallow|crawl)' | head -8; }
for site in https://careers.naiop.org https://careers.crewnetwork.org https://careers.uli.org https://careers.ccim.com; do look "$site/"; look "$site/jobs/"; robots "$site"; done
for site in https://www.naiopntx.org https://www.naiophouston.org https://www.naiopaustin.org https://naiopsa.org \
  https://northtexas.uli.org https://houston.uli.org https://austin.uli.org https://sanantonio.uli.org https://elpaso.uli.org \
  https://www.crewdallas.org https://www.crewhouston.org https://www.crewaustin.org https://crewsa.org https://www.crewfortworth.org \
  https://www.bomadallas.org https://www.bomahouston.org https://www.bomafw.org https://www.bomasa.org https://www.bomaaustin.org \
  https://www.texasccim.com https://www.iremdallas.org https://www.iremhouston.org; do
  look "$site/"; look "$site/events/"; robots "$site"
done
