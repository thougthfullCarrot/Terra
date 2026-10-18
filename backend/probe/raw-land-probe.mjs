// Phase 0 Raw Land source probe. Read-only GETs against public services; prints JSON sections to the log.
import * as turf from '@turf/turf';
const UA = 'terra-collector/0.1 (+https://github.com/thougthfullCarrot/Terra)';
const SARA = 'https://gis.sara-tx.org/ags1/rest/services/FW_Bexar/BCAD_Parcels_PROD/FeatureServer/0';
const COSA = 'https://services.arcgis.com/g1fRTDLeMgspWrYp/arcgis/rest/services/COSA_Zoning/FeatureServer';
const out = (k, v) => console.log(`\n### ${k}\n` + JSON.stringify(v, null, 1).slice(0, 60000));
async function get(url, { text = false, ua = UA } = {}) {
  const t0 = Date.now();
  try {
    const r = await fetch(url, { headers: { 'user-agent': ua, accept: '*/*' }, signal: AbortSignal.timeout(60000) });
    const body = text ? await r.text() : await r.arrayBuffer();
    const s = text ? body : Buffer.from(body).toString('utf8');
    return { status: r.status, ms: Date.now() - t0, bytes: text ? s.length : body.byteLength, type: r.headers.get('content-type'), lastModified: r.headers.get('last-modified'), body: s };
  } catch (e) { return { status: 'ERR', error: String(e), ms: Date.now() - t0 }; }
}
const j = async (url) => { const r = await get(url); try { return { ...r, json: JSON.parse(r.body) }; } catch { return { ...r, json: null, body: r.body?.slice(0, 400) }; } };
const q = (base, p) => `${base}/query?` + new URLSearchParams({ f: 'json', ...p });
const strip = (r) => { const { body, json, ...rest } = r; return rest; };
const browserUA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36';

async function layerMeta(url) {
  const r = await j(url + '?f=json');
  const d = r.json || {};
  return { http: strip(r), name: d.name, type: d.type, geometryType: d.geometryType, maxRecordCount: d.maxRecordCount, lastEdit: d.editingInfo?.lastEditDate ? new Date(d.editingInfo.lastEditDate).toISOString() : null, dataLastEdit: d.editingInfo?.dataLastEditDate ? new Date(d.editingInfo.dataLastEditDate).toISOString() : null, description: d.description, copyrightText: d.copyrightText, sr: d.extent?.spatialReference, advanced: d.advancedQueryCapabilities, supportsStatistics: d.supportsStatistics, supportsPagination: d.advancedQueryCapabilities?.supportsPagination, capabilities: d.capabilities, fields: (d.fields || []).map((f) => [f.name, f.alias, f.type, f.domain ? 'DOMAIN' : '']) };
}

