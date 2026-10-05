// Temporary probe, round 4.
const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36';
async function get(url) {
  try {
    const r = await fetch(url, { headers: { 'user-agent': UA }, redirect: 'follow', signal: AbortSignal.timeout(60000) });
    return { status: r.status, url: r.url, text: await r.text() };
  } catch (e) { return { status: 'ERR ' + e.message, url, text: '' }; }
}
const json = async (url) => { const r = await get(url); try { return JSON.parse(r.text); } catch { return { _status: r.status, _text: r.text.slice(0, 300) }; } };
const show = (label, v) => console.log(`${label}: ${JSON.stringify(v).slice(0, 3000)}`);
const q = (base, params) => json(`${base}/query?${new URLSearchParams({ f: 'json', ...params })}`);

console.log('==== Cushman PDFs per city and type page');
const cw = 'https://www.cushmanwakefield.com/en/united-states/insights/us-marketbeats';
for (const city of ['dallas-ft-worth', 'houston', 'austin', 'san-antonio', 'el-paso']) {
  for (const sub of ['', '/office', '/industrial', '/retail', '/multifamily']) {
    const r = await get(`${cw}/${city}-marketbeats${sub}`);
    const pdfs = [...new Set([...r.text.matchAll(/https?:[^"'\s<>]+\.pdf/gi)].map((m) => m[0]))];
    console.log(`${city}${sub} ${r.status}: ${pdfs.join(' ')}`);
  }
}

console.log('\n==== Houston COH parcels');
const coh = 'https://mycity2.houstontx.gov/gisweb02/rest/services/HoustonMap/Cadastral/MapServer/0';
show('distinct state class', await q(coh, { where: "SITE_ADDR_2='HOUSTON'", outFields: 'STATE_CLASS', returnDistinctValues: 'true', returnGeometry: 'false' }));
show('vacant commercial top', await q(coh, { where: "STATE_CLASS IN ('C2','C3') AND SITE_ADDR_2='HOUSTON'", outFields: 'TAX_ID,STATE_CLASS,SITE_ADDR_1,LAND_VALUE,TOTAL_APPRAISED_VALUE,TOTAL_LAND_AREA,ACREAGE,LANDUSE_DSCR,FLOOD_ZONE', orderByFields: 'TOTAL_LAND_AREA DESC', resultRecordCount: '3', returnGeometry: 'true', outSR: '4326', returnCentroid: 'true' }));
show('count F1', await q(coh, { where: "STATE_CLASS='F1' AND SITE_ADDR_2='HOUSTON'", returnCountOnly: 'true' }));

console.log('\n==== Fort Worth parcels');
const fw = 'https://services5.arcgis.com/3ddLCBXe1bRt7mzj/arcgis/rest/services/Parcels_Public_Vview/FeatureServer/0';
show('distinct use', await q(fw, { where: "CITYNAME='FORT WORTH'", outFields: 'STATE_USE_CODE', returnDistinctValues: 'true', returnGeometry: 'false' }));
show('top F1', await q(fw, { where: "CITYNAME='FORT WORTH' AND STATE_USE_CODE LIKE 'F1%'", outFields: 'ACCOUNT,STATE_USE_CODE,SITUS_ADDR,LAND_VAL,APPRAISED_VALUE,LAND_SQFT,YR_BUILT,OWNER_NAME', orderByFields: 'LAND_SQFT DESC', resultRecordCount: '2', returnGeometry: 'true', outSR: '4326', returnCentroid: 'true' }));
show('FW zoning point', await q('https://mapit.fortworthtexas.gov/ags/rest/services/CIVIC/OpenData_Boundaries/MapServer/54', { geometry: '-97.33,32.75', geometryType: 'esriGeometryPoint', inSR: '4326', spatialRel: 'esriSpatialRelIntersects', outFields: 'ZONING,BASE_ZONING', returnGeometry: 'false' }));

console.log('\n==== Austin');
const tcad = 'https://services.arcgis.com/0L95CJ0VTaxqcmED/arcgis/rest/services/EXTERNAL_tcad_parcel/FeatureServer/0';
show('tcad with value', await q(tcad, { where: 'LAND_VALUE > 0', returnCountOnly: 'true' }));
show('tcad with zoning', await q(tcad, { where: "ZONING IS NOT NULL", outFields: '*', resultRecordCount: '2', returnGeometry: 'false' }));
show('austin zoning point', await q('https://services.arcgis.com/0L95CJ0VTaxqcmED/arcgis/rest/services/PLANNINGCADASTRE_zoning_small_map_scale/FeatureServer/0', { geometry: '-97.743,30.267', geometryType: 'esriGeometryPoint', inSR: '4326', spatialRel: 'esriSpatialRelIntersects', outFields: 'ZONING_ZTYPE,ZONING_BASE', returnGeometry: 'false' }));
show('dallas zoning point', await q('https://services2.arcgis.com/rwnOSbfKSwyTBcwN/arcgis/rest/services/Dallas_Zoning/FeatureServer/15', { geometry: '-96.797,32.78', geometryType: 'esriGeometryPoint', inSR: '4326', spatialRel: 'esriSpatialRelIntersects', outFields: 'ZONE_DIST,LONG_ZONE_DIST,DISTRICTUSE', returnGeometry: 'false' }));
show('SA zoning point', await q('https://services.arcgis.com/g1fRTDLeMgspWrYp/arcgis/rest/services/COSA_Zoning/FeatureServer/12', { geometry: '-98.49,29.42', geometryType: 'esriGeometryPoint', inSR: '4326', spatialRel: 'esriSpatialRelIntersects', outFields: 'Zoning,BaseDescription', returnGeometry: 'false' }));

console.log('\n==== More parcel layer searches');
for (const term of ['DCAD parcels', 'Dallas Central Appraisal District parcels', 'BCAD parcels Bexar appraisal', 'San Antonio parcels appraisal value', 'Travis Central Appraisal District parcels market value', 'El Paso Central Appraisal District parcels']) {
  const r = await json(`https://www.arcgis.com/sharing/rest/search?f=json&num=8&q=${encodeURIComponent(term + ' type:"Feature Service"')}`);
  console.log(`\n# ${term}`);
  for (const i of r.results ?? []) console.log(`  ${i.title} | ${i.owner} | ${i.url} | views ${i.numViews} | mod ${new Date(i.modified).toISOString().slice(0, 10)}`);
}
