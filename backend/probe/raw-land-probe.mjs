// Raw Land probe, round 7: rerun of the checks affected by the 2026-10-18 technical review, with
// strict reads (arcgis-read.mjs): any failed, malformed, truncated or inconsistent read stops the
// conclusion that depends on it. Read-only POST queries. The log prints counts, account ids,
// state codes and zoning codes only: no owner names, situs or mailing addresses.
import * as turf from '@turf/turf';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { pageByOid, checkCount, checkFeatures, mustComplete } from './arcgis-read.mjs';
import { bexarLandMarket, joinValues, zoningShares, zoningAttrKey } from './parcel-metrics.mjs';

const UA = 'terra-collector/0.1 (+https://github.com/thougthfullCarrot/Terra)';
const out = (k, v) => console.log(`\n### ${k}\n` + String(JSON.stringify(v ?? null)).slice(0, 30000));
/** POST the query string (long polygons do not fit in a URL). HTTP >= 400, timeouts and bad JSON become { _err }. */
function get(url) {
  const [base, qs] = url.split('?');
  let last;
  for (let t = 0; t < 3; t++) {
    try {
      const body = execFileSync('curl', ['-sS', '--fail-with-body', '-L', '-m', '120', '-A', UA, '-H', 'Content-Type: application/x-www-form-urlencoded', '--data-binary', '@-', base], { input: qs, encoding: 'utf8', maxBuffer: 1e9 });
      return JSON.parse(body);
    } catch (e) { last = String(e.message).slice(0, 200); }
  }
  return { _err: last };
}
const q = (base, p) => `${base}/query?` + new URLSearchParams({ f: 'json', ...p });
const CB = 'https://services.arcgis.com/g1fRTDLeMgspWrYp/arcgis/rest/services/BCAD_Parcels/FeatureServer/0';
const SA = 'https://gis.sara-tx.org/ags1/rest/services/FW_Bexar/BCAD_Parcels_PROD/FeatureServer/0';
const Z = 'https://services.arcgis.com/g1fRTDLeMgspWrYp/arcgis/rest/services/COSA_Zoning/FeatureServer/12';
const count = (layer, p = {}) => checkCount(get(q(layer, { where: '1=1', ...p, returnCountOnly: 'true' })));
/** Every row of a layer (or a filtered/spatial subset), checked against the service's own count. */
function readAll(layer, p, { where = '1=1', fmt = 'json', size = 2000, what } = {}) {
  const expectCount = count(layer, { where, ...p });
  const res = pageByOid(get, (last, n) => q(layer, { where: `(${where}) AND OBJECTID > ${last}`, orderByFields: 'OBJECTID ASC', resultRecordCount: String(n), ...p }).replace('f=json', `f=${fmt}`), { size, expectCount });
  return mustComplete(res, what ?? layer);
}
const SQM_TO_SQFT = 10.763910417;
const area = (g) => turf.area(g) * SQM_TO_SQFT;
const rng = ((s) => () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32))(20261018); // seeded, reproducible
const sampleOf = (arr, k) => { const a = [...arr]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a.slice(0, k); };
const esriPoly = (g) => ({ rings: (g.geometry.type === 'Polygon' ? [g.geometry.coordinates] : g.geometry.coordinates).flat(), spatialReference: { wkid: 4326 } });
const unionAll = (fs) => (fs.length === 1 ? fs[0] : turf.union(turf.featureCollection(fs)));
const gkey = (f) => createHash('sha1').update(JSON.stringify(f.geometry?.coordinates ?? null)).digest('hex').slice(0, 16);
/** One outline per account: owner-repeated rows carry identical geometry, distinct pieces are unioned. */
function outlines(layer, idField, ids, what) {
  const by = new Map();
  for (let i = 0; i < ids.length; i += 25) {
    const chunk = ids.slice(i, i + 25);
    const r = readAll(layer, { outFields: `OBJECTID,${idField}`, returnGeometry: 'true', outSR: '4326' }, { where: `${idField} IN (${chunk.join(',')})`, fmt: 'geojson', size: 500, what });
    for (const f of r.features) { if (!f.geometry) continue; const id = f.properties[idField]; const m = by.get(id) ?? new Map(); m.set(gkey(f), f); by.set(id, m); }
  }
  return new Map([...by].map(([id, m]) => [id, unionAll([...m.values()])]));
}

