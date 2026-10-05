// Temporary: what broker research, zoning and parcel sources answer from a runner.
const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36';
async function get(url, opts = {}) {
  try {
    const r = await fetch(url, { headers: { 'user-agent': UA, accept: '*/*' }, redirect: 'follow', signal: AbortSignal.timeout(30000), ...opts });
    const text = await r.text();
    return { status: r.status, url: r.url, text };
  } catch (e) {
    return { status: 'ERR ' + e.message, url, text: '' };
  }
}
const CITY = /dallas|fort[- ]worth|dfw|houston|austin|san[- ]antonio|el[- ]paso|texas/i;
async function page(url, extra = /marketbeat|report|research|\.pdf/i) {
  const r = await get(url);
  const title = /<title[^>]*>([^<]*)/i.exec(r.text)?.[1]?.trim();
  console.log(`\n### ${url}\n-> ${r.status} ${r.url} len=${r.text.length} title=${title}`);
  const hrefs = [...new Set([...r.text.matchAll(/href=["']([^"'#]+)["']/gi)].map((m) => m[1]))].filter((h) => CITY.test(h) && extra.test(h));
  for (const h of hrefs.slice(0, 40)) console.log('  ' + h);
  const pdfs = [...new Set([...r.text.matchAll(/https?:[^"'\s<>]+\.pdf/gi)].map((m) => m[0]))];
  for (const p of pdfs.slice(0, 15)) console.log('  PDF ' + p);
  return r;
}
const pages = [
  'https://www.cushmanwakefield.com/en/united-states/insights/us-marketbeats',
  'https://www.cushmanwakefield.com/en/united-states/insights/us-marketbeats/dallas-fort-worth-marketbeats',
  'https://www.cushmanwakefield.com/en/united-states/insights/us-marketbeats/houston-marketbeats',
  'https://www.cushmanwakefield.com/en/united-states/insights/us-marketbeats/austin-marketbeats',
  'https://www.cushmanwakefield.com/en/united-states/insights/us-marketbeats/san-antonio-marketbeats',
  'https://www.cushmanwakefield.com/en/united-states/insights/us-marketbeats/el-paso-marketbeats',
  'https://www.cbre.com/insights/books/us-real-estate-market-outlook-2026',
  'https://www.cbre.com/insights#market-reports',
  'https://www.cbre.com/insights/figures',
  'https://www.us.jll.com/en/trends-and-insights/research',
  'https://www.jll.com/en-us/insights/market-dynamics',
  'https://www.jll.com/en-us/insights/market-dynamics/dallas-fort-worth-office',
  'https://www.colliers.com/en/research',
  'https://www.colliers.com/en/united-states/research',
  'https://www.marcusmillichap.com/research',
  'https://www.marcusmillichap.com/research/market-reports',
  'https://www.lee-associates.com/research/',
  'https://www.lee-associates.com/market-reports/',
  'https://www.avisonyoung.us/web/dallas/market-reports',
  'https://www.nmrk.com/insights',
  'https://www.nmrk.com/insights/market-report',
  'https://transwestern.com/research',
  'https://partnersrealestate.com/research/',
  'https://www.naipartners.com/research/',
  'https://www.weitzmangroup.com/research',
  'https://www.stream.cre/research',
  'https://www.mohrpartners.com/research'
];
for (const url of pages) await page(url);

console.log('\n\n==== robots.txt');
for (const host of ['www.cushmanwakefield.com', 'www.cbre.com', 'www.jll.com', 'www.colliers.com', 'www.marcusmillichap.com', 'www.lee-associates.com', 'www.nmrk.com', 'partnersrealestate.com', 'www.avisonyoung.us', 'transwestern.com']) {
  const r = await get(`https://${host}/robots.txt`);
  const lines = r.text.split('\n').filter((l) => /^(user-agent: \*|disallow|allow)/i.test(l.trim())).slice(0, 25);
  console.log(`\n# ${host} ${r.status}\n` + lines.join('\n'));
}

console.log('\n\n==== ArcGIS Online: zoning and parcel layers');
for (const q of ['Dallas zoning', 'Dallas parcels', 'Houston parcels', 'HCAD parcels', 'Fort Worth zoning', 'Tarrant parcels', 'Austin zoning', 'Travis parcels TCAD', 'San Antonio zoning', 'Bexar parcels', 'El Paso zoning', 'El Paso parcels', 'Texas parcels StratMap', 'New Braunfels zoning']) {
  const r = await get(`https://www.arcgis.com/sharing/rest/search?f=json&num=8&q=${encodeURIComponent(q + ' type:"Feature Service"')}`);
  let items = [];
  try { items = JSON.parse(r.text).results ?? []; } catch {}
  console.log(`\n# ${q}`);
  for (const i of items) console.log(`  ${i.title} | ${i.owner} | ${i.url} | views ${i.numViews} | mod ${new Date(i.modified).toISOString().slice(0, 10)}`);
}

console.log('\n\n==== TxGIO StratMap land parcels');
for (const url of ['https://data.geographic.texas.gov/collection/?c=2679b514-bb7b-409f-97f3-ee3879f34448', 'https://feature.geographic.texas.gov/arcgis/rest/services?f=json', 'https://feature.tnris.org/arcgis/rest/services?f=json']) {
  const r = await get(url);
  console.log(`\n# ${url} -> ${r.status} len=${r.text.length}\n${r.text.slice(0, 1500)}`);
}
