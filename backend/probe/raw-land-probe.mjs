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

// ---------- 1. The 512,000 count
const cbCount = get(q(CB, { where: '1=1', returnCountOnly: 'true' }));
const cbIds = get(q(CB, { where: '1=1', returnIdsOnly: 'true' }));
const cbMax = get(q(CB, { where: '1=1', outStatistics: JSON.stringify([{ statisticType: 'max', onStatisticField: 'OBJECTID', outStatisticFieldName: 'mx' }, { statisticType: 'count', onStatisticField: 'OBJECTID', outStatisticFieldName: 'n' }]) }));
const cb = pageAll(CB, ['PropID', 'state_cd', 'legal_acre', 'LandSqft', 'ParcelArea']);
const cbIdSet = new Map();
for (const r of cb.rows) { if (r.PropID > 0) cbIdSet.set(r.PropID, (cbIdSet.get(r.PropID) ?? 0) + 1); }
out('count.cosaBcad', {
  returnCountOnly: cbCount.count, returnIdsOnly: cbIds.objectIds?.length, statistics: cbMax.features?.[0]?.attributes,
  paged: { rows: cb.rows.length, pages: cb.pages, exceededPages: cb.exceededPages, shortBeforeEnd: cb.shortBeforeEnd, error: cb.error },
  uniqueObjectIds: new Set(cb.rows.map((r) => r.OBJECTID)).size,
  positiveAccounts: cbIdSet.size, negativeIdPolygons: cb.rows.filter((r) => !(r.PropID > 0)).length,
  accountsWithManyPolygons: [...cbIdSet.values()].filter((n) => n > 1).length
});

// ---------- 2. SARA: every row, collapsed to accounts; component arithmetic
const sa = pageAll(SA, ['Prop_id', 'Prop_yr', 'State_cd', 'Land_acres', 'Market_val', 'Land_hstd_val', 'Land_non_hstd_val', 'Imprv_hstd_val', 'Imprv_non_hstd_val', 'AG_Use_val', 'AG_Market']);
const acct = new Map(); let conflicts = 0;
for (const r of sa.rows) {
  const id = r.Prop_id; if (!(id > 0)) continue;
  const v = [r.Market_val, r.Land_hstd_val, r.Land_non_hstd_val, r.Imprv_hstd_val, r.Imprv_non_hstd_val, r.AG_Use_val, r.AG_Market, r.Land_acres, r.State_cd].join('|');
  const a = acct.get(id);
  if (!a) acct.set(id, { v, r, n: 1 }); else { a.n++; if (a.v !== v) { a.conflict = true; conflicts++; } }
}
const accts = [...acct.values()];
const eq = (a, b) => a != null && b != null && Math.abs(a - b) < 1;
let sumLI = 0, sumLIag = 0, sumLIagUse = 0, other = 0, otherIds = [], withAg = 0;
for (const { r } of accts) {
  const land = (r.Land_hstd_val ?? 0) + (r.Land_non_hstd_val ?? 0), imp = (r.Imprv_hstd_val ?? 0) + (r.Imprv_non_hstd_val ?? 0);
  if ((r.AG_Market ?? 0) > 0) withAg++;
  if (eq(r.Market_val, land + imp)) sumLI++;
  else if (eq(r.Market_val, land + imp + (r.AG_Market ?? 0))) sumLIag++;
  else if (eq(r.Market_val, land + imp + (r.AG_Use_val ?? 0))) sumLIagUse++;
  else { other++; if (otherIds.length < 15) otherIds.push([r.Prop_id, r.State_cd, r.Market_val, land, imp, r.AG_Market, r.AG_Use_val]); }
}
out('sara.accounts', { rows: sa.rows.length, pages: sa.pages, exceededPages: sa.exceededPages, error: sa.error, accounts: accts.length, multiRowAccounts: accts.filter((a) => a.n > 1).length, maxRows: accts.reduce((m, a) => Math.max(m, a.n), 0), accountsWithDisagreeingRows: accts.filter((a) => a.conflict).length, years: [...new Set(sa.rows.map((r) => r.Prop_yr))] });
out('sara.componentArithmetic', { accounts: accts.length, market_eq_land_plus_impr: sumLI, market_eq_land_impr_agMarket: sumLIag, market_eq_land_impr_agUse: sumLIagUse, other, withAgMarket: withAg, otherExamples_id_code_market_land_impr_agMkt_agUse: otherIds });

