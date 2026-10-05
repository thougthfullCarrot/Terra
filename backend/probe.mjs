// Temporary probe, round 7: state code values in the San Antonio and Austin layers, and HCAD link shapes.
const stats = async (layer, field, where) => {
  const p = new URLSearchParams({ where, groupByFieldsForStatistics: field, outStatistics: JSON.stringify([{ statisticType: 'count', onStatisticField: field, outStatisticFieldName: 'n' }]), f: 'json' });
  const r = await fetch(`${layer}/query?${p}`, { signal: AbortSignal.timeout(90000) });
  const b = await r.json();
  if (b.error) return console.log(field, 'error', JSON.stringify(b.error));
  const rows = (b.features ?? []).map((f) => f.attributes).sort((a, b) => b.n - a.n);
  console.log(layer.split('/services/')[1], field, rows.slice(0, 40).map((r) => `${r[field]}=${r.n}`).join(' '));
};
const SA = 'https://gis.sara-tx.org/ags1/rest/services/FW_Bexar/BCAD_Parcels_PROD/FeatureServer/0';
const AU = 'https://services1.arcgis.com/HGcSYZ5bvjRswoCb/arcgis/rest/services/TCAD_Parcels_Dec_2025/FeatureServer/0';
await stats(SA, 'State_cd', "Situs_Zip LIKE '782%' AND Land_acres >= 0.25");
await stats(AU, 'land_state_cd', "situs_city='AUSTIN' AND GIS_acres >= 0.25");
for (const f of ['imprv_state_cd', 'state_cd', 'prop_type_cd']) await stats(AU, f, "situs_city='AUSTIN' AND GIS_acres >= 0.25").catch((e) => console.log(f, e.message));
const meta = await (await fetch(`${AU}?f=json`)).json();
console.log('AU fields', meta.fields?.map((f) => f.name).join(','));
for (const url of [
  'https://hcad.org/property-search/real-property/real-property-details/0172080130005',
  'https://public.hcad.org/records/details.asp?cap=1&crypt=&taxyear=2025&acct=0172080130005',
  'https://search.hcad.org/property/0172080130005',
  'https://hcad.org/property-search/real-property/?account=0172080130005',
  'https://hcad.org/property-search/'
]) {
  try {
    const r = await fetch(url, { redirect: 'follow', headers: { 'user-agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(30000) });
    const t = await r.text();
    console.log(`HCAD ${url} -> ${r.status} ${r.url} title=${/<title[^>]*>([^<]*)/i.exec(t)?.[1]?.trim()} hasId=${t.includes('0172080130005')}`);
  } catch (e) { console.log('HCAD error', url, e.message); }
}
