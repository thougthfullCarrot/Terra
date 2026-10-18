// Phase 0 Raw Land source probe, round 2. Read-only GETs; prints JSON sections to the log.
import * as turf from '@turf/turf';
import { execSync } from 'node:child_process';
const UA = 'terra-collector/0.1 (+https://github.com/thougthfullCarrot/Terra)';
const BUA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36';
const out = (k, v) => console.log(`\n### ${k}\n` + JSON.stringify(v).slice(0, 40000));
async function get(url, { ua = UA } = {}) {
  const t0 = Date.now();
  try {
    const r = await fetch(url, { headers: { 'user-agent': ua }, signal: AbortSignal.timeout(60000) });
    const body = await r.text();
    return { status: r.status, ms: Date.now() - t0, bytes: body.length, lastModified: r.headers.get('last-modified'), body };
  } catch (e) { return { status: 'ERR', error: String(e.cause ?? e), ms: Date.now() - t0 }; }
}
const j = async (u) => { const r = await get(u); try { return JSON.parse(r.body); } catch { return { _http: r.status, _err: r.error, _body: r.body?.slice(0, 300) }; } };
const q = (base, p) => `${base}/query?` + new URLSearchParams({ f: 'json', ...p });
const cnt = (f) => JSON.stringify([{ statisticType: 'count', onStatisticField: f, outStatisticFieldName: 'n' }]);
const meta = async (u) => { const d = await j(u + '?f=json'); return { name: d.name, err: d._http ?? d.error, maxRecordCount: d.maxRecordCount, lastEdit: d.editingInfo?.lastEditDate ? new Date(d.editingInfo.lastEditDate).toISOString() : null, sr: d.extent?.spatialReference?.latestWkid, desc: (d.description || '').replace(/<[^>]+>/g, '').slice(0, 600), copyright: d.copyrightText, fields: (d.fields || []).map((f) => `${f.name}${f.alias && f.alias !== f.name ? ` (${f.alias})` : ''}:${f.type.replace('esriFieldType', '')}`) }; };