// ---------- 3. Joining 2025 values to current geometry
const saIds = new Set(acct.keys());
const both = [...cbIdSet.keys()].filter((id) => saIds.has(id));
const geomOnly = [...cbIdSet.keys()].filter((id) => !saIds.has(id));
const valuesOnly = [...saIds].filter((id) => !cbIdSet.has(id));
const cbBy = new Map(); for (const r of cb.rows) if (r.PropID > 0) { const a = cbBy.get(r.PropID) ?? { acres: 0, code: r.state_cd, legal: r.legal_acre, polys: 0 }; a.polys++; cbBy.set(r.PropID, a); }
let areaChanged = 0, codeChanged = 0; const areaEx = [], codeEx = [];
for (const id of both) {
  const s = acct.get(id).r, c = cbBy.get(id);
  if (s.Land_acres > 0 && c.legal > 0 && Math.abs(s.Land_acres - c.legal) / Math.max(s.Land_acres, c.legal) > 0.05) { areaChanged++; if (areaEx.length < 10) areaEx.push([id, s.Land_acres, c.legal]); }
  if ((s.State_cd ?? '').trim() !== (c.code ?? '').trim()) { codeChanged++; if (codeEx.length < 10) codeEx.push([id, s.State_cd, c.code]); }
}
out('join.summary', { geometryAccounts: cbIdSet.size, valueAccounts: saIds.size, matched: both.length, geometryWithoutValues: geomOnly.length, valuesWithoutGeometry: valuesOnly.length, matchedButAcresDiffer5pct: areaChanged, matchedButStateCodeDiffers: codeChanged, examples: { geomOnly: geomOnly.slice(0, 10), valuesOnly: valuesOnly.slice(0, 10), areaEx, codeEx } });

// ---------- 4. County-wide unique-account pagination (keyset on sort value + account id)
const WHERE = "State_cd LIKE 'C1%' AND Land_acres >= 5";
const truth = accts.filter(({ r }) => /^C1/.test(r.State_cd ?? '') && r.Land_acres >= 5).map(({ r }) => [r.Land_acres, r.Prop_id]).sort((a, b) => b[0] - a[0] || a[1] - b[1]);
function keysetPages(pageSize) {
  const seen = []; let cursor = null, pages = 0, requests = 0;
  while (pages < 400) {
    const accounts = []; let extra = cursor;
    while (accounts.length < pageSize) {
      const w = extra ? `(${WHERE}) AND (Land_acres < ${extra[0]} OR (Land_acres = ${extra[0]} AND Prop_id > ${extra[1]}))` : WHERE;
      const r = get(q(SA, { where: w, outFields: 'Prop_id,Land_acres', orderByFields: 'Land_acres DESC,Prop_id ASC', returnGeometry: 'false', resultRecordCount: String(pageSize * 4) })); requests++;
      const f = (r.features ?? []).map((x) => x.attributes); if (!f.length) break;
      for (const a of f) { if (accounts.length && accounts[accounts.length - 1][1] === a.Prop_id) continue; if (accounts.length >= pageSize) break; accounts.push([a.Land_acres, a.Prop_id]); }
      extra = accounts[accounts.length - 1];
      if (f.length < pageSize * 4) break;
    }
    if (!accounts.length) break;
    seen.push(...accounts); cursor = accounts[accounts.length - 1]; pages++;
    if (accounts.length < pageSize) break;
  }
  return { seen, pages, requests };
}
const ks = keysetPages(50);
const ids = ks.seen.map((x) => x[1]);
// naive offset paging with per-page dedupe, for contrast
let naive = [], off = 0;
for (let p = 0; p < 200; p++) { const r = get(q(SA, { where: WHERE, outFields: 'Prop_id,Land_acres', orderByFields: 'Land_acres DESC,Prop_id ASC', returnGeometry: 'false', resultOffset: String(off), resultRecordCount: '50' })); const f = r.features ?? []; if (!f.length) break; naive.push(...new Set(f.map((x) => x.attributes.Prop_id))); off += 50; }
const distinct = get(q(SA, { where: WHERE, outStatistics: JSON.stringify([{ statisticType: 'count', onStatisticField: 'distinct Prop_id', outStatisticFieldName: 'n' }]) }));
const grp = get(q(SA, { where: WHERE, groupByFieldsForStatistics: 'Prop_id', outStatistics: JSON.stringify([{ statisticType: 'count', onStatisticField: 'Prop_id', outStatisticFieldName: 'n' }]), returnCountOnly: 'true' }));
out('pagination', {
  rowCount: get(q(SA, { where: WHERE, returnCountOnly: 'true' })).count, truthAccounts: truth.length,
  serverCountDistinct: distinct.features?.[0]?.attributes ?? distinct.error, groupCountOnly: grp.count ?? grp.error,
  keyset: { pages: ks.pages, requests: ks.requests, accounts: ids.length, unique: new Set(ids).size, matchesTruthOrder: JSON.stringify(ids) === JSON.stringify(truth.map((t) => t[1])) },
  naiveOffsetPerPageDedupe: { accounts: naive.length, unique: new Set(naive).size, repeated: naive.length - new Set(naive).size, missing: (() => { const s = new Set(naive); return truth.filter((t) => !s.has(t[1])).length; })() }
});

