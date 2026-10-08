// Temporary: tries other board addresses for the five paused firms. Removed before merge.
const UA = { 'user-agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36', accept: 'application/json', 'accept-language': 'en-US' };
async function wd(host: string, tenant: string, site: string, limit = 20) {
  const url = `https://${host}/wday/cxs/${tenant}/${site}/jobs`;
  try {
    const r = await fetch(url, { method: 'POST', headers: { ...UA, 'content-type': 'application/json' }, body: JSON.stringify({ appliedFacets: {}, limit, offset: 0, searchText: '' }), signal: AbortSignal.timeout(20000) });
    const t = await r.text();
    let total = '';
    try { total = String(JSON.parse(t).total); } catch {}
    console.log(`WD ${r.status} ${host} ${tenant}/${site} limit=${limit} total=${total} ${r.ok ? '' : t.slice(0, 160).replace(/\s+/g, ' ')}`);
  } catch (e) { console.log(`WD ERR ${host} ${tenant}/${site} ${e}`); }
}
async function get(url: string) {
  try {
    const r = await fetch(url, { headers: UA, signal: AbortSignal.timeout(20000) });
    const t = await r.text();
    console.log(`GET ${r.status} ${url} ${t.length}b ${t.slice(0, 200).replace(/\s+/g, ' ')}`);
    return t;
  } catch (e) { console.log(`GET ERR ${url} ${e}`); return ''; }
}
// Howard Hughes: 422 on wd5.
for (const host of ['osv-howardhughes.wd5.myworkdayjobs.com', 'osv-howardhughes.wd503.myworkdayjobs.com', 'osv-howardhughes.wd1.myworkdayjobs.com', 'osv-howardhughes.wd501.myworkdayjobs.com'])
  for (const limit of [20, 10]) await wd(host, 'osv-howardhughes', 'HowardHughes', limit);
await get('https://osv-howardhughes.wd5.myworkdayjobs.com/HowardHughes');
// MAA: 400 on wd1.
for (const host of ['maa.wd1.myworkdayjobs.com', 'maa.wd501.myworkdayjobs.com', 'maa.wd5.myworkdayjobs.com'])
  for (const site of ['MAA', 'maa', 'External'])
    for (const limit of [20, 10]) await wd(host, 'maa', site, limit);
await get('https://maa.wd1.myworkdayjobs.com/MAA');
// Huntington: 500 on wd12.
for (const host of ['huntington.wd12.myworkdayjobs.com', 'huntington.wd1.myworkdayjobs.com', 'huntington.wd5.myworkdayjobs.com'])
  for (const site of ['HNBcareers', 'HNBCareers', 'External'])
    for (const limit of [20, 10]) await wd(host, 'huntington', site, limit);
// Berkadia: 404 on boards-api with content=true.
for (const slug of ['berkadia', 'berkadiacareers', 'berkadiacommercialmortgage', 'berkadiaservices'])
  for (const q of ['', '?content=true']) await get(`https://boards-api.greenhouse.io/v1/boards/${slug}/jobs${q}`);
await get('https://job-boards.greenhouse.io/berkadia');
// FNF iCIMS: listed 0.
for (const url of ['https://careers-fnf.icims.com/jobs/search?pr=0&in_iframe=1', 'https://careers-fnf.icims.com/jobs/search?ss=1&in_iframe=1', 'https://careers-fnf.icims.com/jobs/intro?in_iframe=1', 'https://careers-fnf.icims.com/robots.txt']) {
  const t = await get(url);
  console.log('  job links:', (t.match(/\/jobs\/\d+\/[^"']+\/job/g) ?? []).length);
}
