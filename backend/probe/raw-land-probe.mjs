// Phase 0 Raw Land source probe, round 3. Read-only GETs; prints JSON sections to the log.
import * as turf from '@turf/turf';
import { execFileSync } from 'node:child_process';
const UA = 'terra-collector/0.1 (+https://github.com/thougthfullCarrot/Terra)';
const BUA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36';
const out = (k, v) => console.log(`\n### ${k}\n` + JSON.stringify(v).slice(0, 40000));
// curl, because Node's fetch failed TLS/connect to gis.sara-tx.org while curl succeeded
function get(url, ua = UA) {
  const t0 = Date.now();
  try {
    const body = execFileSync('curl', ['-sSL', '-m', '90', '-A', ua, '-w', '\n%{http_code} %{size_download}', url], { encoding: 'utf8', maxBuffer: 200e6 });
    const i = body.lastIndexOf('\n'); const [code, size] = body.slice(i + 1).split(' ');
    return { status: +code, bytes: +size, ms: Date.now() - t0, body: body.slice(0, i) };
  } catch (e) { return { status: 'ERR', error: String(e.stderr || e.message).slice(0, 200) }; }
}
const j = (u) => { const r = get(u); try { return JSON.parse(r.body); } catch { return { _http: r.status, _err: r.error, _body: r.body?.slice(0, 300) }; } };
const q = (base, p) => `${base}/query?` + new URLSearchParams({ f: 'json', ...p });
const cnt = (f) => JSON.stringify([{ statisticType: 'count', onStatisticField: f, outStatisticFieldName: 'n' }]);
const meta = (u) => { const d = j(u + '?f=json'); return { name: d.name, err: d._http ?? d.error, maxRecordCount: d.maxRecordCount, lastEdit: d.editingInfo?.lastEditDate ? new Date(d.editingInfo.lastEditDate).toISOString() : null, sr: d.extent?.spatialReference?.latestWkid ?? d.extent?.spatialReference?.wkid, desc: (d.description || '').replace(/<[^>]+>/g, '').slice(0, 800), copyright: d.copyrightText, capabilities: d.capabilities, fields: (d.fields || []).map((f) => `${f.name}${f.alias && f.alias !== f.name ? ` (${f.alias})` : ''}:${f.type.replace('esriFieldType', '')}`) }; };

