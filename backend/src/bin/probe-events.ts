/** Temporary: probe candidate event calendars from a GitHub runner. */
import { fetchSource, type EventSource } from '../events/events.js';

const URLS: string[] = (process.env.PROBE_URLS ?? '').split(/\s+/).filter(Boolean);
const SOURCES: EventSource[] = JSON.parse(process.env.PROBE_SOURCES ?? '[]');

function markers(body: string): string {
  const m: string[] = [];
  if (/tribe-events|wp-json\/tribe/.test(body)) m.push('tribe');
  if (/growthzone|chambermaster|micronet/i.test(body)) m.push('growthzone');
  if (/"@type"\s*:\s*"Event"|"@type":\["Event"/.test(body)) m.push(`jsonld-event x${(body.match(/"@type"\s*:\s*"(?:\w*)Event"/g) ?? []).length}`);
  if (/localist/i.test(body)) m.push('localist');
  if (/livewhale/i.test(body)) m.push('livewhale');
  if (/wix\.com|wixstatic/.test(body)) m.push('wix');
  if (/starchapter/i.test(body)) m.push('starchapter');
  if (/squarespace/i.test(body)) m.push('squarespace');
  if (/BEGIN:VCALENDAR/.test(body)) m.push(`ics x${(body.match(/BEGIN:VEVENT/g) ?? []).length}`);
  if (/captcha|cf-chl|challenge-platform/i.test(body)) m.push('CHALLENGE');
  const links = [...new Set(body.match(/href="[^"]*(?:ical|\.ics|feed|\/events?\/[^"]{3,60})"/gi) ?? [])].slice(0, 6);
  return `${m.join(',')} ${links.join(' ')}`;
}

async function main(): Promise<void> {
  for (const url of URLS) {
    try {
      const r = await fetch(url, { headers: { 'user-agent': 'terra-collector/0.1 (+https://github.com/thougthfullCarrot/Terra)', accept: 'text/html,application/json,text/calendar,*/*' }, redirect: 'follow', signal: AbortSignal.timeout(15000) });
      const body = await r.text();
      console.log(`URL ${r.status} ${body.length}b ${url} -> ${r.url} | ${markers(body)}`);
      if (process.env.PROBE_SNIPPET && r.ok) console.log(`  SNIP ${body.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>|<[^>]+>/g, ' ').replace(/\s+/g, ' ').slice(0, 600)}`);
    } catch (e) {
      console.log(`URL ERR ${url} ${(e as Error).message}`);
    }
  }
  const now = new Date();
  for (const s of SOURCES) {
    const t = Date.now();
    try {
      const ev = await fetchSource(s, now, undefined, (m) => console.log(`  log ${s.key}: ${m}`));
      const up = ev.filter((e) => Date.parse(e.start) > now.getTime() - 86400000);
      console.log(`SRC ${s.key} ok ${ev.length} raw, ${up.length} upcoming, ${Date.now() - t}ms`);
      for (const e of up.slice(0, 8)) console.log(`  EV ${e.start} | ${e.city} | ${e.title} | ${e.venue ?? '-'} | ${e.url ?? ''}`);
    } catch (e) {
      console.log(`SRC ${s.key} FAIL ${(e as Error).message} ${Date.now() - t}ms`);
    }
  }
}
void main();
