// Phase 0 Raw Land probe, round 5. Read-only GETs. Prints counts, account ids, zoning codes and
// field names only: no owner names, situs or mailing addresses go to the (public) log.
import * as turf from '@turf/turf';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
const UA = 'terra-collector/0.1 (+https://github.com/thougthfullCarrot/Terra)';
const out = (k, v) => console.log(`\n### ${k}\n` + String(JSON.stringify(v ?? null)).slice(0, 30000));
function get(url) {
  for (let t = 0; t < 3; t++) {
    try {
      const body = execFileSync('curl', ['-sSL', '-m', '120', '-A', UA, url], { encoding: 'utf8', maxBuffer: 500e6 });
      return JSON.parse(body);
    } catch (e) { if (t === 2) return { _err: String(e.message).slice(0, 200) }; }
  }
}
const q = (base, p) => `${base}/query?` + new URLSearchParams({ f: 'json', ...p });
const CB = 'https://services.arcgis.com/g1fRTDLeMgspWrYp/arcgis/rest/services/BCAD_Parcels/FeatureServer/0';
const SA = 'https://gis.sara-tx.org/ags1/rest/services/FW_Bexar/BCAD_Parcels_PROD/FeatureServer/0';
const Z = 'https://services.arcgis.com/g1fRTDLeMgspWrYp/arcgis/rest/services/COSA_Zoning/FeatureServer/12';

/** Page through every row by OBJECTID keyset (immune to resultOffset quirks), checking transfer limits. */
function pageAll(layer, fields, where = '1=1', size = 2000) {
  const rows = []; let last = -1, pages = 0, exceededPages = 0, shortBeforeEnd = 0;
  for (;;) {
    const r = get(q(layer, { where: `(${where}) AND OBJECTID > ${last}`, outFields: ['OBJECTID', ...fields].join(','), orderByFields: 'OBJECTID ASC', returnGeometry: 'false', resultRecordCount: String(size) }));
    if (r._err || r.error) return { rows, pages, error: r._err ?? r.error };
    const f = r.features ?? []; pages++;
    if (r.exceededTransferLimit) exceededPages++;
    if (!f.length) break;
    if (f.length < size && r.exceededTransferLimit) shortBeforeEnd++;
    for (const x of f) rows.push(x.attributes);
    last = f[f.length - 1].attributes.OBJECTID;
  }
  return { rows, pages, exceededPages, shortBeforeEnd };
}

// ---------- round 6: accounts with values but no CoSA polygon; paginated duplicate-zoning scan
const cbIds = new Set(pageAll(CB, ['PropID']).rows.map((r) => r.PropID).filter((x) => x > 0));
const sa = pageAll(SA, ['Prop_id', 'State_cd', 'City', 'Situs_Zip', 'Market_val', 'Shape__Area', 'Exemptions']);
out('sara.paging', { rows: sa.rows.length, pages: sa.pages, error: sa.error });
if (sa.error || sa.rows.length < 700000) throw new Error('SARA paging incomplete; not profiling');
const seen = new Set(); const miss = [];
for (const r of sa.rows) { if (!(r.Prop_id > 0) || seen.has(r.Prop_id)) continue; seen.add(r.Prop_id); if (!cbIds.has(r.Prop_id)) miss.push(r); }
const tally = (k) => Object.entries(miss.reduce((m, r) => { const v = String(r[k] ?? 'null').trim() || 'blank'; m[v] = (m[v] || 0) + 1; return m; }, {})).sort((a, b) => b[1] - a[1]).slice(0, 25);
const ex = (r) => /EX-XV/.test(r.Exemptions ?? '');
out('valuesOnly.profile', { count: miss.length, byStateCode: tally('State_cd'), byCity: tally('City'), byZip3: Object.entries(miss.reduce((m, r) => { const z = String(r.Situs_Zip ?? '').slice(0, 3) || 'blank'; m[z] = (m[z] || 0) + 1; return m; }, {})).sort((a, b) => b[1] - a[1]).slice(0, 10), withSaraPolygonArea: miss.filter((r) => r.Shape__Area > 0).length, totallyExempt: miss.filter(ex).length, zeroMarket: miss.filter((r) => !r.Market_val).length });
// does a CoSA polygon exist under a sample of them (renumbered vs missing)?
const sample = miss.filter((r, i) => i % Math.max(1, Math.floor(miss.length / 40)) === 0).slice(0, 40);
const under = [];
for (const r of sample) {
  const g = get(q(SA, { where: `Prop_id = ${r.Prop_id}`, returnGeometry: 'true', returnCentroid: 'true', outFields: 'Prop_id', outSR: '4326', resultRecordCount: '1' }));
  const f = g.features?.[0]; const c = f?.centroid ?? (f?.geometry?.rings ? (() => { const ring = f.geometry.rings[0]; const n = ring.length; return { x: ring.reduce((s, p) => s + p[0], 0) / n, y: ring.reduce((s, p) => s + p[1], 0) / n }; })() : null);
  if (!c) { under.push([r.Prop_id, r.State_cd, 'no SARA geometry']); continue; }
  const hit = get(q(CB, { geometry: JSON.stringify({ x: c.x, y: c.y, spatialReference: { wkid: 4326 } }), geometryType: 'esriGeometryPoint', inSR: '4326', spatialRel: 'esriSpatialRelIntersects', outFields: 'PropID,state_cd', returnGeometry: 'false' }));
  under.push([r.Prop_id, r.State_cd, (hit.features ?? []).map((x) => [x.attributes.PropID, x.attributes.state_cd])]);
}
out('valuesOnly.whatIsUnderThem', under);

