// Temporary: runs real "Who owns this?" searches from a runner. Removed before merge.
import * as P from '../../site/property.js';
const ORIGIN = 'https://thougthfullcarrot.github.io';
const t0 = () => performance.now();
async function get(url) {
  const s = t0();
  try {
    const r = await fetch(url, { headers: { origin: ORIGIN, accept: 'application/json', 'user-agent': 'Mozilla/5.0 Terra probe' }, signal: AbortSignal.timeout(30000) });
    const text = await r.text();
    let body = null; try { body = JSON.parse(text); } catch {}
    return { status: r.status, cors: r.headers.get('access-control-allow-origin'), ms: Math.round(t0() - s), body, text: text.slice(0, 200) };
  } catch (e) { return { status: 'ERR', ms: Math.round(t0() - s), err: String(e).slice(0, 160) }; }
}
const addr = {
  Harris: ['700 Louisiana St', '1000 Main St', '2800 Post Oak Blvd', '1001 Fannin St', '5 Houston Center', '9 Greenway Plaza', '1500 Louisiana', '811 Main', '3200 Southwest Fwy', '10000 Memorial Dr'],
  Dallas: ['2100 Ross Ave', '1601 Elm St', '500 N Akard St', '2200 Ross Avenue', '3000 Turtle Creek Blvd', '8333 Douglas Ave', '1 Cowboys Way'],
  Tarrant: ['201 Main St', '777 Main St', '500 W 7th St', '2600 W 7th St', '3500 W Vickery Blvd'],
  Bexar: ['300 Convent St', '100 Military Plaza', '1 Riverwalk Pl', '700 N St Marys St', '200 E Grayson St', '18756 Stone Oak Pkwy'],
  Travis: ['100 Congress Ave', '500 W 2nd St', '301 W 2nd St', '11501 Alterra Pkwy', '600 Congress Ave', '1100 Congress Avenue', '401 W 2nd St']
};
for (const source of P.OWNER_SOURCES) {
  console.log(`\n=== ${source.county}`);
  for (const q of addr[source.county]) {
    const where = P.addressWhere(source, q);
    const r = await get(P.parcelQueryUrl(source, where, 10));
    const rows = (r.body?.features ?? []).map((f) => source.read(f.attributes ?? {}));
    console.log(`ADDR ${q} | ${where} | ${r.status} ${r.ms}ms cors=${r.cors} | ${r.body?.error ? 'ERROR ' + JSON.stringify(r.body.error).slice(0, 150) : rows.length + ' rows: ' + rows.slice(0, 3).map((x) => `${x.address} / ${x.owner}`).join(' ; ')}${r.err ?? ''}`);
  }
  for (const q of ['Hines', 'Brookfield', 'Lincoln Property', 'Greystar', 'Trammell Crow', 'Crescent']) {
    const where = P.ownerLikeWhere(source, q);
    const r = await get(P.parcelQueryUrl(source, where, 40));
    const rows = (r.body?.features ?? []).map((f) => source.read(f.attributes ?? {}));
    console.log(`OWNER ${q} | ${r.status} ${r.ms}ms | ${r.body?.error ? 'ERROR ' + JSON.stringify(r.body.error).slice(0, 150) : rows.length + ' rows: ' + rows.slice(0, 3).map((x) => x.owner).join(' ; ')}${r.err ?? ''}`);
  }
  // A sample of how the address field is written.
  const r = await get(P.parcelQueryUrl(source, `${source.address} IS NOT NULL`, 5));
  console.log('SAMPLE', (r.body?.features ?? []).map((f) => JSON.stringify(f.attributes[source.address])).join(' | '));
}
console.log('\n=== Statewide');
for (const q of ['700 Louisiana St, Houston, TX 77002', '2100 Ross Ave, Dallas, TX 75201', '100 Congress Ave, Austin, TX 78701', '300 Convent St, San Antonio, TX 78205', '1 Riverwalk Pl, San Antonio, TX 78205', '4800 Overton Ridge Blvd, Fort Worth, TX 76132', '6100 Western Pl, Fort Worth, TX 76107', '201 E Main St, Round Rock, TX 78664', '5800 Granite Pkwy, Plano, TX 75024', '700 Louisiana St, Houston TX', '700 Louisiana Street Houston']) {
  const g = await get(P.geocodeUrl(q));
  const point = P.readGeocode(g.body);
  let line = `GEO ${q} | ${g.status} ${g.ms}ms cors=${g.cors} | ${point ? `${point.lat},${point.lng}` : 'no point ' + (g.text ?? g.err)}`;
  if (point) {
    const i = await get(P.identifyUrl(point));
    const picked = P.pickStatewide(i.body, q);
    line += ` | identify ${i.status} ${i.ms}ms cors=${i.cors} ${i.body?.error ? 'ERROR ' + JSON.stringify(i.body.error).slice(0, 120) : picked.length + ' parcels: ' + picked.slice(0, 3).map((p) => `${p.address} / ${p.owner}`).join(' ; ')}`;
  }
  console.log(line, 'full?', P.isFullAddress(q));
  await new Promise((r) => setTimeout(r, 1100)); // Nominatim: one request a second
}
