// Temporary: check which tax-sale listing links work.
const counties = ['DALLAS COUNTY', 'TARRANT COUNTY', 'HARRIS COUNTY', 'GALVESTON COUNTY', 'BEXAR COUNTY', 'EL PASO COUNTY', 'ECTOR COUNTY', 'HAYS COUNTY'];
const ua = { 'user-agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36' };
async function check(url) {
  try {
    const r = await fetch(url, { headers: ua, redirect: 'follow' });
    const t = await r.text();
    return `${r.status} ${r.url.slice(0, 90)} len=${t.length} title=${(/<title>([^<]*)/i.exec(t)?.[1] ?? '').trim().slice(0, 60)}`;
  } catch (e) { return 'ERR ' + e.message; }
}
for (const c of counties) {
  const body = await (await fetch(`https://taxsales.lgbs.com/api/property_sales/?county=${encodeURIComponent(c)}&limit=40&offset=0`, { headers: ua })).json();
  const rows = body.results ?? [];
  console.log(`\n== ${c}: ${rows.length}`);
  if (rows[0]) console.log(JSON.stringify(Object.fromEntries(Object.entries(rows[0]).filter(([k]) => k !== 'geometry'))).slice(0, 1500));
  const seen = new Set();
  for (const r of rows.slice(0, 40)) {
    for (const k of ['property_loc', 'county_sale_list']) {
      const u = r[k];
      if (!u || seen.has(k + (u.split('?')[0])) ) continue;
      seen.add(k + u.split('?')[0]);
      console.log(k, JSON.stringify(u).slice(0, 120), '->', /^https?:/.test(u) ? await check(u) : 'not a url');
    }
  }
  if (rows[0]) console.log('sample property_loc values:', rows.slice(0, 5).map((r) => r.property_loc).join(' | '));
}
for (const u of ['https://taxsales.lgbs.com/', 'https://taxsales.lgbs.com/map', 'https://taxsales.lgbs.com/map?lat=32.8&lon=-96.9&zoom=14', 'https://taxsales.lgbs.com/list?county=DALLAS%20COUNTY'])
  console.log(u, '->', await check(u));