// ---------- A. full reads, each checked against the service count
const cbCount = count(CB), saCount = count(SA);
const cb = readAll(CB, { outFields: 'OBJECTID,PropID,state_cd,legal_acre', returnGeometry: 'false' }, { what: 'CoSA parcels' });
const SF = ['Prop_id', 'Prop_yr', 'State_cd', 'Market_val', 'Land_hstd_val', 'Land_non_hstd_val', 'Imprv_hstd_val', 'Imprv_non_hstd_val', 'AG_Market', 'AG_Use_val', 'Land_acres', 'Shape__Area'];
const sa = readAll(SA, { outFields: ['OBJECTID', ...SF].join(','), returnGeometry: 'false' }, { what: 'SARA parcels' });
const cbRows = cb.features.map((f) => f.attributes), saRows = sa.features.map((f) => f.attributes);
out('A.reads', { cosa: { serviceCount: cbCount, read: cbRows.length, pages: cb.pages, status: cb.status }, sara: { serviceCount: saCount, read: saRows.length, pages: sa.pages, status: sa.status } });

const cbBy = new Map();
for (const r of cbRows) if (r.PropID > 0) { const a = cbBy.get(r.PropID) ?? { polygons: 0, acres: r.legal_acre, code: r.state_cd }; a.polygons++; cbBy.set(r.PropID, a); }
out('A.cosaIds', { rowsPositiveId: cbRows.filter((r) => r.PropID > 0).length, rowsNonPositiveOrNull: cbRows.filter((r) => !(r.PropID > 0)).length, uniqueAccounts: cbBy.size, multiPolygonAccounts: [...cbBy.values()].filter((a) => a.polygons > 1).length });

const saBy = new Map();
for (const r of saRows) if (r.Prop_id > 0 && !saBy.has(r.Prop_id)) saBy.set(r.Prop_id, r);

// ---------- B. null / type census of value components, full dataset (first row per account)
const census = Object.fromEntries(SF.filter((k) => k !== 'Prop_id').map((k) => [k, {}]));
for (const r of saBy.values()) for (const k of Object.keys(census)) { const v = r[k]; const t = v === null || v === undefined ? 'null' : typeof v === 'string' ? (v.trim() === '' ? 'emptyString' : 'string') : typeof v; census[k][t] = (census[k][t] ?? 0) + 1; }
const strict = { reconciles: 0, unavailableMissing: 0, unavailableMismatch: 0, missingFields: {} };
for (const r of saBy.values()) { const x = bexarLandMarket(r); if (x.reconciles) strict.reconciles++; else if (x.missing.length) { strict.unavailableMissing++; for (const m of x.missing) strict.missingFields[m] = (strict.missingFields[m] ?? 0) + 1; } else strict.unavailableMismatch++; }
out('B.componentCensus', { accounts: saBy.size, types: census, strictRule: strict });
out('B.shapeArea', { accounts: saBy.size, nullOrMissing: [...saBy.values()].filter((r) => r.Shape__Area == null).length, nonPositive: [...saBy.values()].filter((r) => r.Shape__Area != null && !(r.Shape__Area > 0)).length });

// ---------- C. join census, full dataset, with separated statuses
const values = new Map([...saBy].map(([id, r]) => [id, { acres: r.Land_acres }]));
const geometry = new Map([...cbBy].map(([id, a]) => [id, { acres: a.acres, polygons: a.polygons }]));
const joined = joinValues(values, geometry);
const tallyStatus = {}; for (const j of joined.values()) tallyStatus[j.status] = (tallyStatus[j.status] ?? 0) + 1;
let codeChanged = 0; for (const [id, a] of cbBy) { const s = saBy.get(id); if (s && String(s.State_cd ?? '').trim() !== String(a.code ?? '').trim()) codeChanged++; }
out('C.join', { statuses: tallyStatus, matchedIdsWithStateCodeChange: codeChanged });

