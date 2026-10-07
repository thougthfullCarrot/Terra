// Temporary: find a free statewide Texas parcel layer.
const get = async (u, o = {}) => { try { const r = await fetch(u, { headers: { origin: 'https://thougthfullcarrot.github.io' }, ...o }); const t = await r.text(); return { s: r.status, cors: r.headers.get('access-control-allow-origin'), t }; } catch (e) { return { s: 'ERR ' + (e.cause?.code ?? e.message), t: '' }; } };
for (const u of ['https://feature.geographic.texas.gov/arcgis/rest/services?f=json', 'https://feature.tnris.org/arcgis/rest/services?f=json']) {
  const r = await get(u); console.log(u, r.s, r.t.slice(0, 1500));
}
const s = await get('https://www.arcgis.com/sharing/rest/search?q=' + encodeURIComponent('texas land parcels stratmap') + '&num=25&f=json');
try { for (const i of JSON.parse(s.t).results) console.log('AGOL', i.type, '|', i.title, '|', i.owner, '|', i.url); } catch { console.log('search', s.s); }
const s2 = await get('https://www.arcgis.com/sharing/rest/search?q=' + encodeURIComponent('TxGIO parcels statewide') + '&num=25&f=json');
try { for (const i of JSON.parse(s2.t).results) console.log('AGOL2', i.type, '|', i.title, '|', i.owner, '|', i.url); } catch { console.log('search2', s2.s); }
