// Temporary probe, round 2.
async function hit(label, url, { show = 600, headers = {}, method = 'GET', body } = {}) {
  try {
    const r = await fetch(url, { method, body, headers: { 'user-agent': 'terra-collector/0.1 (+https://github.com/thougthfullCarrot/Terra)', ...headers }, signal: AbortSignal.timeout(40000) });
    const text = await r.text();
    console.log(`\n### ${label} ${r.status} type=${r.headers.get('content-type')} len=${text.length}\n${text.slice(0, show).replace(/\s+/g, ' ')}`);
    return text;
  } catch (e) { console.log(`\n### ${label} FAIL ${e.message}`); return ''; }
}
const j = (t) => { try { return JSON.parse(t); } catch { return null; } };
async function fields(label, layer) {
  const d = j(await hit(label, `${layer}?f=json`, { show: 0 }));
  console.log(d?.name, d?.editingInfo?.lastEditDate ? new Date(d.editingInfo.lastEditDate).toISOString() : '', (d?.fields ?? []).map((f) => f.name).join(','));
  const c = j(await hit(label + ' count', `${layer}/query?f=json&where=1%3D1&returnCountOnly=true`, { show: 0 }));
  console.log('count', c?.count);
  const s = j(await hit(label + ' sample', `${layer}/query?f=json&where=1%3D1&outFields=*&returnGeometry=false&resultRecordCount=2`, { show: 0 }));
  console.log(JSON.stringify(s?.features?.map((f) => f.attributes) ?? s).slice(0, 1500));
}
for (const l of [
  'https://services5.arcgis.com/GtNPpPrhcOMhYgh4/arcgis/rest/services/Tax_Delinquent_Parcels/FeatureServer/0',
  'https://services2.arcgis.com/uXyoacYrZTPTKD3R/arcgis/rest/services/CCAD_Parcel_Feature_Set/FeatureServer/0',
  'https://littleelmgis.newedgeservices.com/arcgis/rest/services/AMS/DCAD_Parcels/FeatureServer/0',
  'https://services8.arcgis.com/8SOULwP9Vo43JzCT/arcgis/rest/services/Texas_Foreclosures___July_2025_WFL1/FeatureServer/0'
]) await fields(l.split('/services/')[1].split('/')[0], l);
// More Dallas candidates
for (const q of ['Dallas Central Appraisal District', 'DCAD parcel owner', 'Dallas County Appraisal parcels 2025', 'El Paso Central Appraisal District parcels'])
  { const d = j(await hit(`AGOL ${q}`, `https://www.arcgis.com/sharing/rest/search?f=json&num=10&q=${encodeURIComponent(q + ' type:"Feature Service"')}`, { show: 0 }));
    for (const i of d?.results ?? []) console.log(`  ${i.title} | ${i.owner} | ${new Date(i.modified).toISOString().slice(0,10)} | ${i.url}`); }
// EDGAR with a plain UA, no origin
for (const ua of ['Terra CRE Research terra.cre.research@gmail.com', 'Mozilla/5.0 terra research'])
  await hit(`EDGAR ua=${ua}`, `https://efts.sec.gov/LATEST/search-index?q=${encodeURIComponent('"lease expires" "Houston, Texas"')}&forms=10-K`, { show: 300, headers: { 'user-agent': ua } });
// LGBS per county
for (const c of ['HARRIS COUNTY', 'DALLAS COUNTY', 'TARRANT COUNTY', 'BEXAR COUNTY', 'TRAVIS COUNTY', 'EL PASO COUNTY', 'COLLIN COUNTY', 'FORT BEND COUNTY', 'LUBBOCK COUNTY', 'COMAL COUNTY', 'GALVESTON COUNTY']) {
  const d = j(await hit(`LGBS ${c}`, `https://taxsales.lgbs.com/api/property_sales/?limit=200&county=${encodeURIComponent(c)}`, { show: 0 }));
  const by = {}; for (const r of d?.results ?? []) { const k = `${r.sale_type}|${r.status}|${(r.sale_date_only ?? '').slice(0, 7)}`; by[k] = (by[k] ?? 0) + 1; }
  console.log(d?.count, JSON.stringify(by));
  const dated = (d?.results ?? []).find((r) => r.sale_date_only);
  if (dated) console.log(JSON.stringify(dated).slice(0, 900));
}
// Dallas County foreclosures page structure
const dal = await hit('Dallas FRCL', 'https://www.dallascounty.org/government/county-clerk/recording/foreclosures.php', { show: 0 });
const i = dal.indexOf('foreclosure/'); console.log(dal.slice(Math.max(0, i - 3000), i + 1500).replace(/\s+/g, ' '));
console.log('pdf count', (dal.match(/media\/foreclosure\/[^"]+\.pdf/g) ?? []).length, [...new Set((dal.match(/media\/foreclosure\/([^/]+)\//g) ?? []))]);
// Travis tax office foreclosed
const tr = await hit('Travis foreclosed', 'https://tax-office.traviscountytx.gov/properties/foreclosed', { show: 2000 });
// Harris FRCL form fields
const h = await hit('Harris FRCL', 'https://www.cclerk.hctx.net/Applications/WebSearch/FRCL_R.aspx', { show: 0 });
console.log((h.match(/<(input|select)[^>]*name="[^"]+"[^>]*>/g) ?? []).map((s) => s.match(/name="([^"]+)"/)[1] + (s.match(/type="([^"]+)"/)?.[1] ? ':' + s.match(/type="([^"]+)"/)[1] : '')).join(' '));
console.log(h.replace(/<script[\s\S]*?<\/script>/g, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').slice(0, 2500));
// TABS: work types and tenant finish-outs, Harris last 6 months
const until = new Date(); const since = new Date(Date.now() - 180 * 864e5);
const us = (d) => `${String(d.getUTCMonth() + 1).padStart(2, '0')}/${String(d.getUTCDate()).padStart(2, '0')}/${d.getUTCFullYear()}`;
const form = new URLSearchParams({ draw: '1', start: '0', length: '300', 'order[0][column]': '9', 'order[0][dir]': 'desc', 'columns[9][data]': 'EstimatedCost', LocationCounty: '2101', RegistrationDateBegin: us(since), RegistrationDateEnd: us(until), DataVersionId: '900001' });
const t = j(await hit('TABS Harris', 'https://www.tdlr.texas.gov/TABS/Search/SearchProjects', { method: 'POST', body: form.toString(), headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' }, show: 0 }));
const by = {}; for (const r of t?.data ?? []) by[r.TypeOfWork] = (by[r.TypeOfWork] ?? 0) + 1; console.log(JSON.stringify(by));
for (const r of (t?.data ?? []).filter((r) => r.TypeOfWork !== 9001 && r.TypeOfWork !== 9003).slice(0, 40)) console.log(r.TypeOfWork, r.EstimatedCost, r.ProjectNumber, r.ProjectName, '|', r.FacilityName);
const fin = (t?.data ?? []).find((r) => /finish|tenant|interior|\bTI\b/i.test(r.ProjectName));
if (fin) { const p = await hit('TABS page', `https://www.tdlr.texas.gov/TABS/Search/Project/${fin.ProjectNumber}`, { show: 0 }); console.log(p.replace(/<script[\s\S]*?<\/script>/g, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').slice(0, 3000)); }
