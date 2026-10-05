// Temporary probe, round 3.
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36';
async function get(url) {
  try {
    const r = await fetch(url, { headers: { 'user-agent': UA }, redirect: 'follow', signal: AbortSignal.timeout(60000) });
    return { status: r.status, url: r.url, text: await r.text() };
  } catch (e) { return { status: 'ERR ' + e.message, url, text: '' }; }
}
const json = async (url) => { const r = await get(url); try { return JSON.parse(r.text); } catch { return { _status: r.status, _text: r.text.slice(0, 300) }; } };
const show = (label, v) => console.log(`${label}: ${JSON.stringify(v).slice(0, 2500)}`);

console.log('==== StratMap query variants');
const sm = 'https://feature.geographic.texas.gov/arcgis/rest/services/Parcels/stratmap_land_parcels_48_most_recent/MapServer/0';
show('1=1', await json(`${sm}/query?where=1%3D1&outFields=county,situs_city,stat_land_use&resultRecordCount=2&f=json`));
show('county', await json(`${sm}/query?where=${encodeURIComponent("county='DALLAS'")}&outFields=*&returnGeometry=false&f=json&resultRecordCount=2`));
show('objectIds', await json(`${sm}/query?objectIds=1,2&outFields=*&f=json`));
show('pjson info', (await json(`${sm}?f=pjson`)).advancedQueryCapabilities);
show('identify', await json(`https://feature.geographic.texas.gov/arcgis/rest/services/Parcels/stratmap_land_parcels_48_most_recent/MapServer/identify?geometry=-96.797,32.78&geometryType=esriGeometryPoint&sr=4326&layers=all&tolerance=2&mapExtent=-97,32,-96,33&imageDisplay=400,400,96&returnGeometry=false&f=json`));

console.log('\n==== County CAD parcel layers');
const cads = {
  HCAD: 'https://services.arcgis.com/0L95CJ0VTaxqcmED/arcgis/rest/services/EXTERNAL_hcad_parcels/FeatureServer/0',
  TCAD: 'https://services.arcgis.com/0L95CJ0VTaxqcmED/arcgis/rest/services/EXTERNAL_tcad_parcel/FeatureServer/0',
  TCADtravis: 'https://gis.traviscountytx.gov/server1/rest/services/Boundaries_and_Jurisdictions/TCAD_public/MapServer/0',
  DallasViewer: 'https://services8.arcgis.com/9e1lVZPGgkrztAhh/arcgis/rest/services/Dallas_ParcelViewer_Service/FeatureServer/0',
  FWParcels: 'https://services5.arcgis.com/3ddLCBXe1bRt7mzj/arcgis/rest/services/Parcels_Public_Vview/FeatureServer/0',
  BexarUndeveloped: 'https://services1.arcgis.com/8onVmslF2KXErTHT/arcgis/rest/services/Undeveloped_Lands/FeatureServer/0',
  ElPaso: 'https://gisservices.elpasoco.com/arcgis2/rest/services/HubPublic/Parcels/MapServer/0',
  COH: 'https://mycity2.houstontx.gov/gisweb02/rest/services/HoustonMap/Cadastral/MapServer/0'
};
for (const [name, url] of Object.entries(cads)) {
  const info = await json(`${url}?f=json`);
  console.log(`\n# ${name} ${info.name ?? info._status} max=${info.maxRecordCount} caps=${info.capabilities}\n  fields: ${(info.fields ?? []).map((f) => f.name).join(', ')}`);
  show('  sample', (await json(`${url}/query?where=1%3D1&outFields=*&returnGeometry=false&resultRecordCount=2&f=json`)).features ?? 'none');
}

console.log('\n==== Zoning layers');
for (const svc of ['https://services2.arcgis.com/rwnOSbfKSwyTBcwN/arcgis/rest/services/Dallas_Zoning/FeatureServer', 'https://services.arcgis.com/g1fRTDLeMgspWrYp/arcgis/rest/services/COSA_Zoning/FeatureServer', 'https://services.arcgis.com/0L95CJ0VTaxqcmED/arcgis/rest/services/PLANNINGCADASTRE_zoning_small_map_scale/FeatureServer']) {
  const info = await json(`${svc}?f=json`);
  console.log(`\n# ${svc}\n  layers ${JSON.stringify(info.layers?.map((l) => [l.id, l.name]))}`);
  for (const l of info.layers ?? []) {
    const li = await json(`${svc}/${l.id}?f=json`);
    console.log(`  [${l.id}] ${li.name}: ${(li.fields ?? []).map((f) => f.name).join(', ')}`);
  }
}
show('Dallas point', await json(`https://services2.arcgis.com/rwnOSbfKSwyTBcwN/arcgis/rest/services/Dallas_Zoning/FeatureServer/1/query?geometry=-96.797,32.78&geometryType=esriGeometryPoint&inSR=4326&spatialRel=esriSpatialRelIntersects&outFields=*&returnGeometry=false&f=json`));

console.log('\n==== Partners research listing pages');
for (const url of ['https://partnersrealestate.com/research/?type=quarterly-report', 'https://partnersrealestate.com/research/page/2/', 'https://partnersrealestate.com/research/austin-office-q2-2026-quarterly-market-report/', 'https://partnersrealestate.com/research/austin-industrial-q2-2026-quarterly-market-report/', 'https://partnersrealestate.com/research/fort-worth-industrial-q2-2026-quarterly-market-report/']) {
  const r = await get(url);
  const links = [...new Set([...r.text.matchAll(/href=["'](https:\/\/partnersrealestate\.com\/research\/[^"']+quarterly[^"']*)["']/gi)].map((m) => m[1]))];
  console.log(`\n# ${url} ${r.status}\n  ${links.join('\n  ')}`);
}

console.log('\n==== Cushman Austin office PDF text');
for (const pdf of ['https://assets.cushmanwakefield.com/-/media/cw/marketbeat-pdfs/2026/q2/us-reports/office/austin_americas_marketbeat_office_q22026.pdf', 'https://assets.cushmanwakefield.com/-/media/cw/marketbeat-pdfs/2026/q2/us-reports/industrial/el-paso_americas_alliance_marketbeat_industrial_q2-2026.pdf']) {
  try {
    const buf = new Uint8Array(await (await fetch(pdf, { headers: { 'user-agent': UA } })).arrayBuffer());
    const doc = await getDocument({ data: buf }).promise;
    let text = '';
    for (let p = 1; p <= Math.min(doc.numPages, 3); p++) {
      const c = await (await doc.getPage(p)).getTextContent();
      text += `\n--- page ${p}\n` + c.items.map((i) => i.str + (i.hasEOL ? '\n' : ' ')).join('');
    }
    console.log(`\n######## ${pdf}\n${text.slice(0, 6000)}`);
  } catch (e) { console.log('pdf error', pdf, e.message); }
}
