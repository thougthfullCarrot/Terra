import test from 'node:test';
import assert from 'node:assert/strict';
import { pageByOid, checkCount, mustComplete } from './arcgis-read.mjs';

// fake server: 10 rows with OBJECTIDs 1..10; `script` overrides the response for the nth request
const rows = Array.from({ length: 10 }, (_, i) => ({ attributes: { OBJECTID: i + 1 } }));
function server(script = {}, { limit = 3, total = rows } = {}) {
  let n = 0;
  return (url) => {
    const k = n++; if (script[k] !== undefined) return typeof script[k] === 'function' ? script[k](url) : script[k];
    const { last, size } = JSON.parse(url); const f = total.filter((r) => r.attributes.OBJECTID > last).slice(0, Math.min(size, limit));
    return { features: f, exceededTransferLimit: total.some((r) => r.attributes.OBJECTID > (f.at(-1)?.attributes.OBJECTID ?? last)) };
  };
}
const url = (last, size) => JSON.stringify({ last, size });
const read = (get, o = {}) => pageByOid(get, url, { size: 4, ...o });

test('complete read: server cap below page size, short pages that flag the limit keep reading', () => {
  const r = read(server()); assert.equal(r.status, 'complete'); assert.equal(r.features.length, 10);
});
test('request failure or timeout is failed, not an empty result', () => {
  const r = read(server({ 1: { _err: 'curl: (28) Operation timed out' } })); assert.equal(r.status, 'failed'); assert.match(r.reason, /timed out/);
  assert.throws(() => mustComplete(r, 'parcels'), /failed/);
});
test('ArcGIS error JSON is failed', () => {
  const r = read(server({ 0: { error: { code: 504, message: 'Timeout' } } })); assert.equal(r.status, 'failed'); assert.equal(r.features.length, 0);
});
test('malformed {} response is failed, not a terminal empty page', () => {
  assert.equal(read(server({ 1: {} })).status, 'failed');
  assert.equal(read(server({ 0: null })).status, 'failed');
  assert.equal(read(server({ 0: [] })).status, 'failed');
});
test('empty page with exceededTransferLimit is failed', () => {
  const r = read(server({ 1: { features: [], exceededTransferLimit: true } })); assert.equal(r.status, 'failed'); assert.match(r.reason, /transfer limit/);
});
test('geojson-style transfer flag in properties is honoured', () => {
  const r = read(server({ 0: { features: rows.slice(0, 2), properties: { exceededTransferLimit: true } } })); assert.equal(r.status, 'complete'); assert.equal(r.features.length, 10);
});
test('a repeated page (cursor does not advance) is failed, not looped or duplicated', () => {
  const r = read(server({ 1: { features: rows.slice(0, 3), exceededTransferLimit: true } })); assert.equal(r.status, 'failed'); assert.match(r.reason, /did not advance/);
});
test('rows without OBJECTID are failed', () => {
  assert.equal(read(server({ 0: { features: [{ attributes: {} }] } })).status, 'failed');
});
test('page budget returns incomplete, never complete', () => {
  const r = read(server(), { maxPages: 2 }); assert.equal(r.status, 'incomplete'); assert.match(r.reason, /budget/);
});
test('row count different from the service count is incomplete (source changed during the read)', () => {
  assert.equal(read(server(), { expectCount: 11 }).status, 'incomplete');
  assert.equal(read(server(), { expectCount: 10 }).status, 'complete');
});
test('genuinely empty result is complete with zero rows', () => {
  const r = read(server({ 0: { features: [] } })); assert.equal(r.status, 'complete'); assert.equal(r.features.length, 0);
});
test('count responses are validated', () => {
  assert.equal(checkCount({ count: 512000 }), 512000);
  assert.throws(() => checkCount({}), /no integer count/);
  assert.throws(() => checkCount({ error: { code: 400 } }), /service error/);
  assert.throws(() => checkCount({ _err: 'x' }), /request failed/);
});

import { readFiltered } from './arcgis-read.mjs';
test('readFiltered uses the identical spatial filter for count and pages, and checks the count', () => {
  const seen = [];
  const filter = { where: '1=1', geometry: '{"rings":[[[0,0],[1,0],[1,1],[0,0]]]}', geometryType: 'esriGeometryPolygon', spatialRel: 'esriSpatialRelIntersects', inSR: '4326' };
  const get = (u) => { const p = JSON.parse(u); seen.push(p); if (p.returnCountOnly) return { count: 3 }; const last = Number(p.where.match(/OBJECTID > (-?\d+)/)[1]); return { features: rows.filter((r) => r.attributes.OBJECTID > last && r.attributes.OBJECTID <= 3) }; };
  const r = readFiltered(get, (p) => JSON.stringify(p), filter, { size: 2 });
  assert.equal(r.status, 'complete'); assert.equal(r.features.length, 3);
  for (const p of seen) for (const k of ['geometry', 'geometryType', 'spatialRel', 'inSR']) assert.equal(p[k], filter[k], k);
  assert.ok(seen.slice(1).every((p) => p.where.startsWith('(1=1) AND OBJECTID >')));
});
test('readFiltered: features fewer than the spatial count is incomplete', () => {
  const get = (u) => (JSON.parse(u).returnCountOnly ? { count: 5 } : { features: rows.slice(0, 2) });
  assert.equal(readFiltered(get, (p) => JSON.stringify(p), { where: '1=1' }, { size: 10 }).status, 'incomplete');
});
test('readFiltered: a failed count is a failed read', () => {
  const get = (u) => (JSON.parse(u).returnCountOnly ? { error: { code: 400 } } : { features: [] });
  assert.equal(readFiltered(get, (p) => JSON.stringify(p), { where: '1=1' }).status, 'failed');
});
