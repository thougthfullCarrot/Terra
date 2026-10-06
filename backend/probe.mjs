// Temporary probe, round 4.
async function hit(label, url, { show = 600, headers = {}, method = 'GET', body } = {}) {
  try {
    const r = await fetch(url, { method, body, headers: { 'user-agent': 'terra-collector/0.1 (+https://github.com/thougthfullCarrot/Terra)', ...headers }, signal: AbortSignal.timeout(40000) });
    const text = await r.text();
    console.log(`\n### ${label} ${r.status} type=${r.headers.get('content-type')} len=${text.length}\n${text.slice(0, show).replace(/\s+/g, ' ')}`);
    return text;
  } catch (e) { console.log(`\n### ${label} FAIL ${e.message}`); return ''; }
}
const j = (t) => { try { return JSON.parse(t); } catch { return null; } };
const strip = (h) => h.replace(/<(script|style)[\s\S]*?<\/\1>/gi, '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ');
const L = 'https://services2.arcgis.com/uXyoacYrZTPTKD3R/arcgis/rest/services/CCAD_Parcel_Feature_Set/FeatureServer/4';
const d = j(await hit('CCAD 4', `${L}?f=json`, { show: 0 })); console.log((d?.fields ?? []).map((f) => f.name).join(','));
const s = j(await hit('CCAD 4 sample', `${L}/query?f=json&where=1%3D1&outFields=*&returnGeometry=false&resultRecordCount=1`, { show: 0 })); console.log(JSON.stringify(s?.features?.[0]?.attributes ?? s).slice(0, 1500));
for (const ua of ['Terra-CRE-research github.com/thougthfullCarrot/Terra', 'Terra CRE research tool', 'Terra CRE research thougthfullCarrot@users.noreply.github.com']) {
  const e = j(await hit(`EDGAR ${ua}`, `https://efts.sec.gov/LATEST/search-index?q=${encodeURIComponent('"lease expires" "Houston, Texas"')}&forms=10-K&dateRange=custom&startdt=2025-07-01&enddt=2026-10-01`, { show: 100, headers: { 'user-agent': ua } }));
  if (e) { console.log('total', e.hits.total.value); for (const h of e.hits.hits.slice(0, 5)) console.log(h._id, JSON.stringify(h._source).slice(0, 500)); 
    const first = e.hits.hits[0]; const [acc, file] = first._id.split(':'); const cik = String(Number(first._source.ciks[0]));
    const url = `https://www.sec.gov/Archives/edgar/data/${cik}/${acc.replace(/-/g, '')}/${file}`;
    const doc = strip(await hit('EDGAR doc', url, { show: 0, headers: { 'user-agent': ua } }));
    console.log(url, doc.length, doc.split(/(?<=\.)\s+/).filter((x) => /lease/i.test(x) && /expir/i.test(x)).slice(0, 8));
    break; }
}
const form = await hit('TABS search page', 'https://www.tdlr.texas.gov/TABS/Search', { show: 0 });
console.log([...form.matchAll(/<(input|select)[^>]*(name|id)="([^"]+)"[^>]*>/g)].map((m) => m[3]).join(' '));
const tw = form.indexOf('TypeOfWork'); console.log(form.slice(tw - 200, tw + 1200).replace(/\s+/g, ' '));
const js = [...form.matchAll(/<script[^>]*src="([^"]+)"/g)].map((m) => m[1]); console.log(js);
for (const q of ['(sells OR sold OR acquires OR buys OR purchased) (Houston OR Dallas OR Austin OR "San Antonio" OR "Fort Worth") (office OR industrial OR apartments OR retail OR warehouse OR multifamily) million when:7d']) {
  const t = await hit('news deals', `https://news.google.com/rss/search?q=${encodeURIComponent(q)}&hl=en-US&gl=US&ceid=US:en`, { show: 0 });
  console.log((t.match(/<title>[^<]*<\/title>/g) ?? []).slice(0, 40).join('\n'));
}
