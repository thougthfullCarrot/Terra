// Temporary probe, round 5: more parcel layers.
const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36';
const json = async (url) => { try { const r = await fetch(url, { headers: { 'user-agent': UA }, signal: AbortSignal.timeout(60000) }); const t = await r.text(); try { return JSON.parse(t); } catch { return { _status: r.status, _text: t.slice(0, 300) }; } } catch (e) { return { err: e.message }; } };
const show = (label, v) => console.log(`${label}: ${JSON.stringify(v).slice(0, 2500)}`);
const q = (base, params) => json(`${base}/query?${new URLSearchParams({ f: 'json', ...params })}`);
const layers = {
  BCAD: 'https://services.arcgis.com/g1fRTDLeMgspWrYp/arcgis/rest/services/BCAD_Parcels/FeatureServer',
  BCAD_SARA: 'https://gis.sara-tx.org/ags1/rest/services/FW_Bexar/BCAD_Parcels_PROD/FeatureServer',
  DCAD_LittleElm: 'https://littleelmgis.newedgeservices.com/arcgis/rest/services/AMS/DCAD_Parcels/FeatureServer',
  TCAD_Dec2025: 'https://services1.arcgis.com/HGcSYZ5bvjRswoCb/arcgis/rest/services/TCAD_Parcels_Dec_2025/FeatureServer',
  AustinZoningLarge: 'https://services.arcgis.com/0L95CJ0VTaxqcmED/arcgis/rest/services/PLANNINGCADASTRE_zoning_large_map_scale/FeatureServer',
  DallasTax2019: 'https://services2.arcgis.com/rwnOSbfKSwyTBcwN/arcgis/rest/services/DallasTaxParcels/FeatureServer'
};
for (const [name, svc] of Object.entries(layers)) {
  const info = await json(`${svc}?f=json`);
  const ids = (info.layers ?? []).map((l) => [l.id, l.name]);
  console.log(`\n# ${name} layers ${JSON.stringify(ids)} ${info.err ?? info._status ?? ''}`);
  for (const [id] of ids.slice(0, 2)) {
    const li = await json(`${svc}/${id}?f=json`);
    console.log(`  [${id}] max=${li.maxRecordCount} fields: ${(li.fields ?? []).map((f) => f.name).join(', ')}`);
    show('  sample', (await q(`${svc}/${id}`, { where: '1=1', outFields: '*', returnGeometry: 'false', resultRecordCount: '1' })).features);
  }
}
show('Austin large zoning at 6th & Congress', await q(`${layers.AustinZoningLarge}/0`, { geometry: '-97.7431,30.2682', geometryType: 'esriGeometryPoint', inSR: '4326', spatialRel: 'esriSpatialRelIntersects', outFields: '*', returnGeometry: 'false' }));
show('Austin small zoning near Domain', await q('https://services.arcgis.com/0L95CJ0VTaxqcmED/arcgis/rest/services/PLANNINGCADASTRE_zoning_small_map_scale/FeatureServer/0', { geometry: '-97.7253,30.4021', geometryType: 'esriGeometryPoint', inSR: '4326', spatialRel: 'esriSpatialRelIntersects', outFields: '*', returnGeometry: 'false' }));
