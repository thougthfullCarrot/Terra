// Temporary: inspect the TxGIO statewide parcel service.
const base = 'https://feature.geographic.texas.gov/arcgis/rest/services/Parcels/stratmap_land_parcels_48_most_recent/MapServer';
const get = async (u) => { const t0 = Date.now(); try { const r = await fetch(u, { headers: { origin: 'https://thougthfullcarrot.github.io' } }); const t = await r.text(); return { s: r.status, cors: r.headers.get('access-control-allow-origin'), ms: Date.now() - t0, t }; } catch (e) { return { s: 'ERR ' + (e.cause?.code ?? e.message), t: '', ms: Date.now() - t0 }; } };
const svc = await get(base + '?f=json'); console.log('svc', svc.s, svc.cors, svc.t.slice(0, 800));
const lyr = await get(base + '/0?f=json');
try { const j = JSON.parse(lyr.t); console.log('layer', j.name, j.maxRecordCount, j.capabilities, (j.fields ?? []).map((f) => f.name + ':' + f.type.replace('esriFieldType', '')).join(' ')); } catch { console.log('layer', lyr.s, lyr.t.slice(0, 500)); }
const q = async (where, extra = '') => { const r = await get(`${base}/0/query?where=${encodeURIComponent(where)}&outFields=*&returnGeometry=false&resultRecordCount=3&f=json${extra}`); console.log('\nQ', where, r.s, r.cors, r.ms + 'ms', r.t.slice(0, 1600)); };
await q("situs_addr LIKE '1000 MAIN ST%'");
await q("UPPER(situs_addr) LIKE '1000 MAIN%' AND UPPER(situs_city) = 'HOUSTON'");
await q("UPPER(owner_name) LIKE 'HINES%'");
await q("1=1", '&returnCountOnly=true');
