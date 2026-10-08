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
async function lookup(q, city) {
  const own = P.OWNER_SOURCES.filter((s) => s.cities.includes(city));
  const county = Promise.all(own.map((s) => layer(s, P.addressWhere(s, q), 50))).then((rs) => P.rankAddresses(rs.flatMap((r) => r.rows).filter((p) => P.sameStreet(p, q)), q, city));
  const state = city || P.isFullAddress(q) ? statewide(q, city).then((r) => r.rows) : Promise.resolve([]);
  const exact = (l) => l.length && P.sameStreet(l[0], q);
  const first = await new Promise((resolve) => { let left = 2; for (const [how, p] of [['county', county], ['state', state]]) p.then((l) => (exact(l) ? resolve({ how, rows: l }) : --left === 0 && resolve(null))); });
  if (first) return first;
  const [ownFound, near] = await Promise.all([county, state]);
  if (city && near.length && !ownFound.length) return { how: 'NEAR', rows: near };
  const rest = (await Promise.all(P.OWNER_SOURCES.filter((s) => !own.includes(s)).map((s) => layer(s, P.addressWhere(s, q), 50)))).flatMap((r) => r.rows);
  const found = P.rankAddresses([...ownFound, ...rest.filter((p) => P.sameStreet(p, q))], q, city);
  if (!found.length && near.length) return { how: 'NEAR', rows: near };
  return { how: 'other counties', rows: found };
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
  let all = (await Promise.all(P.OWNER_SOURCES.map((s) => layer(s, P.ownerLikeWhere(s, q), 40)))).flatMap((r) => r.rows);
  if (!all.length) all = (await Promise.all(P.OWNER_SOURCES.map((s) => layer(s, P.ownerLikeWhere(s, q, true), 40)))).flatMap((r) => r.rows);
  const ranked = P.rankOwners(all, q);
  console.log(`OWNER ${q} | ${ranked.length} rows: ${ranked.slice(0, 5).map((x) => `${x.owner} (${x.source.county})`).join(' ; ')}`);
}