// ---------- D. outline comparison on a random sample of matched, area-agreeing single-polygon accounts
const agreeing = [...joined].filter(([, j]) => j.area === 'agrees').map(([id]) => id);
const dSample = sampleOf(agreeing, 200);
const dCb = outlines(CB, 'PropID', dSample, 'CoSA outlines'), dSa = outlines(SA, 'Prop_id', dSample, 'SARA outlines');
const iou = new Map(); let dErr = 0;
for (const id of dSample) {
  const a = dCb.get(id), b = dSa.get(id); if (!a || !b) { dErr++; continue; }
  try { const i = turf.intersect(turf.featureCollection([a, b])); const u = turf.union(turf.featureCollection([a, b])); iou.set(id, i ? area(i) / area(u) : 0); } catch { dErr++; }
}
const withOutline = joinValues(new Map(dSample.map((id) => [id, values.get(id)])), new Map(dSample.map((id) => [id, geometry.get(id)])), { outline: iou });
const dT = {}; for (const j of withOutline.values()) dT[j.geometry] = (dT[j.geometry] ?? 0) + 1;
out('D.outlineSample', { population: agreeing.length, sampled: dSample.length, compared: iou.size, errors: dErr, byOutline: dT, iouBuckets: { ge99: [...iou.values()].filter((x) => x >= 0.99).length, '95to99': [...iou.values()].filter((x) => x >= 0.95 && x < 0.99).length, '80to95': [...iou.values()].filter((x) => x >= 0.8 && x < 0.95).length, lt80: [...iou.values()].filter((x) => x < 0.8).length }, differIds: [...iou].filter(([, x]) => x < 0.95).slice(0, 15).map(([id, x]) => [id, +x.toFixed(3)]) });

// ---------- E. values-only accounts: polygon-to-polygon overlap on a random sample
const valuesOnly = [...joined].filter(([, j]) => j.mapped === false).map(([id]) => id);
const eSample = sampleOf(valuesOnly, 300);
const eSa = outlines(SA, 'Prop_id', eSample, 'SARA outlines (values-only)');
const classes = {}; const ex = {}; let pointAgrees = 0, pointChecked = 0;
for (const id of eSample) {
  const p = eSa.get(id); let cls;
  if (!p) cls = 'no SARA outline returned';
  else {
    const hits = mustComplete(pageByOid(get, (last, n) => q(CB, { where: `OBJECTID > ${last}`, geometry: JSON.stringify(esriPoly(p)), geometryType: 'esriGeometryPolygon', inSR: '4326', spatialRel: 'esriSpatialRelIntersects', outFields: 'OBJECTID,PropID', returnGeometry: 'true', outSR: '4326', orderByFields: 'OBJECTID ASC', resultRecordCount: String(n) }).replace('f=json', 'f=geojson'), { size: 500 }), `CoSA overlap ${id}`).features;
    let share = 0;
    try { const parts = hits.map((h) => turf.intersect(turf.featureCollection([p, h]))).filter(Boolean); share = parts.length ? area(unionAll(parts)) / area(p) : 0; } catch { cls = 'geometry error'; }
    // the old method, for comparison: does an interior point (not a vertex mean) fall in a CoSA polygon?
    const pt = turf.pointOnFeature(p); pointChecked++;
    const ptHit = hits.some((h) => turf.booleanPointInPolygon(pt, h));
    if ((share >= 0.01) === ptHit) pointAgrees++;
    if (!cls) {
      const otherIds = [...new Set(hits.map((h) => h.properties.PropID))];
      if (share < 0.01) cls = 'no CoSA polygon overlaps (coverage gap)';
      else if (share >= 0.5) cls = otherIds.some((x) => x > 0 && !saBy.has(x)) ? 'covered by CoSA account(s) absent from 2025 values (renumbered/replatted candidate)' : 'covered by other 2025 accounts (overlapping records)';
      else cls = 'partly overlapped';
    }
  }
  classes[cls] = (classes[cls] ?? 0) + 1; (ex[cls] ??= []).length < 8 && ex[cls].push(id);
}
const cut = (n) => { const p = n / eSample.length, se = Math.sqrt(p * (1 - p) / eSample.length); return [+(p - 1.96 * se).toFixed(3), +(p + 1.96 * se).toFixed(3)]; };
out('E.valuesOnlySample', { population: valuesOnly.length, sampled: eSample.length, classes, approx95pctIntervalShare: Object.fromEntries(Object.entries(classes).map(([k, v]) => [k, cut(v)])), interiorPointAgreesWithPolygonOverlap: `${pointAgrees}/${pointChecked}`, exampleIds: ex });

