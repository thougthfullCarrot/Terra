// Temporary probe, round 3.
const UA = 'terra-collector/0.1 (+https://github.com/thougthfullCarrot/Terra)';
async function hit(label, url, { show = 600, headers = {}, method = 'GET', body } = {}) {
  try {
    const r = await fetch(url, { method, body, headers: { 'user-agent': UA, ...headers }, signal: AbortSignal.timeout(40000) });
    const text = await r.text();
    console.log(`\n### ${label} ${r.status} type=${r.headers.get('content-type')} len=${text.length}\n${text.slice(0, show).replace(/\s+/g, ' ')}`);
    return text;
  } catch (e) { console.log(`\n### ${label} FAIL ${e.message}`); return ''; }
}
const j = (t) => { try { return JSON.parse(t); } catch { return null; } };
const strip = (h) => h.replace(/<(script|style)[\s\S]*?<\/\1>/gi, '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ');
async function fields(label, layer) {
  const d = j(await hit(label, `${layer}?f=json`, { show: 0 }));
  console.log(d?.name, (d?.fields ?? []).map((f) => f.name).join(','), d?.layers?.map((l) => `${l.id}:${l.name}`).join(' '));
  if (!d?.fields) return;
  const s = j(await hit(label + ' sample', `${layer}/query?f=json&where=1%3D1&outFields=*&returnGeometry=false&resultRecordCount=1`, { show: 0 }));
  console.log(JSON.stringify(s?.features?.[0]?.attributes ?? s).slice(0, 1500));
}
await fields('Dallas_Co_Parcels root', 'https://services.arcgis.com/6dxqrE38upDMg1va/arcgis/rest/services/Dallas_Co_Parcels/FeatureServer');
await fields('Dallas_Co_Parcels 0', 'https://services.arcgis.com/6dxqrE38upDMg1va/arcgis/rest/services/Dallas_Co_Parcels/FeatureServer/0');
await fields('COD Parcels root', 'https://services2.arcgis.com/rwnOSbfKSwyTBcwN/arcgis/rest/services/Parcels/FeatureServer');
await fields('COD Parcels 0', 'https://services2.arcgis.com/rwnOSbfKSwyTBcwN/arcgis/rest/services/Parcels/FeatureServer/0');
await fields('CCAD root', 'https://services2.arcgis.com/uXyoacYrZTPTKD3R/arcgis/rest/services/CCAD_Parcel_Feature_Set/FeatureServer');
await fields('CCAD 0', 'https://services2.arcgis.com/uXyoacYrZTPTKD3R/arcgis/rest/services/CCAD_Parcel_Feature_Set/FeatureServer/0');
// EDGAR with the production UA and a recent window
const q = encodeURIComponent('"lease expires" "Houston, Texas"');
const e = j(await hit('EDGAR prod UA', `https://efts.sec.gov/LATEST/search-index?q=${q}&forms=10-K&dateRange=custom&startdt=2025-07-01&enddt=2026-10-01`, { show: 200 }));
console.log('total', e?.hits?.total?.value);
for (const h of (e?.hits?.hits ?? []).slice(0, 8)) console.log(h._id, JSON.stringify(h._source).slice(0, 400));
const first = e?.hits?.hits?.[0];
if (first) {
  const [acc, file] = first._id.split(':');
  const cik = String(Number(first._source.ciks[0]));
  const url = `https://www.sec.gov/Archives/edgar/data/${cik}/${acc.replace(/-/g, '')}/${file}`;
  const doc = strip(await hit('EDGAR doc', url, { show: 0 }));
  const sentences = doc.split(/(?<=\.)\s+/).filter((s) => /lease/i.test(s) && /expir/i.test(s) && /Texas/i.test(s));
  console.log(url, doc.length, sentences.slice(0, 6));
}
// Harris FRCL postback
const page = await hit('Harris FRCL get', 'https://www.cclerk.hctx.net/Applications/WebSearch/FRCL_R.aspx', { show: 0 });
const hidden = Object.fromEntries([...page.matchAll(/<input[^>]*type="hidden"[^>]*>/g)].map((m) => [m[0].match(/name="([^"]+)"/)?.[1], m[0].match(/value="([^"]*)"/)?.[1] ?? '']).filter(([k]) => k));
console.log('radios', [...page.matchAll(/<input[^>]*rbtlDate[^>]*>/g)].map((m) => m[0]));
console.log('months', [...page.matchAll(/<option[^>]*value="([^"]*)"[^>]*>([^<]*)</g)].map((m) => `${m[1]}=${m[2]}`).join(' '));
for (const [kind, month] of [['SaleDate', '11'], ['FileDate', '9']]) {
  const form = new URLSearchParams({ ...hidden, 'ctl00$ContentPlaceHolder1$rbtlDate': kind, 'ctl00$ContentPlaceHolder1$ddlYear': '2026', 'ctl00$ContentPlaceHolder1$ddlMonth': month, 'ctl00$ContentPlaceHolder1$btnSearch': 'Search' });
  const res = await hit(`Harris FRCL post ${kind} ${month}`, 'https://www.cclerk.hctx.net/Applications/WebSearch/FRCL_R.aspx', { method: 'POST', body: form.toString(), headers: { 'content-type': 'application/x-www-form-urlencoded' }, show: 0 });
  const text = strip(res);
  const i = text.indexOf('Document ID');
  console.log(text.slice(i, i + 1500));
  console.log('rows', (res.match(/<tr/g) ?? []).length, 'FRCL links', (res.match(/FRCL[^"']*\.pdf|ViewECart|Doc_ID|DocID/gi) ?? []).length);
}
// Dallas foreclosure links
const dal = await hit('Dallas FRCL', 'https://www.dallascounty.org/government/county-clerk/recording/foreclosures.php', { show: 0 });
const links = [...dal.matchAll(/href="([^"]*foreclosure[^"]*\.pdf)"/g)].map((m) => m[1]);
console.log(links.length, links.slice(0, 5), links.slice(-5));
const k = dal.indexOf('accordion'); console.log(strip(dal.slice(k, k + 6000)).slice(0, 1500));
// Travis RSS
await hit('Travis RSS', 'https://tax-office.traviscountytx.gov/properties/foreclosed?format=feed&type=rss', { show: 2500 });
// TABS alteration page
const p = await hit('TABS page', 'https://www.tdlr.texas.gov/TABS/Search/Project/TABS2026019161', { show: 0 });
console.log(strip(p).slice(0, 3500));
