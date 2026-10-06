// Temporary probe: which free property sources answer from a runner.
const UA = 'Terra research bot (github.com/thougthfullCarrot/Terra) roddyescamilla3@gmail.com';
async function hit(label, url, { show = 600, headers = {}, method = 'GET', body } = {}) {
  try {
    const r = await fetch(url, { method, body, headers: { 'user-agent': UA, origin: 'https://thougthfullcarrot.github.io', ...headers }, signal: AbortSignal.timeout(40000) });
    const text = await r.text();
    console.log(`\n### ${label} ${r.status} cors=${r.headers.get('access-control-allow-origin')} type=${r.headers.get('content-type')} len=${text.length}\n${text.slice(0, show).replace(/\s+/g, ' ')}`);
    return text;
  } catch (e) { console.log(`\n### ${label} FAIL ${e.message}`); return ''; }
}
async function fields(label, layer) {
  const t = await hit(label, `${layer}?f=json`, { show: 0 });
  try { console.log((JSON.parse(t).fields ?? []).map((f) => f.name).join(',')); } catch {}
}
await fields('HOU fields', 'https://mycity2.houstontx.gov/gisweb02/rest/services/HoustonMap/Cadastral/MapServer/0');
await fields('FTW fields', 'https://services5.arcgis.com/3ddLCBXe1bRt7mzj/arcgis/rest/services/Parcels_Public_Vview/FeatureServer/0');
await fields('SA fields', 'https://gis.sara-tx.org/ags1/rest/services/FW_Bexar/BCAD_Parcels_PROD/FeatureServer/0');
await fields('AUS fields', 'https://services1.arcgis.com/HGcSYZ5bvjRswoCb/arcgis/rest/services/TCAD_Parcels_Dec_2025/FeatureServer/0');
await hit('HOU addr query', `https://mycity2.houstontx.gov/gisweb02/rest/services/HoustonMap/Cadastral/MapServer/0/query?f=json&where=${encodeURIComponent("SITE_ADDR_1 LIKE '1000 MAIN%'")}&outFields=*&returnGeometry=false&resultRecordCount=2`, { show: 1500 });
for (const q of ['DCAD parcels', 'Dallas County parcels owner', 'Collin parcels', 'tax delinquent Texas', 'foreclosure Texas county', 'Denton parcels', 'Hays parcels', 'Comal parcels', 'El Paso parcels'])
  { const t = await hit(`AGOL ${q}`, `https://www.arcgis.com/sharing/rest/search?f=json&num=8&q=${encodeURIComponent(q + ' type:"Feature Service"')}`, { show: 0 });
    try { for (const i of JSON.parse(t).results) console.log(`  ${i.title} | ${i.owner} | ${i.url}`); } catch {} }
await hit('TX franchise', `https://data.texas.gov/resource/9cir-efmm.json?$limit=2&$where=${encodeURIComponent("upper(taxpayer_name) like '%HINES%'")}`, { show: 1500 });
await hit('EDGAR FTS', `https://efts.sec.gov/LATEST/search-index?q=${encodeURIComponent('"lease expires" "Houston, Texas"')}&forms=10-K&dateRange=custom&startdt=2025-06-01&enddt=2026-10-01`, { show: 1500 });
await hit('EDGAR FTS2', `https://efts.sec.gov/LATEST/search-index?q=${encodeURIComponent('"lease expires" "Dallas, Texas"')}&forms=10-K`, { show: 800 });
await hit('TWC WARN page', 'https://www.twc.texas.gov/data-reports/warn-notice', { show: 300 }).then((t) => console.log((t.match(/href="[^"]*\.(xlsx?|csv)[^"]*"/gi) ?? []).slice(0, 10)));
for (const u of ['https://taxsales.lgbs.com/api/property_sales/?limit=2&state=TX', 'https://taxsales.lgbs.com/api/property_sales/?limit=2&county=HARRIS%20COUNTY', 'https://taxsales.lgbs.com/map?area=TX'])
  await hit('LGBS', u, { show: 1200 });
await hit('PBFCM', 'https://www.pbfcm.com/taxsale.html', { show: 200 }).then((t) => console.log((t.match(/href="[^"]*\.pdf[^"]*"/gi) ?? []).slice(0, 15)));
await hit('MVBA', 'https://mvbalaw.com/tax-sales/', { show: 200 }).then((t) => console.log((t.match(/href="[^"]*(pdf|sale)[^"]*"/gi) ?? []).slice(0, 15)));
for (const [l, u] of [
  ['Harris FRCL', 'https://www.cclerk.hctx.net/Applications/WebSearch/FRCL_R.aspx'],
  ['Dallas FRCL', 'https://www.dallascounty.org/government/county-clerk/recording/foreclosures.php'],
  ['Tarrant FRCL', 'https://www.tarrantcountytx.gov/en/county-clerk/real-property/foreclosures.html'],
  ['Bexar FRCL', 'https://www.bexar.org/2988/Foreclosures'],
  ['Travis FRCL', 'https://www.traviscountytx.gov/county-clerk/foreclosures'],
  ['Collin FRCL', 'https://www.collincountytx.gov/County-Clerk/Pages/Foreclosures.aspx']
]) await hit(l, u, { show: 300 }).then((t) => console.log((t.match(/href="[^"]*(forecl|\.pdf)[^"]*"/gi) ?? []).slice(0, 12)));
await hit('Valhalla iso', `https://valhalla1.openstreetmap.de/isochrone?json=${encodeURIComponent(JSON.stringify({ locations: [{ lat: 29.76, lon: -95.37 }], costing: 'auto', contours: [{ time: 10 }, { time: 20 }, { time: 30 }], polygons: true, generalize: 150 }))}`, { show: 300 });
await hit('ORS', 'https://api.openrouteservice.org/v2/isochrones/driving-car', { show: 200 });
await hit('LODES', 'https://lehd.ces.census.gov/data/lodes/LODES8/tx/wac/', { show: 0 }).then((t) => console.log((t.match(/tx_wac_S000_JT00_\d+\.csv\.gz/g) ?? []).slice(-3)));
await hit('Gazetteer', 'https://www2.census.gov/geo/docs/maps-data/data/gazetteer/2024_Gazetteer/2024_gaz_tracts_48.txt', { show: 300 });
await hit('ACS tracts', 'https://api.census.gov/data/2023/acs/acs5?get=B01003_001E&for=tract:*&in=state:48&in=county:201', { show: 200 });
await hit('Google news sale', `https://news.google.com/rss/search?q=${encodeURIComponent('Houston office building sold million')}&hl=en-US&gl=US&ceid=US:en`, { show: 0 }).then((t) => console.log((t.match(/<title>[^<]*<\/title>/g) ?? []).slice(0, 12).join('\n')));