const COSA_BCAD_SVC = 'https://services.arcgis.com/g1fRTDLeMgspWrYp/arcgis/rest/services/BCAD_Parcels/FeatureServer';
const svc = j(COSA_BCAD_SVC + '?f=json');
out('cbcad.service', { layers: svc.layers?.map((l) => [l.id, l.name]), desc: svc.serviceDescription, copyright: svc.copyrightText });
const item = j('https://www.arcgis.com/sharing/rest/search?' + new URLSearchParams({ f: 'json', q: 'title:"BCAD Parcels" owner:CoSAGIS_Opendata' }));
out('cbcad.item', (item.results || []).map((x) => ({ id: x.id, title: x.title, modified: new Date(x.modified).toISOString(), license: x.licenseInfo, desc: (x.description || '').replace(/<[^>]+>/g, ' ').slice(0, 1500), snippet: x.snippet, access: x.accessInformation })));
const L = `${COSA_BCAD_SVC}/${svc.layers?.[0]?.id ?? 0}`;
const SARA = 'https://gis.sara-tx.org/ags1/rest/services/FW_Bexar/BCAD_Parcels_PROD/FeatureServer/0';
for (const [name, layer] of [['cbcad', L], ['sara', SARA]]) {
  const m = meta(layer); out(`${name}.meta`, m);
  if (m.err) continue;
  const f = (n) => m.fields.map((x) => x.split(/[ :]/)[0]).find((x) => x.toLowerCase() === n.toLowerCase());
  const PID = f('prop_id') ?? f('PropID') ?? f('Prop_ID'), SC = f('State_cd') ?? f('state_cd') ?? f('StateCode');
  out(`${name}.keys`, { PID, SC });
  out(`${name}.count`, j(q(layer, { where: '1=1', returnCountOnly: 'true' })));
  if (SC) {
    const s = j(q(layer, { where: '1=1', groupByFieldsForStatistics: SC, outStatistics: cnt(PID ?? 'OBJECTID'), orderByFields: 'n DESC' }));
    out(`${name}.stateCodes`, s.features?.map((x) => Object.values(x.attributes)) ?? s);
    for (const code of ['C1', 'D1', 'E', 'F1', 'X']) {
      const r = j(q(layer, { where: `${SC} LIKE '${code}%'`, outFields: '*', returnGeometry: 'false', resultRecordCount: '2' }));
      out(`${name}.sample.${code}`, r.features?.map((x) => x.attributes) ?? r);
    }
  }
  if (PID) {
    const d = j(q(layer, { where: '1=1', groupByFieldsForStatistics: PID, having: `COUNT(${PID}) > 1`, outStatistics: cnt(PID), orderByFields: 'n DESC', resultRecordCount: '15' }));
    out(`${name}.multiPolygonAccounts`, d.features?.map((x) => x.attributes) ?? d);
    const id = d.features?.[0]?.attributes?.[PID];
    if (id != null) out(`${name}.multiPolygonExample`, j(q(layer, { where: `${PID} = '${id}'`, outFields: '*', returnGeometry: 'false' })).features?.map((x) => x.attributes));
  }
  // county-wide server-side filter + sort, no geometry
  if (SC) {
    const acres = f('Land_acres') ?? f('LandAcres') ?? f('Acres');
    const where = `${SC} LIKE 'C1%'` + (acres ? ` AND ${acres} >= 5` : '');
    const r = get(q(layer, { where, outFields: [PID, acres, SC].filter(Boolean).join(','), orderByFields: acres ? `${acres} DESC` : '', returnGeometry: 'false', resultRecordCount: '50' }));
    let jj = {}; try { jj = JSON.parse(r.body); } catch {}
    out(`${name}.countywide`, { where, status: r.status, bytes: r.bytes, ms: r.ms, n: jj.features?.length, exceeded: jj.exceededTransferLimit, err: jj.error, first: jj.features?.slice(0, 3).map((x) => x.attributes), total: j(q(layer, { where, returnCountOnly: 'true' })).count });
  }
  // viewport: ~1.5 km box with geometry
  const env = JSON.stringify({ xmin: -98.505, ymin: 29.415, xmax: -98.49, ymax: 29.43, spatialReference: { wkid: 4326 } });
  const vp = get(q(layer, { geometry: env, geometryType: 'esriGeometryEnvelope', inSR: '4326', spatialRel: 'esriSpatialRelIntersects', outFields: [PID, SC].filter(Boolean).join(','), returnGeometry: 'true', outSR: '4326', geometryPrecision: '6', maxAllowableOffset: '0.00001' }));
  let vj = {}; try { vj = JSON.parse(vp.body); } catch {}
  out(`${name}.viewport`, { status: vp.status, bytes: vp.bytes, ms: vp.ms, n: vj.features?.length, exceeded: vj.exceededTransferLimit, err: vj.error });
}

// split zoning on real parcels
const Z = 'https://services.arcgis.com/g1fRTDLeMgspWrYp/arcgis/rest/services/COSA_Zoning/FeatureServer/12';
const geo = (u, p) => { const r = get(q(u, { ...p, f: 'geojson' }).replace('f=json&', '')); try { return JSON.parse(r.body); } catch { return { err: r.status }; } };
const lm = meta(L); const fld = (n) => lm.fields?.map((x) => x.split(/[ :]/)[0]).find((x) => x.toLowerCase() === n.toLowerCase());
const res = [];
const boxes = [[-98.52, 29.40, -98.505, 29.415], [-98.62, 29.57, -98.605, 29.585], [-98.40, 29.50, -98.385, 29.515], [-98.70, 29.45, -98.685, 29.465], [-98.47, 29.62, -98.455, 29.635], [-98.36, 29.38, -98.345, 29.395]];
for (const b of boxes) {
  const env = JSON.stringify({ xmin: b[0], ymin: b[1], xmax: b[2], ymax: b[3], spatialReference: { wkid: 4326 } });
  const P = geo(L, { geometry: env, geometryType: 'esriGeometryEnvelope', inSR: '4326', spatialRel: 'esriSpatialRelIntersects', outFields: '*', returnGeometry: 'true', outSR: '4326', resultRecordCount: '300' });
  const ZZ = geo(Z, { geometry: env, geometryType: 'esriGeometryEnvelope', inSR: '4326', spatialRel: 'esriSpatialRelIntersects', outFields: 'Zoning,Base,SpecDistrict,SpecCondition', returnGeometry: 'true', outSR: '4326' });
  const summary = { box: b, parcels: P.features?.length ?? P, zones: ZZ.features?.length ?? ZZ, split: 0, partial: 0, overlap: 0, none: 0 };
  for (const p of P.features ?? []) {
    let full; try { full = turf.area(p); } catch { continue; } if (!full) continue;
    const parts = []; let uni = null;
    for (const z of ZZ.features ?? []) {
      try { const i = turf.intersect(turf.featureCollection([p, z])); if (i) { parts.push([z.properties.Zoning, turf.area(i)]); uni = uni ? turf.union(turf.featureCollection([uni, i])) : i; } } catch {}
    }
    const codes = new Set(parts.map((x) => x[0]));
    const covered = uni ? turf.area(uni) : 0, sum = parts.reduce((s, x) => s + x[1], 0);
    const kind = !parts.length ? 'none' : (sum - covered) / full > 0.001 ? 'overlap' : codes.size > 1 ? 'split' : covered / full < 0.98 ? 'partial' : null;
    if (!kind) continue; summary[kind]++;
    if (res.filter((r) => r.kind === kind).length < 12) res.push({ kind, attrs: Object.fromEntries(Object.entries(p.properties).filter(([k]) => /prop|situs|state|acre|land|val|owner/i.test(k))), sqftGeom: Math.round(full * 10.7639), shares: parts.map(([c, a]) => [c, +(a / full).toFixed(5), Math.round(a * 10.7639)]), covered: +(covered / full).toFixed(4), overlap: +((sum - covered) / full).toFixed(4) });
  }
  res.unshift(summary);
}
out('split.tests', res);

