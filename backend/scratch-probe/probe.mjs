// Temporary: checks candidate event sources from a GitHub runner. Removed before merge.
const UA = 'terra-collector/0.1 (+https://github.com/thougthfullCarrot/Terra)';
const urls = process.argv.slice(2).length ? process.argv.slice(2) : (await import('node:fs')).readFileSync(new URL('./urls.txt', import.meta.url), 'utf8').split('\n').filter((l) => l.trim() && !l.startsWith('#'));
for (const url of urls) {
  try {
    const r = await fetch(url, { headers: { 'user-agent': UA, accept: 'text/html,application/json,text/calendar,*/*' }, redirect: 'follow', signal: AbortSignal.timeout(20000) });
    const body = await r.text();
    const gz = (body.match(/\/events\/Details\/[^"#?]+-\d+/gi) ?? []).length;
    const ld = (body.match(/"@type"\s*:\s*"Event"/g) ?? []).length;
    const sc = (body.match(/meetinginfo\.php\?id=\d+/gi) ?? []).length;
    const ics = (body.match(/BEGIN:VEVENT/g) ?? []).length;
    let json = '';
    if (/json/.test(r.headers.get('content-type') ?? '')) {
      try { const j = JSON.parse(body); json = ` jsonEvents=${(j.events ?? []).length} sample=${JSON.stringify((j.events ?? [])[0] ?? {}).slice(0, 600)}`; } catch {}
    }
    console.log(`${r.status} ${url} -> ${r.url} len=${body.length} gzLinks=${gz} ldEvents=${ld} starchapter=${sc} vevents=${ics}${json}`);
    if (/aiasa\.org\/events\/[a-z]/.test(url)) console.log(body.replace(/\s+/g, ' ').match(/.{0,300}(?:Oct|Nov|Dec)[a-z]* \d{1,2}.{0,300}/)?.[0] ?? '(no date text)');
  } catch (e) {
    console.log(`ERR ${url} ${e.message}`);
  }
}
