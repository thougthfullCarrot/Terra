// Temporary: which TxGIO operations work, and does the Census geocoder allow the site.
const base = 'https://feature.geographic.texas.gov/arcgis/rest/services/Parcels/stratmap_land_parcels_48_most_recent/MapServer';
const get = async (u) => { const t0 = Date.now(); try { const r = await fetch(u, { headers: { origin: 'https://thougthfullcarrot.github.io' } }); const t = await r.text(); return { s: r.status, cors: r.headers.get('access-control-allow-origin'), ms: Date.now() - t0, t }; } catch (e) { return { s: 'ERR ' + (e.cause?.code ?? e.message), t: '', ms: Date.now() - t0 }; } };
const show = (k, r) => console.log('\n' + k, r.s, r.cors, r.ms + 'ms', r.t.slice(0, 1500));
const svc = JSON.parse((await get(base + '?f=json')).t);
console.log('layers', JSON.stringify(svc.layers), 'caps', svc.capabilities, 'supportsDynamicLayers', svc.supportsDynamicLayers);
for (const l of svc.layers ?? []) show('query layer ' + l.id, await get(`${base}/${l.id}/query?where=1%3D1&outFields=owner_name&returnGeometry=false&resultRecordCount=1&f=json`));
show('identify', await get(`${base}/identify?geometry=-95.3656,29.7579&geometryType=esriGeometryPoint&sr=4326&tolerance=1&mapExtent=-95.37,29.75,-95.36,29.76&imageDisplay=800,600,96&layers=all&returnGeometry=false&f=json`));
show('find', await get(`${base}/find?searchText=HINES&searchFields=owner_name&layers=0&returnGeometry=false&contains=true&f=json`));
show('geocode', await get('https://geocoding.geo.census.gov/geocoder/locations/onelineaddress?address=' + encodeURIComponent('1000 Main St, Houston, TX 77002') + '&benchmark=Public_AR_Current&format=json'));
for (const f of ['Parcels', '']) show('folder ' + f, await get(`https://feature.geographic.texas.gov/arcgis/rest/services/${f}?f=json`));