// ---------- 1. SARA / BCAD parcels
const sara = await layerMeta(SARA);
out('sara.meta', sara);
const svcInfo = await j(SARA.replace(/\/0$/, '') + '?f=json');
out('sara.service', { desc: svcInfo.json?.serviceDescription, copyright: svcInfo.json?.copyrightText, layers: svcInfo.json?.layers });
out('sara.count', (await j(q(SARA, { where: '1=1', returnCountOnly: 'true' }))).json);
for (const [label, where] of [['C1 vacant', "State_cd LIKE 'C1%'"], ['D1 ag', "State_cd LIKE 'D1%'"], ['E rural', "State_cd LIKE 'E%'"], ['A1 res', "State_cd LIKE 'A1%'"]]) {
  const r = await j(q(SARA, { where, outFields: '*', returnGeometry: 'false', resultRecordCount: '2' }));
  out(`sara.sample.${label}`, r.json?.features?.map((f) => f.attributes) ?? strip(r));
}
// state code distribution
const sc = await j(q(SARA, { where: '1=1', groupByFieldsForStatistics: 'State_cd', outStatistics: JSON.stringify([{ statisticType: 'count', onStatisticField: 'OBJECTID', outStatisticFieldName: 'n' }]) }));
out('sara.stateCodes', sc.json?.features?.map((f) => f.attributes) ?? strip(sc));
// accounts with more than one polygon
const dup = await j(q(SARA, { where: '1=1', groupByFieldsForStatistics: 'Prop_id', having: 'COUNT(OBJECTID) > 1', outStatistics: JSON.stringify([{ statisticType: 'count', onStatisticField: 'OBJECTID', outStatisticFieldName: 'n' }]), resultRecordCount: '20' }));
out('sara.multiPolygonAccounts', dup.json?.features?.slice(0, 20).map((f) => f.attributes) ?? strip(dup));
// county-wide server-side filter + sort, no geometry: what a phone would download
const cw = await get(q(SARA, { where: "State_cd LIKE 'C1%' AND Land_acres >= 5", outFields: 'Prop_id,Owner_name,Situs,Land_acres,State_cd,Market_val', orderByFields: 'Land_acres DESC', returnGeometry: 'false', resultRecordCount: '50' }));
let cwj = null; try { cwj = JSON.parse(cw.body); } catch {}
out('sara.countywideQuery', { http: strip(cw), returned: cwj?.features?.length, exceeded: cwj?.exceededTransferLimit, first: cwj?.features?.slice(0, 3).map((f) => f.attributes), error: cwj?.error });
const cwc = await j(q(SARA, { where: "State_cd LIKE 'C1%' AND Land_acres >= 5", returnCountOnly: 'true' }));
out('sara.countywideCount', cwc.json);
// viewport query (downtown-ish bbox near UTSA main) with geometry
const bbox = { xmin: -98.63, ymin: 29.57, xmax: -98.61, ymax: 29.59, spatialReference: { wkid: 4326 } };
const vp = await get(q(SARA, { geometry: JSON.stringify(bbox), geometryType: 'esriGeometryEnvelope', inSR: '4326', spatialRel: 'esriSpatialRelIntersects', outFields: 'Prop_id,State_cd,Land_acres', returnGeometry: 'true', outSR: '4326', geometryPrecision: '6', f: 'geojson' }).replace('f=json&', ''));
let vpj = null; try { vpj = JSON.parse(vp.body); } catch {}
out('sara.viewportQuery', { http: strip(vp), features: vpj?.features?.length, exceeded: vpj?.properties?.exceededTransferLimit ?? vpj?.exceededTransferLimit });

// ---------- 2. COSA zoning
const cosaSvc = await j(COSA + '?f=json');
out('cosa.service', { http: strip(cosaSvc), desc: cosaSvc.json?.serviceDescription, copyright: cosaSvc.json?.copyrightText, layers: cosaSvc.json?.layers?.map((l) => [l.id, l.name]) });
const zl = `${COSA}/12`;
out('cosa.meta12', await layerMeta(zl));
const zc = await j(q(zl, { where: '1=1', groupByFieldsForStatistics: 'Zoning', outStatistics: JSON.stringify([{ statisticType: 'count', onStatisticField: 'OBJECTID', outStatisticFieldName: 'n' }]) }));
const codes = zc.json?.features?.map((f) => [f.attributes.Zoning ?? f.attributes.ZONING, f.attributes.n]) ?? [];
const tokens = {};
for (const [c, n] of codes) for (const t of String(c ?? '').trim().split(/\s+/)) tokens[t] = (tokens[t] || 0) + n;
out('cosa.distinctCodes', { distinct: codes.length, err: zc.json?.error, sample: codes.slice(0, 60) });
out('cosa.tokens', Object.entries(tokens).sort((a, b) => b[1] - a[1]));
// list all services in the COSA org that look like zoning/overlay/land use
const org = await j('https://services.arcgis.com/g1fRTDLeMgspWrYp/arcgis/rest/services?f=json');
out('cosa.orgServices', (org.json?.services || []).map((s) => s.name).filter((n) => /zon|overlay|land.?use|district|limit|etj|histor|airport|military|plan/i.test(n)));

