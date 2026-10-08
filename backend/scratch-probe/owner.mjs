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
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function layer(source, where, count) {
  const r = await get(P.parcelQueryUrl(source, where, count));
  return { ms: r.ms, rows: (r.body?.features ?? []).map((f) => ({ ...source.read(f.attributes ?? {}), source })), err: r.body?.error ? JSON.stringify(r.body.error).slice(0, 120) : r.err };
}
async function statewide(q, city) {
  await sleep(1100);
  const g = await get(P.geocodeUrl(P.geocodeText(q, city)));
  const point = P.readGeocode(g.body);
  if (!point) return { how: 'no geocode', rows: [] };
  for (const tol of [8, 30]) {
    const i = await get(P.identifyUrl(point, tol));
    const rows = P.pickStatewide(i.body, q);
    if (rows.length) return { how: `state tol ${tol}`, rows };
  }
  return { how: 'state 0 parcels', rows: [] };
}
const exact = (p, q) => { const x = P.parseAddress(q); const a = ` ${String(p.address).toUpperCase().replace(/[^A-Z0-9]+/g, ' ')} `; return a.startsWith(` ${x.number} `) && a.includes(` ${x.street} `); };
async function lookup(q, city) {
  const own = P.OWNER_SOURCES.filter((s) => s.cities.includes(city));
  let ownFound = [];
  for (const s of own) { const r = await layer(s, P.addressWhere(s, q), 25); ownFound.push(...r.rows); }
  ownFound = P.rankAddresses(ownFound, q, city);
  if (ownFound.length && exact(ownFound[0], q)) return { how: 'county', rows: ownFound };
  if (city || P.isFullAddress(q)) { const r = await statewide(q, city); if (r.rows.length) return r; }
  const rest = [];
  for (const s of P.OWNER_SOURCES.filter((s) => !own.includes(s))) rest.push(...(await layer(s, P.addressWhere(s, q), 25)).rows);
  return { how: 'other counties', rows: P.rankAddresses([...ownFound, ...rest], q, city) };
}
const cases = [
  ['Houston', ['700 Louisiana St', '5 Houston Center', '1000 Main St', '811 Main', '2800 Post Oak Blvd']],
  ['Dallas', ['1601 Elm St', '8333 Douglas Ave', '1 Cowboys Way', '2100 Ross Ave']],
  ['Fort Worth', ['500 W 7th St', '201 Main St', '4800 Overton Ridge Blvd']],
  ['San Antonio', ['1 Riverwalk Pl', '700 N St Marys St', '300 Convent St']],
  ['Austin', ['301 W 2nd St', '401 W 2nd St', '1100 Congress Avenue', '500 W 2nd St', '100 Congress Ave']],
  ['', ['700 Louisiana St, Houston TX', '700 Louisiana Street Houston', '4800 Overton Ridge Blvd, Fort Worth', '2100 Ross Ave', '201 E Main St, Round Rock']]
];
for (const [city, qs] of cases) {
  for (const q of qs) {
    const s = t0();
    const r = await lookup(q, city);
    console.log(`ADDR [${city || 'All'}] ${q} | ${r.how} ${Math.round(t0() - s)}ms | ${r.rows.length} rows: ${r.rows.slice(0, 3).map((x) => `${x.address} / ${x.owner} (${x.source.county})`).join(' ; ')}`);
  }
}
for (const q of ['Hines', 'Lincoln Property', 'Greystar', 'Trammell Crow', 'Crescent Real Estate', 'Brookfield']) {
  const all = [];
  for (const s of P.OWNER_SOURCES) all.push(...(await layer(s, P.ownerLikeWhere(s, q), 40)).rows);
  const ranked = P.rankOwners(all, q);
  console.log(`OWNER ${q} | ${ranked.length} rows: ${ranked.slice(0, 5).map((x) => `${x.owner} (${x.source.county})`).join(' ; ')}`);
}
