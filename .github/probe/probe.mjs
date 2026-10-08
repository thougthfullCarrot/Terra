const UA = { 'user-agent': 'Mozilla/5.0 (compatible; TerraBot/0.1)' };
async function get(url, opts = {}) {
  try {
    const r = await fetch(url, { ...opts, headers: { ...UA, ...(opts.headers || {}) }, signal: AbortSignal.timeout(60000) });
    const t = await r.text();
    return { status: r.status, type: r.headers.get('content-type'), text: t };
  } catch (e) { return { status: 0, text: String(e) }; }
}
function show(label, r, n = 1500) { console.log(`\n===== ${label} [${r.status}] ${r.type ?? ''} len=${r.text.length}\n${r.text.slice(0, n)}`); }
const strip = (h) => h.replace(/<(script|style)[\s\S]*?<\/\1>/gi, '').replace(/<[^>]+>/g, '\n').replace(/&nbsp;/g, ' ').split('\n').map((l) => l.trim()).filter(Boolean).join(' | ');

// TABS: search one county, then read 3 pages, print text near DESIGN FIRM and any contractor mention.
const now = new Date(); const since = new Date(now - 200 * 864e5);
const us = (d) => `${String(d.getUTCMonth() + 1).padStart(2, '0')}/${String(d.getUTCDate()).padStart(2, '0')}/${d.getUTCFullYear()}`;
const form = new URLSearchParams({ draw: '1', start: '0', length: '5', 'order[0][column]': '9', 'order[0][dir]': 'desc', 'columns[9][data]': 'EstimatedCost', LocationCounty: '2227', RegistrationDateBegin: us(since), RegistrationDateEnd: us(now), DataVersionId: '900001' });
const s = await get('https://www.tdlr.texas.gov/TABS/Search/SearchProjects', { method: 'POST', body: form, headers: { 'x-requested-with': 'XMLHttpRequest', referer: 'https://www.tdlr.texas.gov/TABS/Search/', 'content-type': 'application/x-www-form-urlencoded' } });
show('TABS search', s, 600);
try {
  for (const row of JSON.parse(s.text).data.slice(0, 3)) {
    const p = await get(`https://www.tdlr.texas.gov/TABS/Search/Project/${row.ProjectNumber}`);
    const t = strip(p.text);
    const i = t.indexOf('PROJECT |');
    console.log(`\n===== TABS page ${row.ProjectNumber} [${p.status}]\n${t.slice(Math.max(0, i), i + 3500)}`);
    console.log('contractor mentions:', (t.match(/.{0,60}contractor.{0,80}/gi) || []).slice(0, 5));
  }
} catch (e) { console.log('tabs parse fail', e.message); }

// Fort Worth & Arlington field lists
for (const [n, u] of [['FW', 'https://mapit.fortworthtexas.gov/ags/rest/services/CIVIC/Permits/MapServer/0?f=json'], ['ARL', 'https://gis2.arlingtontx.gov/agsext2/rest/services/OpenData/OD_Property/MapServer/1?f=json']]) {
  const r = await get(u);
  try { console.log(`\n===== ${n} fields:`, JSON.parse(r.text).fields.map((f) => f.name).join(', ')); } catch { show(n, r, 500); }
}
const fw = await get(`https://mapit.fortworthtexas.gov/ags/rest/services/CIVIC/Permits/MapServer/0/query?where=${encodeURIComponent("Permit_Type = 'Commercial Building Permit' AND Permit_SubType IN ('New','Addition') AND JobValue >= 1000000")}&outFields=*&returnGeometry=false&resultRecordCount=2&orderByFields=File_Date+DESC&f=json`);
show('FW sample', fw, 3000);
const arl = await get(`https://gis2.arlingtontx.gov/agsext2/rest/services/OpenData/OD_Property/MapServer/1/query?where=${encodeURIComponent("FOLDERTYPE = 'CP' AND WORKDESC IN ('New Construction','Addition') AND ConstructionValuationDeclared >= 1000000")}&outFields=*&returnGeometry=false&resultRecordCount=2&orderByFields=ISSUEDATE+DESC&f=json`);
show('ARL sample', arl, 3000);
const sa = await get(`https://data.sanantonio.gov/api/3/action/datastore_search_sql?sql=${encodeURIComponent(`SELECT * FROM "c21106f9-3ef5-4f3a-8604-f992b4db7512" WHERE "PERMIT TYPE" = 'Comm New Building Permit' LIMIT 2`)}`);
show('SA sample', sa, 2500);
const au = await get(`https://data.austintexas.gov/resource/3syk-w9eu.json?$where=${encodeURIComponent("permittype='BP' AND permit_class_mapped='Commercial' AND work_class='New' AND total_job_valuation>=1000000")}&$order=issue_date+DESC&$limit=1`);
show('AU sample', au, 4000);

// Bid sources
for (const u of ['https://www.txsmartbuy.gov/robots.txt', 'https://www.txsmartbuy.gov/esbd', 'https://www.txsmartbuy.gov/terms', 'https://comptroller.texas.gov/robots.txt']) show(u, await get(u), 1500);
for (const d of ['data.austintexas.gov', 'www.dallasopendata.com', 'data.fortworthtexas.gov', 'data.houstontx.gov', 'data.texas.gov']) {
  for (const q of ['solicitation', 'bid']) {
    const r = await get(`https://api.us.socrata.com/api/catalog/v1?domains=${d}&q=${q}&limit=8`);
    try { console.log(`\n===== catalog ${d} ${q}:`, JSON.parse(r.text).results.map((x) => `${x.resource.id} | ${x.resource.name} | ${x.resource.updatedAt}`).join('\n  ')); } catch { show(`catalog ${d}`, r, 300); }
  }
}
for (const q of ['bid', 'solicitation', 'procurement']) {
  const r = await get(`https://data.sanantonio.gov/api/3/action/package_search?q=${q}&rows=8`);
  try { console.log(`\n===== SA ckan ${q}:`, JSON.parse(r.text).result.results.map((x) => `${x.name} | ${x.title} | ${x.metadata_modified}`).join('\n  ')); } catch { show('SA ckan', r, 300); }
}