// ---------- 3. split-zoning test on real parcels: intersect parcel polygons with zoning polygons
async function geo(url, p) { const r = await get(q(url, { ...p, f: 'geojson' }).replace('f=json&', '')); try { return JSON.parse(r.body); } catch { return null; } }
const parcels = await geo(SARA, { where: "State_cd LIKE 'C1%' AND Land_acres >= 3 AND Situs_Zip LIKE '782%'", outFields: 'Prop_id,Land_acres,State_cd,Situs', returnGeometry: 'true', outSR: '4326', resultRecordCount: '40' });
const results = [];
for (const p of parcels?.features ?? []) {
  const z = await geo(zl, { geometry: JSON.stringify(turf.bbox(p)), geometryType: 'esriGeometryEnvelope', inSR: '4326', spatialRel: 'esriSpatialRelIntersects', outFields: '*', returnGeometry: 'true', outSR: '4326' });
  const full = turf.area(p);
  const parts = [];
  for (const zf of z?.features ?? []) {
    try { const i = turf.intersect(turf.featureCollection([p, zf])); if (i) parts.push({ code: zf.properties.Zoning ?? zf.properties.ZONING, m2: turf.area(i) }); } catch {}
  }
  const covered = parts.reduce((s, x) => s + x.m2, 0);
  results.push({ id: p.properties.Prop_id, situs: p.properties.Situs, acres: p.properties.Land_acres, geomAcres: full / 4046.856, parts: parts.map((x) => [x.code, +(x.m2 / full).toFixed(4)]), coveredShare: +(covered / full).toFixed(4) });
}
out('split.tests', results);

// ---------- 4. BCAD official site, downloads, terms
for (const u of ['https://www.bcad.org/', 'https://www.bcad.org/robots.txt', 'https://www.bcad.org/data-downloads/', 'https://bcad.org/data-downloads/', 'https://www.bcad.org/clientdb/?cid=1']) {
  for (const ua of [UA, browserUA]) {
    const r = await get(u, { text: true, ua });
    const links = [...(r.body || '').matchAll(/href="([^"]+)"/g)].map((m) => m[1]).filter((h) => /download|export|layout|\.zip|\.pdf|\.csv|gis|shape|terms|open/i.test(h));
    out(`bcad.${u}.${ua === UA ? 'bot' : 'browser'}`, { ...strip(r), title: (r.body || '').match(/<title>([^<]*)/)?.[1], links: [...new Set(links)].slice(0, 60), text: ua === UA && /robots/.test(u) ? r.body?.slice(0, 1500) : undefined });
  }
}
// ArcGIS Online search for official Bexar-area zoning layers
for (const city of ['Alamo Heights', 'Live Oak', 'Converse', 'Schertz', 'Universal City', 'Leon Valley', 'Helotes', 'Kirby', 'Selma', 'Windcrest', 'Terrell Hills', 'Olmos Park', 'Shavano Park', 'Hollywood Park', 'Castle Hills', 'Balcones Heights', 'Fair Oaks Ranch', 'Converse', 'Elmendorf', 'China Grove', 'St. Hedwig', 'Somerset', 'Von Ormy', 'Lytle', 'Sandy Oaks', 'Grey Forest', 'Cibolo', 'Garden Ridge', 'San Antonio', 'Bexar County']) {
  const r = await j('https://www.arcgis.com/sharing/rest/search?' + new URLSearchParams({ f: 'json', num: '6', q: `zoning "${city}" Texas`, filter: 'type:"Feature Service" OR type:"Map Service" OR type:"Web Map"' }));
  out(`agol.${city}`, (r.json?.results || []).map((x) => [x.title, x.owner, x.type, x.url, x.modified ? new Date(x.modified).toISOString().slice(0, 10) : null, (x.licenseInfo || '').replace(/<[^>]+>/g, '').slice(0, 120)]));
}
// city websites (zoning map pages)
for (const u of ['https://www.alamoheightstx.gov/', 'https://www.alamoheightstx.gov/?s=zoning+map', 'https://www.sanantonio.gov/DSD/Resources/Zoning', 'https://opendata-cosagis.opendata.arcgis.com/', 'https://www.sanantonio.gov/GIS/Open-Data']) {
  const r = await get(u, { text: true, ua: browserUA });
  const links = [...(r.body || '').matchAll(/href="([^"]+)"/g)].map((m) => m[1]).filter((h) => /zon|map|gis|udc|overlay/i.test(h));
  out(`web.${u}`, { ...strip(r), links: [...new Set(links)].slice(0, 40) });
}