// ---------- F. zoning: per-parcel recheck and dense downtown scan, strict reads, attribute-aware dedupe
const ZF = 'OBJECTID,Zoning,Base,SpecDistrict,SpecCondition,CaseNo,OrdinanceKey,ModifiedDate';
const zRes = [];
for (const id of [102742, 100293, 561765, 110179, 100288, 100297, 100431, 333888]) {
  const pf = outlines(CB, 'PropID', [id], `parcel ${id}`).get(id);
  if (!pf) { zRes.push({ id, status: 'parcel not found' }); continue; }
  const zf = mustComplete(pageByOid(get, (last, n) => q(Z, { where: `OBJECTID > ${last}`, geometry: JSON.stringify(esriPoly(pf)), geometryType: 'esriGeometryPolygon', inSR: '4326', spatialRel: 'esriSpatialRelIntersects', outFields: ZF, returnGeometry: 'true', outSR: '4326', orderByFields: 'OBJECTID ASC', resultRecordCount: String(n) }).replace('f=json', 'f=geojson'), { size: 1000 }), `zoning ${id}`).features;
  const pieces = []; const inter = [];
  for (const z of zf) { let i; try { i = turf.intersect(turf.featureCollection([pf, z])); } catch { zRes.push({ id, geometryErrorOn: z.properties.OBJECTID }); continue; } if (!i) continue; inter.push(i); pieces.push({ code: z.properties.Zoning, sqft: area(i), geomKey: gkey(z), attrKey: zoningAttrKey(z.properties) }); }
  const s = zoningShares(area(pf), pieces, inter.length ? area(unionAll(inter)) : 0);
  zRes.push({ id, polygonsRead: zf.length, status: s.status, uncovered: +s.uncoveredShare.toFixed(4), overlap: +s.overlapShare.toFixed(4), duplicates: s.duplicatePieces, conflict: s.conflict, districts: s.districts.map((d) => [d.code, +d.share.toFixed(4)]) });
}
out('F.zoningPerParcel', zRes);

const box = JSON.stringify({ xmin: -98.53, ymin: 29.39, xmax: -98.47, ymax: 29.45, spatialReference: { wkid: 4326 } });
const sp = { geometry: box, geometryType: 'esriGeometryEnvelope', inSR: '4326', spatialRel: 'esriSpatialRelIntersects' };
const scan = readAll(Z, { ...sp, outFields: ZF, returnGeometry: 'true', outSR: '4326', geometryPrecision: '7' }, { fmt: 'geojson', what: 'downtown zoning scan' });
const groups = {}; for (const f of scan.features) (groups[gkey(f)] ??= []).push(f.properties);
const dup = Object.values(groups).filter((g) => g.length > 1);
const sameAll = dup.filter((g) => new Set(g.map(zoningAttrKey)).size === 1);
const diffZoning = dup.filter((g) => new Set(g.map((p) => String(p.Zoning ?? '').trim())).size > 1);
const sameZoningDiffAttrs = dup.filter((g) => new Set(g.map((p) => String(p.Zoning ?? '').trim())).size === 1 && new Set(g.map(zoningAttrKey)).size > 1);
out('F.zoningScan', { status: scan.status, pages: scan.pages, polygons: scan.features.length, uniqueOids: new Set(scan.features.map((f) => f.properties.OBJECTID)).size, identicalGeometryGroups: dup.length, identicalAttributes: sameAll.length, differentZoningString: diffZoning.length, sameZoningStringDifferentStructuredFields: sameZoningDiffAttrs.length, examples: diffZoning.slice(0, 10).map((g) => g.map((p) => [p.OBJECTID, p.Zoning, p.CaseNo ?? null, p.ModifiedDate ?? null])), structuredExamples: sameZoningDiffAttrs.slice(0, 5).map((g) => g.map((p) => [p.OBJECTID, p.Zoning, p.Base, p.SpecDistrict, p.SpecCondition])) });
console.log('\n### done');