// overlays for a known downtown point (River Walk) to confirm layer intersect works
const pt = JSON.stringify({ x: -98.4895, y: 29.4246, spatialReference: { wkid: 4326 } });
for (const [n, u] of [['RIO', 'River_Improvement_Overlay_Districts_RIO/FeatureServer/9'], ['Historic', 'Historic_Districts/FeatureServer/0'], ['AHOD', 'Airport_Hazard_Overlay_District_AHOD/FeatureServer/0'], ['MLOD', 'Military_Lighting_Overlay_District_MLOD/FeatureServer/6'], ['FLU', 'Future_Land_Use/FeatureServer/4'], ['COSABoundary', 'COSABoundary/FeatureServer/0']]) {
  const r = j(q(`https://services.arcgis.com/g1fRTDLeMgspWrYp/arcgis/rest/services/${u}`, { geometry: pt, geometryType: 'esriGeometryPoint', inSR: '4326', spatialRel: 'esriSpatialRelIntersects', outFields: '*', returnGeometry: 'false' }));
  out(`overlayPoint.${n}`, r.features?.map((x) => x.attributes) ?? r);
}
out('COSABoundary.meta', meta('https://services.arcgis.com/g1fRTDLeMgspWrYp/arcgis/rest/services/COSABoundary/FeatureServer/0'));
// other city zoning layers
for (const [c, u] of [['Live Oak', 'https://services9.arcgis.com/xdpiCgT89eSIEpbi/arcgis/rest/services/Zoning_Map_WFL1/FeatureServer/0'], ['Cibolo', 'https://services3.arcgis.com/D32JCd9p0r1BYMwd/arcgis/rest/services/City_of_Cibolo__Zoning_(view)/FeatureServer/0']]) {
  const m = meta(u); out(`city.${c}`, { ...m, count: j(q(u, { where: '1=1', returnCountOnly: 'true' })).count, sample: j(q(u, { where: '1=1', outFields: '*', returnGeometry: 'false', resultRecordCount: '3' })).features?.map((x) => x.attributes) });
}
for (const u of ['https://un6901.zoninghub.com/Home.aspx', 'https://helotes-tx.gov/departments/development-services/maps/', 'https://www.schertz.com/sitemap', 'https://library.municode.com/tx/leon_valley/munidocs/munidocs?nodeId=maps']) {
  const r = get(u, BUA);
  const links = [...(r.body || '').matchAll(/href="([^"]+)"/g)].map((m) => m[1]).filter((h) => /zon/i.test(h));
  out(`city.page ${u}`, { status: r.status, bytes: r.bytes, links: [...new Set(links)].slice(0, 15) });
}
// BCAD: search the official site for data/export pages
for (const s of ['export', 'download', 'gis', 'data', 'shapefile']) {
  const r = get(`https://bcad.org/wp-json/wp/v2/search?search=${s}&per_page=20`);
  let x = []; try { x = JSON.parse(r.body).map((e) => [e.title, e.url]); } catch {}
  out(`bcad.search.${s}`, { status: r.status, x });
}
