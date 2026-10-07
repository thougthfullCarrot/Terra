const UA = { 'user-agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/126 Safari/537.36' };
async function head(url) {
  try {
    const r = await fetch(url, { method: 'HEAD', headers: UA, signal: AbortSignal.timeout(20000) });
    console.log(r.status, r.headers.get('content-length'), r.headers.get('last-modified'), url);
  } catch (e) { console.log('ERR', e.message, url); }
}
async function get(url, n = 600) {
  try {
    const r = await fetch(url, { headers: UA, signal: AbortSignal.timeout(25000) });
    const t = await r.text();
    console.log(r.status, url, t.length, '\n  ', t.slice(0, n).replace(/\s+/g, ' '));
    return t;
  } catch (e) { console.log('ERR', e.message, url); }
}
console.log('=== DOL');
const page = await get('https://www.dol.gov/agencies/eta/foreign-labor/performance', 0);
if (page) for (const m of new Set(page.match(/[^"']*LCA[^"']*\.(xlsx|pdf|csv|zip)/gi) || [])) console.log('  link', m);
for (const f of ['FY2025_Q4', 'FY2026_Q1', 'FY2026_Q2', 'FY2026_Q3', 'FY2026_Q4', 'FY2025_Q3'])
  await head(`https://www.dol.gov/sites/dolgov/files/ETA/oflc/pdfs/LCA_Disclosure_Data_${f}.xlsx`);
console.log('=== Legistar');
const since = new Date(Date.now() - 45 * 864e5).toISOString().slice(0, 10);
for (const c of ['cityofdallas', 'dallas', 'fortworthgov', 'fortworth', 'houston', 'houstontx', 'sanantonio', 'austintexas', 'austin', 'elpasotexas', 'elpaso', 'newbraunfels', 'cstx', 'collegestation', 'galveston', 'galvestontx', 'lubbock', 'ci-lubbock', 'midland', 'midlandtx', 'arlingtontx', 'arlington', 'plano', 'friscotx', 'mckinney', 'roundrock', 'irving', 'garland', 'denton', 'sugarland', 'conroe', 'pearland', 'cityofirving']) {
  await get(`https://webapi.legistar.com/v1/${c}/events?$filter=EventDate+ge+datetime'${since}'&$top=3&$orderby=EventDate+desc`, 300);
  await get(`https://webapi.legistar.com/v1/${c}/matters?$filter=MatterIntroDate+ge+datetime'${since}'+and+substringof('zon',MatterTitle)&$top=2`, 400);
}
