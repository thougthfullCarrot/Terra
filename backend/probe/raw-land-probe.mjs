// Raw Land probe, round 8: find and verify a city-limits source for Bexar County. Boundary layers only:
// no parcel, value, owner or address data is read. The log prints layer names, fields, counts, city names, dates.
import { execFileSync } from 'node:child_process';
import * as turf from '@turf/turf';
const UA = 'terra-collector/0.1 (+https://github.com/thougthfullCarrot/Terra)';
const out = (k, v) => console.log(`\n### ${k}\n` + String(JSON.stringify(v ?? null)).slice(0, 20000));
function get(url) { for (let t = 0; t < 3; t++) { try { return JSON.parse(execFileSync('curl', ['-sS', '--fail-with-body', '-L', '-m', '90', '-A', UA, url], { encoding: 'utf8', maxBuffer: 5e8 })); } catch (e) { if (t === 2) return { _err: String(e.message).slice(0, 200) }; } } }
const ROOTS = ['https://services.arcgis.com/g1fRTDLeMgspWrYp/arcgis/rest/services', 'https://maps.bexar.org/arcgis/rest/services', 'https://gis.sara-tx.org/ags1/rest/services'];
const hits = [];
async function walk(root, folder = '') {
  const r = get(`${root}${folder ? '/' + folder : ''}?f=json`); if (r._err || r.error) { out(`list ${root}/${folder}`, r._err ?? r.error); return; }
  for (const s of r.services ?? []) if (/limit|municip|city|juris|boundar|etj|annex/i.test(s.name)) hits.push(`${root}/${s.name}/${s.type}`);
  if (!folder) for (const f of r.folders ?? []) await walk(root, f);
}
for (const r of ROOTS) await walk(r);
out('candidateServices', hits);
const layers = [];
for (const svc of hits.slice(0, 40)) {
  const s = get(`${svc}?f=json`); for (const l of s.layers ?? []) if (/limit|municip|city|juris|boundar|etj/i.test(l.name)) layers.push({ url: `${svc}/${l.id}`, name: l.name });
}
const report = [];
for (const l of layers.slice(0, 30)) {
  const m = get(`${l.url}?f=json`); if (m._err || m.error || m.geometryType !== 'esriGeometryPolygon') continue;
  const c = get(`${l.url}/query?f=json&where=1%3D1&returnCountOnly=true`);
  const strField = (m.fields ?? []).filter((f) => f.type === 'esriFieldTypeString').map((f) => f.name);
  const nameField = strField.find((f) => /^(name|city|cityname|city_name|municipality|muni|juris|jurisdiction|label|NAME)$/i.test(f)) ?? strField[0];
  const vals = nameField ? get(`${l.url}/query?f=json&where=1%3D1&outFields=${nameField}&returnDistinctValues=true&returnGeometry=false`) : {};
  report.push({ ...l, count: c.count ?? c.error, edited: m.editingInfo?.lastEditDate ? new Date(m.editingInfo.lastEditDate).toISOString() : null, copyright: m.copyrightText?.slice(0, 120), description: String(m.description ?? '').replace(/<[^>]+>/g, '').slice(0, 200), fields: (m.fields ?? []).map((f) => f.name).join(','), nameField, names: (vals.features ?? []).map((f) => f.attributes[nameField]).sort().slice(0, 60) });
}
out('cityLimitLayers', report);
// spot-check: known points (city hall-ish coordinates) must fall in the right city
const POINTS = [['San Antonio', -98.4936, 29.4241], ['Alamo Heights', -98.4655, 29.4844], ['Leon Valley', -98.6160, 29.4952], ['Universal City', -98.2914, 29.5480], ['Converse', -98.3164, 29.5180], ['Schertz', -98.2697, 29.5522], ['Helotes', -98.6897, 29.5780], ['Live Oak', -98.3364, 29.5652], ['unincorporated (Bexar west)', -98.8000, 29.3500]];
for (const r of report.slice(0, 6)) {
  r.spot = POINTS.map(([want, x, y]) => { const h = get(`${r.url}/query?f=json&geometry=${x},${y}&geometryType=esriGeometryPoint&inSR=4326&spatialRel=esriSpatialRelIntersects&outFields=${r.nameField}&returnGeometry=false`); return [want, h._err || h.error ? 'ERR' : (h.features ?? []).map((f) => f.attributes[r.nameField])]; });
}
out('spotChecks', report.slice(0, 6).map((r) => ({ url: r.url, spot: r.spot })));
