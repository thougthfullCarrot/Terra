const UA = { 'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36' };
async function get(url, n = 500, headers = UA) {
  try {
    const r = await fetch(url, { headers, signal: AbortSignal.timeout(30000) });
    const t = await r.text();
    console.log(r.status, r.headers.get('content-type'), url, t.length, '\n  ', t.slice(0, n).replace(/\s+/g, ' '));
    return r.ok ? t : null;
  } catch (e) { console.log('ERR', e.message, url); }
}
await get('https://h1bdata.info/robots.txt', 1500);
const t = await get('https://h1bdata.info/index.php?em=CBRE&job=&city=DALLAS&year=2025', 0);
if (t) { const i = t.indexOf('<table'); console.log(t.slice(i, i + 3000)); }
const t2 = await get('https://h1bdata.info/index.php?em=&job=real+estate&city=HOUSTON&year=2025', 0);
if (t2) { const rows = t2.match(/<tr[\s\S]*?<\/tr>/g) || []; console.log('rows', rows.length); console.log(rows.slice(0, 6).join('\n').replace(/\s+/g, ' ')); }
for (const u of ['https://foreignlaborcert.doleta.gov/performancedata.cfm', 'https://www.foreignlaborcert.doleta.gov/', 'https://dol.gov/agencies/eta/foreign-labor/performance', 'https://www.dol.gov/robots.txt'])
  await get(u, 200, { 'user-agent': 'terra-collector/0.1 (+https://github.com/thougthfullCarrot/Terra)' });
await get('https://flag.dol.gov/wage-data/wage-data-downloads', 0).then((h) => { if (h) for (const m of new Set(h.match(/href="[^"]*\.(zip|xlsx|csv)"/g) || [])) console.log('  ', m); });
