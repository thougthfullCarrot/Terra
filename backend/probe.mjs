// Temporary probe, round 2: parcel layer fields, broker report text, zoning layers.
import { execSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36';
async function get(url) {
  try {
    const r = await fetch(url, { headers: { 'user-agent': UA }, redirect: 'follow', signal: AbortSignal.timeout(45000) });
    return { status: r.status, url: r.url, text: await r.text() };
  } catch (e) { return { status: 'ERR ' + e.message, url, text: '' }; }
}
const json = async (url) => { const r = await get(url); try { return JSON.parse(r.text); } catch { return { _status: r.status, _text: r.text.slice(0, 300) }; } };
const strip = (html) => html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/&nbsp;|&#160;/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ');

console.log('==== TxGIO Parcels folder');
const base = 'https://feature.geographic.texas.gov/arcgis/rest/services';
const folder = await json(`${base}/Parcels?f=json`);
console.log(JSON.stringify(folder).slice(0, 1500));
for (const s of folder.services ?? []) {
  const svc = await json(`${base}/${s.name}/${s.type}?f=json`);
  console.log(`\n# ${s.name} ${s.type}: layers ${JSON.stringify((svc.layers ?? []).map((l) => [l.id, l.name])).slice(0, 600)}`);
  const layer = (svc.layers ?? [])[0];
  if (!layer) continue;
  const info = await json(`${base}/${s.name}/${s.type}/${layer.id}?f=json`);
  console.log('fields: ' + (info.fields ?? []).map((f) => `${f.name}:${f.type.replace('esriFieldType', '')}`).join(', '));
  console.log('maxRecordCount', info.maxRecordCount, 'caps', info.capabilities);
  for (const where of ["COUNTY='Dallas' AND SITUS_CITY='DALLAS'", "SITUS_CITY='DALLAS'", "CNTY_NM='Dallas'"]) {
    const q = await json(`${base}/${s.name}/${s.type}/${layer.id}/query?where=${encodeURIComponent(where)}&outFields=*&returnGeometry=false&resultRecordCount=3&f=json`);
    console.log(`where ${where}: ${JSON.stringify(q).slice(0, 1800)}`);
    if (q.features?.length) break;
  }
}

console.log('\n\n==== Zoning layers');
const zoning = {
  Dallas: 'https://services2.arcgis.com/rwnOSbfKSwyTBcwN/arcgis/rest/services/Dallas_Zoning/FeatureServer/0',
  'Fort Worth': 'https://mapit.fortworthtexas.gov/ags/rest/services/CIVIC/OpenData_Boundaries/MapServer/54',
  'El Paso': 'https://gis.elpasotexas.gov/dev/rest/services/Planning/Zoning/FeatureServer/0'
};
for (const q of ['owner:CoSAGIS_Opendata zoning', 'owner:CTM.Publisher zoning', 'austin zoning district', 'New Braunfels zoning districts']) {
  const r = await json(`https://www.arcgis.com/sharing/rest/search?f=json&num=10&q=${encodeURIComponent(q)}`);
  console.log(`\n# search ${q}`);
  for (const i of r.results ?? []) console.log(`  ${i.title} | ${i.type} | ${i.owner} | ${i.url}`);
}
for (const [city, url] of Object.entries(zoning)) {
  const info = await json(`${url}?f=json`);
  console.log(`\n# ${city} ${info.name}: ${(info.fields ?? []).map((f) => f.name).join(', ')}`);
  const q = await json(`${url}/query?where=1%3D1&outFields=*&returnGeometry=false&resultRecordCount=2&f=json`);
  console.log(JSON.stringify(q.features ?? q).slice(0, 700));
}

console.log('\n\n==== Partners report pages');
for (const url of ['https://partnersrealestate.com/research/dallas-office-q2-2026-quarterly-market-report/', 'https://partnersrealestate.com/research/houston-industrial-q2-2026-quarterly-market-report/', 'https://partnersrealestate.com/research/san-antonio-retail-q2-2026-quarterly-market-report/']) {
  const r = await get(url);
  const text = strip(r.text);
  const i = text.search(/vacancy|asking/i);
  console.log(`\n# ${url} ${r.status}\n${text.slice(Math.max(0, i - 600), i + 2500)}`);
  const pdfs = [...new Set([...r.text.matchAll(/https?:[^"'\s<>]+\.pdf/gi)].map((m) => m[0]))];
  console.log('PDFs: ' + pdfs.join(' '));
}

console.log('\n\n==== Lee & Associates Texas');
const lee = await get('https://www.lee-associates.com/research/');
console.log([...new Set([...lee.text.matchAll(/https?:[^"'\s<>]+\.pdf/gi)].map((m) => m[0]))].filter((u) => /-TX-|texas/i.test(u)).join('\n'));

console.log('\n\n==== Cushman PDFs as text');
try { execSync('sudo apt-get install -y -qq poppler-utils >/dev/null 2>&1'); } catch {}
const dfw = await get('https://www.cushmanwakefield.com/en/united-states/insights/us-marketbeats/dallas-ft-worth-marketbeats');
const hou = await get('https://www.cushmanwakefield.com/en/united-states/insights/us-marketbeats/houston-marketbeats');
const pdfs = [...new Set([...(dfw.text + hou.text).matchAll(/https?:[^"'\s<>]+\.pdf/gi)].map((m) => m[0]))];
console.log(pdfs.join('\n'));
for (const pdf of pdfs.filter((p) => !/multifamily/i.test(p)).slice(0, 5)) {
  const r = await fetch(pdf, { headers: { 'user-agent': UA } });
  writeFileSync('/tmp/r.pdf', Buffer.from(await r.arrayBuffer()));
  const text = execSync('pdftotext -layout /tmp/r.pdf - 2>&1 || true').toString();
  console.log(`\n######## ${pdf} (${r.status})\n${text.split('\n').slice(0, 90).join('\n')}`);
  const tail = text.split('\n').filter((l) => /TOTAL|Total|Overall|Class A|CBD|Asking/i.test(l)).slice(0, 40);
  console.log('--- lines with totals:\n' + tail.join('\n'));
}