// ---------- 5. Zoning: fully paginated intersections for the parcels that looked incomplete
function zoningFor(geom) {
  const all = []; let off = 0, pages = 0, exceeded = 0;
  for (;;) {
    const r = get(q(Z, { geometry: JSON.stringify(geom), geometryType: 'esriGeometryPolygon', inSR: '4326', spatialRel: 'esriSpatialRelIntersects', outFields: 'OBJECTID,Zoning,Base,SpecDistrict,SpecCondition', returnGeometry: 'true', outSR: '4326', resultOffset: String(off), resultRecordCount: '1000', orderByFields: 'OBJECTID' }).replace('f=json', 'f=geojson'));
    pages++; const f = r.features ?? []; if (r.properties?.exceededTransferLimit || r.exceededTransferLimit) exceeded++;
    all.push(...f); if (f.length < 1000) break; off += 1000;
  }
  return { features: all, pages, exceeded };
}
const key = (f) => createHash('sha1').update(JSON.stringify(f.geometry.coordinates)).digest('hex').slice(0, 12);
const res = [];
for (const id of [102742, 100293, 561765, 110179, 100288, 100297, 100431, 333888]) {
  const p = get(q(CB, { where: `PropID = ${id}`, outFields: 'PropID,state_cd,LandSqft,legal_acre', returnGeometry: 'true', outSR: '4326' }).replace('f=json', 'f=geojson'));
  const pf = p.features ?? []; if (!pf.length) { res.push({ id, error: 'parcel not found' }); continue; }
  const parcel = pf.length === 1 ? pf[0] : turf.union(turf.featureCollection(pf));
  const esriGeom = { rings: (parcel.geometry.type === 'Polygon' ? [parcel.geometry.coordinates] : parcel.geometry.coordinates).flat(), spatialReference: { wkid: 4326 } };
  const z = zoningFor(esriGeom);
  const full = turf.area(parcel);
  const pieces = []; let uni = null;
  for (const zf of z.features) { try { const i = turf.intersect(turf.featureCollection([parcel, zf])); if (i) { pieces.push({ code: zf.properties.Zoning, oid: zf.properties.OBJECTID, g: key(zf), sqft: turf.area(i) * 10.7639 }); uni = uni ? turf.union(turf.featureCollection([uni, i])) : i; } } catch (e) { pieces.push({ err: String(e).slice(0, 80) }); } }
  const byGeom = {}; for (const x of pieces) if (x.g) (byGeom[x.g] ??= []).push(x.code);
  res.push({ id, polygons: pf.length, parcelSqftGeom: Math.round(full * 10.7639), reportedSqft: pf[0].properties.LandSqft, zoningPages: z.pages, exceeded: z.exceeded, zoningPolygons: z.features.length, covered: uni ? +(turf.area(uni) / full).toFixed(4) : 0, pieces: pieces.map((x) => [x.code, x.oid, x.g, Math.round(x.sqft)]), sameGeometryGroups: Object.entries(byGeom).filter(([, c]) => c.length > 1).map(([g, c]) => [g, c]) });
}
out('zoning.recheck', res);
// how common are identical zoning geometries, and do their codes agree?
const sample = get(q(Z, { where: '1=1', outFields: 'OBJECTID,Zoning', returnGeometry: 'true', outSR: '4326', resultRecordCount: '2000', geometry: JSON.stringify({ xmin: -98.52, ymin: 29.40, xmax: -98.48, ymax: 29.44, spatialReference: { wkid: 4326 } }), geometryType: 'esriGeometryEnvelope', inSR: '4326', spatialRel: 'esriSpatialRelIntersects' }).replace('f=json', 'f=geojson'));
const g = {}; for (const f of sample.features ?? []) (g[key(f)] ??= []).push(f.properties.Zoning);
const dup = Object.values(g).filter((c) => c.length > 1);
out('zoning.duplicateGeometry', { polygons: sample.features?.length, exceeded: sample.properties?.exceededTransferLimit, duplicateGroups: dup.length, sameCode: dup.filter((c) => new Set(c).size === 1).length, differentCodes: dup.filter((c) => new Set(c).size > 1).length, differentExamples: dup.filter((c) => new Set(c).size > 1).slice(0, 10) });
