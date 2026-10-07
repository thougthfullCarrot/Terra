// Temporary: checks YCRAN and CREW event pages from a GitHub runner. Removed before merge.
const UA = 'terra-collector/0.1 (+https://github.com/thougthfullCarrot/Terra)';
const get = async (url) => {
  try {
    const r = await fetch(url, { headers: { 'user-agent': UA, accept: 'text/html,application/xml,*/*' }, redirect: 'follow', signal: AbortSignal.timeout(20000) });
    return { status: r.status, url: r.url, body: await r.text() };
  } catch (e) {
    return { status: 'ERR ' + e.message, url, body: '' };
  }
};
const show = (label, html) => {
  const lds = [...html.matchAll(/<script[^>]*ld\+json[^>]*>([\s\S]*?)<\/script>/gi)].map((m) => m[1].slice(0, 900));
  console.log(`  ${label} ld+json blocks: ${lds.length}`);
  for (const l of lds) console.log('   LD: ' + l.replace(/\s+/g, ' '));
  const flat = html.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
  const m = flat.match(/.{0,200}\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.? \d{1,2},? \d{4}.{0,250}/);
  console.log('  text: ' + (m ? m[0] : flat.slice(0, 400)));
  for (const k of ['startDate', 'start_date', 'eventStart', '"start"', 'dateTime', 'datetime=', 'scheduling', 'ical', '.ics', 'og:title', 'application/json']) {
    const i = html.indexOf(k);
    if (i >= 0) console.log(`  [${k}] ` + html.slice(Math.max(0, i - 120), i + 260).replace(/\s+/g, ' '));
  }
};
for (const sm of ['https://www.ycran.org/event-pages-sitemap.xml', 'https://houston.crewnetwork.org/sitemap.xml', 'https://dallas.crewnetwork.org/sitemap.xml', 'https://austin.crewnetwork.org/sitemap.xml', 'https://sanantonio.crewnetwork.org/sitemap.xml', 'https://fortworth.crewnetwork.org/sitemap.xml', 'https://elpaso.crewnetwork.org/sitemap.xml', 'https://crewsa.crewnetwork.org/sitemap.xml']) {
  const r = await get(sm);
  const locs = [...r.body.matchAll(/<loc>([^<]+)<\/loc>(?:\s*<lastmod>([^<]+)<\/lastmod>)?/g)].map((m) => [m[1], m[2] ?? '']);
  const ev = locs.filter(([u]) => /event/i.test(u));
  console.log(`\n=== ${sm} -> ${r.status} ${r.url} locs=${locs.length} event=${ev.length}`);
  console.log(ev.slice(0, 6).map((x) => '  ' + x.join(' ')).join('\n'));
  const pick = ev.find(([u]) => /2026|anatomy-of-a-deal-1/.test(u)) ?? ev[0];
  if (pick) {
    const d = await get(pick[0].startsWith('http') ? pick[0] : 'https://' + pick[0]);
    console.log(`  detail ${d.status} ${d.url} len=${d.body.length}`);
    show('detail', d.body);
  }
}