// ---- SARA diagnosis
for (const c of ['curl -sS -m 20 -o /dev/null -w "%{http_code} %{remote_ip}" https://gis.sara-tx.org/ags1/rest/services?f=json', 'getent hosts gis.sara-tx.org', 'curl -sS -m 20 -o /dev/null -w "%{http_code}" http://gis.sara-tx.org/ags1/rest/services?f=json']) {
  let r; try { r = execSync(c + ' 2>&1', { encoding: 'utf8', timeout: 30000 }); } catch (e) { r = String(e.stdout || e.message).slice(0, 300); }
  out(`sara.diag ${c.split(' ')[0]} ${c.includes('http://') ? 'http' : ''}`, r);
}
// ---- other parcel sources for Bexar: AGOL search + TxGIO StratMap
const ag = await j('https://www.arcgis.com/sharing/rest/search?' + new URLSearchParams({ f: 'json', num: '25', q: '(BCAD OR "Bexar County") parcels', filter: 'type:"Feature Service" OR type:"Map Service"' }));
out('agol.bexarParcels', (ag.results || []).map((x) => [x.title, x.owner, x.url, x.modified ? new Date(x.modified).toISOString().slice(0, 10) : null, (x.licenseInfo || '').replace(/<[^>]+>/g, '').slice(0, 150)]));
const SM = 'https://feature.geographic.texas.gov/arcgis/rest/services/Parcels/stratmap_land_parcels_48_most_recent/MapServer';
const smSvc = await j(SM + '?f=json');
out('stratmap.service', { layers: smSvc.layers?.map((l) => [l.id, l.name]), desc: (smSvc.serviceDescription || '').replace(/<[^>]+>/g, '').slice(0, 800), copyright: smSvc.copyrightText, err: smSvc._http });
const smL = `${SM}/0`;
out('stratmap.meta', await meta(smL));
const smq = await j(q(smL, { where: "COUNTY = 'Bexar'", returnCountOnly: 'true' }));
out('stratmap.bexarCount', smq);
const smS = await j(q(smL, { where: "COUNTY = 'Bexar'", outFields: '*', returnGeometry: 'false', resultRecordCount: '3' }));
out('stratmap.bexarSample', smS.features?.map((f) => f.attributes) ?? smS);
for (const u of ['https://data.geographic.texas.gov/collection/?c=b1e2a8fc-0b80-4b1a-8a4a-0d9b8d0d2d3f', 'https://geographic.texas.gov/data/stratmap/land-parcels', 'https://tnris.org/stratmap/land-parcels/', 'https://api.tnris.org/api/v1/collections/?search=parcel']) {
  const r = await get(u, { ua: BUA });
  out(`txgio.${u}`, { status: r.status, err: r.error, text: (r.body || '').replace(/<script[\s\S]*?<\/script>/g, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').match(/.{0,200}(Bexar|license|public domain|update|2026|2025).{0,200}/gi)?.slice(0, 8) });
}

// ---- BCAD sitemap: find downloads, layout docs, GIS
const sm = await get('https://bcad.org/wp-sitemap.xml');
const subs = [...(sm.body || '').matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
let pages = [];
for (const s of subs.slice(0, 15)) { const r = await get(s); pages.push(...[...(r.body || '').matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1])); }
const hits = pages.filter((p) => /download|export|data|gis|map|layout|open|record|value|apprais|public-info|terms|disclaim/i.test(p));
out('bcad.sitemapPages', { subs: subs.length, pages: pages.length, hits: hits.slice(0, 80) });
for (const p of hits.filter((p) => /download|export|gis|data|disclaim|terms/i.test(p)).slice(0, 8)) {
  const r = await get(p, { ua: BUA });
  const links = [...(r.body || '').matchAll(/href="([^"]+)"/g)].map((m) => m[1]).filter((h) => /\.(zip|pdf|csv|txt|xlsx)|download|export|gis|arcgis|shape/i.test(h));
  const text = (r.body || '').replace(/<script[\s\S]*?<\/script>/g, '').replace(/<style[\s\S]*?<\/style>/g, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
  out(`bcad.page ${p}`, { status: r.status, links: [...new Set(links)].slice(0, 40), text: text.match(/.{0,250}(export|download|layout|certified|preliminary|supplement|shapefile|GIS|disclaim|redistribut|commercial use|fee).{0,250}/gi)?.slice(0, 10) });
}

// ---- COSA zoning: official descriptions of base / special districts / conditions
const Z = 'https://services.arcgis.com/g1fRTDLeMgspWrYp/arcgis/rest/services/COSA_Zoning/FeatureServer/12';
for (const [k, fields] of [['base', 'Base,BaseDescription'], ['spec', 'SpecDistrict,SpecDistrictDescription'], ['cond', 'SpecCondition']]) {
  const r = await j(q(Z, { where: '1=1', groupByFieldsForStatistics: fields, outStatistics: cnt('OBJECTID'), orderByFields: 'n DESC' }));
  out(`cosa.distinct.${k}`, r.features?.map((f) => Object.values(f.attributes)) ?? r);
}
const zs = await j(q(Z, { where: "Zoning LIKE '% %'", outFields: 'Zoning,Base,SpecDistrict,SpecCondition,SpecConditionDetail,ZoningDetail,CaseNo,OrdinanceKey,ModifiedDate', returnGeometry: 'false', resultRecordCount: '25', orderByFields: 'ModifiedDate DESC' }));
out('cosa.sampleMultiToken', zs.features?.map((f) => f.attributes) ?? zs);
// ---- COSA overlays / ETJ / future land use: metadata + counts
const ORG = 'https://services.arcgis.com/g1fRTDLeMgspWrYp/arcgis/rest/services';
const all = await j(ORG + '?f=json');
out('cosa.allServiceNames', (all.services || []).map((s) => s.name));
for (const n of ['Airport_Hazard_Overlay_District_AHOD', 'Military_Lighting_Overlay_District_MLOD', 'Military_Airport_Overlay_Zone_MAOZ', 'Military_Protection_Area_MPA', 'Mission_Protection_Overlay_District_MPOD', 'River_Improvement_Overlay_Districts_RIO', 'Neighborhood_Conservation_Districts', 'Historic_Districts', 'COSA_ETJ', 'Other_Cities_ETJ', 'Future_Land_Use', 'Sector_Plan_Land_Use', 'EAA_AquiferZones']) {
  const s = (all.services || []).find((x) => x.name === n);
  if (!s) { out(`overlay.${n}`, 'not found'); continue; }
  const svc = await j(s.url + '?f=json');
  const lid = svc.layers?.[0]?.id ?? 0;
  const m = await meta(`${s.url}/${lid}`);
  const c = await j(q(`${s.url}/${lid}`, { where: '1=1', returnCountOnly: 'true' }));
  out(`overlay.${n}`, { url: `${s.url}/${lid}`, layers: svc.layers?.map((l) => l.name), count: c.count, ...m });
}
// city limits candidates
for (const n of (all.services || []).filter((s) => /city.?limit|boundary|annex|municipal/i.test(s.name))) out(`limits.${n.name}`, n.url);

// ---- split zoning test with StratMap Bexar parcels (geometry) vs COSA zoning
async function geo(url, p) { const r = await get(q(url, { ...p, f: 'geojson' }).replace('f=json&', '')); try { return JSON.parse(r.body); } catch { return { err: r.status, e: r.error }; } }
const boxes = [[-98.52, 29.40, -98.49, 29.43], [-98.62, 29.57, -98.59, 29.60], [-98.40, 29.50, -98.37, 29.53], [-98.70, 29.45, -98.66, 29.49]];
const res = [];
for (const b of boxes) {
  const env = JSON.stringify({ xmin: b[0], ymin: b[1], xmax: b[2], ymax: b[3], spatialReference: { wkid: 4326 } });
  const P = await geo(smL, { geometry: env, geometryType: 'esriGeometryEnvelope', inSR: '4326', spatialRel: 'esriSpatialRelIntersects', outFields: '*', returnGeometry: 'true', outSR: '4326', resultRecordCount: '400' });
  const ZZ = await geo(Z, { geometry: env, geometryType: 'esriGeometryEnvelope', inSR: '4326', spatialRel: 'esriSpatialRelIntersects', outFields: 'Zoning,Base,SpecDistrict', returnGeometry: 'true', outSR: '4326' });
  res.push({ box: b, parcels: P.features?.length ?? P, zones: ZZ.features?.length ?? ZZ, parcelsExceeded: P.properties?.exceededTransferLimit ?? P.exceededTransferLimit });
  for (const p of P.features ?? []) {
    const full = turf.area(p); if (!full) continue;
    const parts = []; let uni = null;
    for (const z of ZZ.features ?? []) {
      try { const i = turf.intersect(turf.featureCollection([p, z])); if (i) { parts.push([z.properties.Zoning, turf.area(i)]); uni = uni ? turf.union(turf.featureCollection([uni, i])) : i; } } catch {}
    }
    const codes = new Set(parts.map((x) => x[0]));
    const covered = uni ? turf.area(uni) : 0, sum = parts.reduce((s, x) => s + x[1], 0);
    if (codes.size > 1 || covered / full < 0.98 || (sum - covered) / full > 0.001)
      res.push({ prop: p.properties.PROP_ID ?? p.properties.Prop_ID, situs: p.properties.SITUS_ADDR, ac: p.properties.GIS_AREA ?? null, shares: parts.map(([c, a]) => [c, +(a / full).toFixed(5), Math.round(a * 10.7639)]), covered: +(covered / full).toFixed(4), overlap: +((sum - covered) / full).toFixed(4) });
  }
}
out('split.tests', res.slice(0, 120));

// ---- other Bexar cities: zoning on their own sites
const cities = { 'Alamo Heights': 'https://www.alamoheightstx.gov/wp-content/uploads/Zoning-Map-2013.pdf', 'Live Oak': 'https://services9.arcgis.com/xdpiCgT89eSIEpbi/arcgis/rest/services/Zoning_Map_WFL1/FeatureServer?f=json', 'Cibolo': 'https://services3.arcgis.com/D32JCd9p0r1BYMwd/arcgis/rest/services/City_of_Cibolo__Zoning_(view)/FeatureServer?f=json', Schertz: 'https://www.schertz.com/', 'Universal City': 'https://www.universalcitytexas.com/', 'Leon Valley': 'https://www.leonvalleytexas.gov/', Helotes: 'https://www.helotes-tx.gov/', Kirby: 'https://www.kirbytx.org/', Selma: 'https://www.selmatexas.gov/', Windcrest: 'https://www.windcrest-tx.gov/', 'Terrell Hills': 'https://www.terrell-hills.com/', 'Olmos Park': 'https://www.olmospark.org/', 'Shavano Park': 'https://www.shavanopark.org/', 'Castle Hills': 'https://www.castlehillstx.gov/', 'Balcones Heights': 'https://www.balconesheightstx.gov/', 'Fair Oaks Ranch': 'https://www.fairoaksranchtx.org/', Converse: 'https://www.conversetx.net/', 'Hollywood Park': 'https://www.hollywoodparktx.gov/', 'Grey Forest': 'https://www.greyforest-tx.gov/', 'Garden Ridge': 'https://www.ci.garden-ridge.tx.us/' };
for (const [c, u] of Object.entries(cities)) {
  const r = await get(u, { ua: BUA });
  const links = [...(r.body || '').matchAll(/href="([^"]+)"/g)].map((m) => m[1]).filter((h) => /zon|gis|map/i.test(h));
  let layers; if (u.includes('f=json')) { try { const d = JSON.parse(r.body); layers = d.layers?.map((l) => l.name); } catch {} }
  out(`city.${c}`, { url: u, status: r.status, err: r.error, lastModified: r.lastModified, bytes: r.bytes, layers, links: [...new Set(links)].slice(0, 15) });
}
