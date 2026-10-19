// Raw Land Phase 1: synthetic fixtures only. No real parcel, value or owner data.
import { describe, expect, it } from 'vitest';
import { pageByOid, readFiltered, checkCount } from '../src/rawland/read.js';
import { zoningShares, zoningCoverage, zoningAttrKey, overlapClass, bexarLandMarket, landPsf, cityMatch, vacantPerRoll, parseZoning, SQFT_PER_ACRE } from '../src/rawland/metrics.js';
import { PolygonIndex, parcelZoning, cityShares, areaSqft, type Poly } from '../src/rawland/spatial.js';
import { zoningStatus } from '../src/rawland/jurisdiction.js';
import { AccountIndex, predicate, type AccountRow, type Bbox } from '../src/rawland/accountIndex.js';
import { assertBuildable, assertNotPublishable, joinOutlines, privacyScan, compareBaseline, BuildRefused } from '../src/rawland/guards.js';
import { LABELS } from '../src/rawland/labels.js';

// ---------- strict reads
const rows = Array.from({ length: 10 }, (_, i) => ({ attributes: { OBJECTID: i + 1 } }));
function server(script: Record<number, unknown> = {}, limit = 3) {
  let n = 0;
  return async (url: string) => {
    const k = n++; if (k in script) return script[k];
    const { last, size } = JSON.parse(url); const f = rows.filter((r) => r.attributes.OBJECTID > last).slice(0, Math.min(size, limit));
    return { features: f, exceededTransferLimit: rows.some((r) => r.attributes.OBJECTID > (f.at(-1)?.attributes.OBJECTID ?? last)) };
  };
}
const url = (last: number, size: number) => JSON.stringify({ last, size });
describe('strict reads', () => {
  it('completes when short pages flag the limit', async () => { const r = await pageByOid(server(), url, { size: 4 }); expect(r.status).toBe('complete'); expect(r.features).toHaveLength(10); });
  it.each([
    ['timeout', { _err: 'curl: (28) timed out' }], ['ArcGIS error JSON', { error: { code: 504 } }], ['malformed {}', {}], ['null', null],
    ['empty page with transfer limit', { features: [], exceededTransferLimit: true }], ['repeated page', { features: rows.slice(0, 3), exceededTransferLimit: true }]
  ])('%s fails, never an empty success', async (_n, bad) => { expect((await pageByOid(server({ 1: bad }), url, { size: 4 })).status).toBe('failed'); });
  it('page budget and count mismatch are incomplete', async () => {
    expect((await pageByOid(server(), url, { size: 4, maxPages: 2 })).status).toBe('incomplete');
    expect((await pageByOid(server(), url, { size: 4, expectCount: 11 })).status).toBe('incomplete');
  });
  it('count-validated read shares one spatial filter and fails on a bad count', async () => {
    const seen: Record<string, string>[] = [];
    const filter = { where: '1=1', geometry: '{"rings":[]}', geometryType: 'esriGeometryPolygon', spatialRel: 'esriSpatialRelIntersects' };
    const get = async (u: string) => { const p = JSON.parse(u); seen.push(p); return p.returnCountOnly ? { count: 2 } : { features: rows.slice(0, 2).filter((r) => r.attributes.OBJECTID > Number(p.where.match(/> (-?\d+)/)[1])) }; };
    expect((await readFiltered(get, (p) => JSON.stringify(p), filter, { size: 5 })).status).toBe('complete');
    for (const p of seen) expect([p.geometry, p.spatialRel]).toEqual([filter.geometry, filter.spatialRel]);
    expect((await readFiltered(async () => ({ error: {} }), (p) => JSON.stringify(p), filter)).status).toBe('failed');
    expect(() => checkCount({})).toThrow();
  });
});

// ---------- metrics
describe('values', () => {
  const BX = { Market_val: 406000, Land_hstd_val: 18430, Land_non_hstd_val: 0, Imprv_hstd_val: 138060, Imprv_non_hstd_val: 0, AG_Market: 249510 };
  it('land market value includes AG_Market and reconciles', () => expect(bexarLandMarket(BX).landMarket).toBe(267940));
  it('missing or non-numeric parts are unavailable and named', () => {
    expect(bexarLandMarket({ ...BX, AG_Market: null }).missing).toEqual(['AG_Market']);
    expect(bexarLandMarket({ ...BX, Land_hstd_val: '' }).landMarket).toBeNull();
    expect(bexarLandMarket({ ...BX, Market_val: 1 }).landMarket).toBeNull();
  });
  it('reported zero stays zero; land $/sf needs a positive area', () => {
    expect(bexarLandMarket({ Market_val: 0, Land_hstd_val: 0, Land_non_hstd_val: 0, Imprv_hstd_val: 0, Imprv_non_hstd_val: 0, AG_Market: 0 }).landMarket).toBe(0);
    expect(landPsf(108900, 2.5)).toBeCloseTo(108900 / (2.5 * SQFT_PER_ACRE)); expect(landPsf(1, 0)).toBeNull(); expect(landPsf(null, 1)).toBeNull();
  });
  it('vacancy only from C1', () => { expect(vacantPerRoll('C1')).toBe(true); for (const c of ['C2', 'E1', 'D1', 'A1', null]) expect(vacantPerRoll(c)).toBe(false); });
  it('zoning parse keeps unknown tokens', () => expect(parseZoning('C-2 XYZ', { 'C-2': 'base' }).unknown).toEqual(['XYZ']));
});
describe('city-layer match wording', () => {
  it('unmatched accounts get the agreed wording, no overlap claim', () => { expect(cityMatch(2, undefined)).toBe(LABELS.notMatched); expect(LABELS.notMatched).not.toMatch(/overlap|retired|new/); });
  it('area agrees, discrepancy, unavailable', () => {
    expect(cityMatch(2, { acres: 2.02, polygons: 1 })).toMatch(/agrees/); expect(cityMatch(10, { acres: 4, polygons: 1 })).toMatch(/discrepancy/);
    expect(cityMatch(2, { acres: 2, polygons: 2 })).toMatch(/unavailable/); expect(cityMatch(null, { acres: 2, polygons: 1 })).toMatch(/unavailable/);
  });
});
describe('zoning shares', () => {
  it('dedupes only identical geometry with identical attributes', () => {
    const a = zoningAttrKey({ Zoning: 'C-2 S', Base: 'C-2', SpecDistrict: 'S', SpecCondition: '' });
    const z = zoningShares(100, [{ code: 'C-2 S', sqft: 100, geomKey: 'g', attrKey: a }, { code: 'C-2 S', sqft: 100, geomKey: 'g', attrKey: a }], 100);
    expect([z.duplicatePieces, z.conflict]).toEqual([1, false]);
  });
  it('identical geometry with different codes or conditions is a conflict', () => {
    expect(zoningShares(100, [{ code: 'RM-4', sqft: 100, geomKey: 'g' }, { code: 'IDZ-1', sqft: 100, geomKey: 'g' }], 100).conflict).toBe(true);
    const k = (c: string) => zoningAttrKey({ Zoning: 'C-2 S', SpecCondition: c });
    expect(zoningShares(100, [{ code: 'C-2 S', sqft: 100, geomKey: 'g', attrKey: k('a') }, { code: 'C-2 S', sqft: 100, geomKey: 'g', attrKey: k('b') }], 100).conflict).toBe(true);
  });
  it('full-area shares, uncovered area, tiny districts kept, slivers flagged', () => {
    const z = zoningShares(1e6, [{ code: 'C-3', sqft: 994980 }, { code: 'R-4', sqft: 5000 }, { code: 'I-1', sqft: 20 }], 1e6 - 0);
    expect(z.districts.find((d) => d.code === 'R-4')?.suspectedSliver).toBe(false); expect(z.districts.find((d) => d.code === 'I-1')?.suspectedSliver).toBe(true);
    expect(zoningShares(100, [{ code: 'I-1', sqft: 40 }], 40).uncoveredShare).toBeCloseTo(0.6);
  });
  it('any failed piece or incomplete read makes coverage unavailable', () => {
    expect(zoningCoverage(100, 'complete', [{ code: 'C-2', sqft: 90 }, { error: 'x' }], 90).status).toBe('coverage unavailable');
    expect(zoningCoverage(100, 'incomplete', [{ code: 'C-2', sqft: 100 }], 100).status).toBe('coverage unavailable');
  });
  it('overlap classes keep zero apart from small positive overlap', () => { expect(overlapClass(0)).toBe('zero overlap'); expect(overlapClass(1e-9)).toBe('positive overlap below 1%'); expect(overlapClass(NaN)).toBe('overlap unavailable'); });
});

// ---------- local spatial index (synthetic squares, degrees near San Antonio)
const sq = (x: number, y: number, w: number, props: Record<string, unknown> = {}): Poly => ({ type: 'Feature', properties: props, geometry: { type: 'Polygon', coordinates: [[[x, y], [x + w, y], [x + w, y + w], [x, y + w], [x, y]]] } });
const X = -98.5, Y = 29.4, U = 0.001;
describe('spatial index', () => {
  const zoning = new PolygonIndex([sq(X, Y, U, { Zoning: 'C-2' }), sq(X + U, Y, U, { Zoning: 'R-6' }), sq(X, Y, U, { Zoning: 'C-2' }), sq(X + 5 * U, Y, U, { Zoning: 'I-1' })]);
  it('intersects only nearby polygons, splits shares, drops exact duplicates', () => {
    const c = parcelZoning(sq(X + U / 2, Y, U), zoning, 'complete');
    if (!('districts' in c)) throw new Error(c.status);
    expect(c.status).toBe('split zoning'); expect(c.duplicatePieces).toBe(1); expect(c.uncoveredShare).toBeLessThan(0.01);
    expect(c.districts.map((d) => d.code).sort()).toEqual(['C-2', 'R-6']);
  });
  it('a parcel off the zoning layer has no intersections; incomplete zoning read is unavailable', () => {
    expect(parcelZoning(sq(X + 20 * U, Y, U), zoning, 'complete').status).toBe('no zoning intersects parcel');
    expect(parcelZoning(sq(X, Y, U), zoning, 'failed').status).toBe('coverage unavailable');
  });
  it('area of a 0.001° square near San Antonio is about 116k sq ft', () => { const a = areaSqft(sq(X, Y, U)); expect(a).toBeGreaterThan(1.1e5); expect(a).toBeLessThan(1.25e5); });
});

describe('jurisdiction', () => {
  // County-layer shape: explicit Unincorporated and military polygons; the strip X+30..X+40 and beyond X+50 are gaps.
  const limits = new PolygonIndex([sq(X, Y, 10 * U, { city: 'San Antonio' }), sq(X + 20 * U, Y, 5 * U, { city: 'Alamo Heights' }), sq(X + 40 * U, Y, 10 * U, { city: 'Unincorporated' }), sq(X + 60 * U, Y + 20 * U, 5 * U, { city: 'Lackland AFB' })]);
  const zoning = new PolygonIndex([sq(X, Y, 10 * U, { Zoning: 'R-6' }), sq(X + 40 * U, Y, 5 * U, { Zoning: 'OCL' })]);
  const st = (p: Poly, z = zoning, limitsRead = 'complete') => zoningStatus(limitsRead, cityShares(p, limits), parcelZoning(p, z, 'complete'));
  it('only the explicit Unincorporated polygon makes land unincorporated, even where OCL is absent', () => { expect(st(sq(X + 41 * U, Y, U)).status).toBe(LABELS.unincorporated); expect(st(sq(X + 45 * U, Y + 5 * U, U)).status).toBe(LABELS.unincorporated); });
  it('a gap outside every polygon stays unknown, never inferred unincorporated', () => { expect(st(sq(X + 32 * U, Y, U)).status).toBe(LABELS.jurisdictionUnknown); expect(st(sq(X + 80 * U, Y, U)).status).toBe(LABELS.jurisdictionUnknown); });
  it('a parcel straddling the Unincorporated polygon and a gap is unincorporated with an unknown-part note', () => { const r = st(sq(X + 49.5 * U, Y, U)); expect(r.status).toBe(LABELS.unincorporated); expect(r.note).toMatch(/outside every county boundary polygon/); });
  it('a MultiPolygon Unincorporated area counts in each of its parts', () => {
    const mp: Poly = { type: 'Feature', properties: { city: 'Unincorporated' }, geometry: { type: 'MultiPolygon', coordinates: [sq(X + 100 * U, Y, 2 * U).geometry.coordinates as number[][][], sq(X + 110 * U, Y, 2 * U).geometry.coordinates as number[][][]] } };
    const ix = new PolygonIndex([mp]);
    expect(zoningStatus('complete', cityShares(sq(X + 110.5 * U, Y + 0.5 * U, U), ix), null).status).toBe(LABELS.unincorporated);
    expect(zoningStatus('complete', cityShares(sq(X + 105 * U, Y, U), ix), null).status).toBe(LABELS.jurisdictionUnknown);
  });
  it('military polygons keep their own classification', () => expect(st(sq(X + 61 * U, Y + 21 * U, U)).status).toBe('Lackland AFB: military installation, no city zoning'));
  it('inside a non-integrated city shows that city status, not unincorporated', () => expect(st(sq(X + 21 * U, Y, U)).status).toBe('Alamo Heights: published as PDF only'));
  it('inside San Antonio with no zoning is "not found", not unincorporated', () => expect(st(sq(X + 2 * U, Y, U), new PolygonIndex([])).status).toBe(LABELS.zoningNotFound));
  it('inside San Antonio with zoning gives the zoning status', () => expect(st(sq(X + 2 * U, Y, U)).status).toBe('single district'));
  it('a failed city-limit read never yields unincorporated', () => expect(st(sq(X + 41 * U, Y, U), zoning, 'failed').status).toBe(LABELS.coverageUnavailable));
});

// ---------- county-wide index vs viewport
const fixtureRows: AccountRow[] = Array.from({ length: 200 }, (_, i) => ({
  account: String(1000 + i), acres: i % 7 === 0 ? null : (i % 13) + 1, stateCode: i % 3 ? 'C1' : 'A1', zoningBases: [i % 2 ? 'R-6' : 'C-2'],
  zoningStatus: 'single district', market: i * 1000, land: i % 11 === 0 ? null : i * 500, landPsf: i % 11 === 0 ? null : (i % 17) + 0.5,
  valueStatus: 'ok', cx: X + (i % 20) * U, cy: Y + Math.floor(i / 20) * U
}));
describe('county-wide results', () => {
  const idx = new AccountIndex(fixtureRows);
  const all = (f = {}, key: 'landPsf' | 'acres' = 'landPsf', dir: 'asc' | 'desc' = 'desc', pageSize = 7, bbox: Bbox | null = null) => {
    const out: AccountRow[] = []; let after = null; let first;
    for (;;) { const p = idx.query(f, { key, dir }, { pageSize, after, bbox }); first ??= p; out.push(...p.rows); if (!p.next) break; after = p.next; }
    return { out, first: first! };
  };
  it('exact count equals the ids returned plus unranked, and pages have no repeats or gaps', () => {
    for (const size of [1, 3, 7, 50]) {
      const { out, first } = all({ vacant: true }, 'landPsf', 'desc', size);
      expect(new Set(out.map((r) => r.account)).size).toBe(out.length);
      expect(out.length + first.unranked).toBe(first.count);
      expect(first.count).toBe(fixtureRows.filter((r) => r.stateCode === 'C1').length);
      const v = out.map((r) => r.landPsf!); expect(v).toEqual([...v].sort((a, b) => b - a));
    }
  });
  it('missing sort values are counted as unranked, not dropped silently', () => {
    const { first } = all({}, 'landPsf'); expect(first.unranked).toBe(fixtureRows.filter((r) => r.landPsf == null).length);
  });
  it('county-wide results never depend on the viewport; Limit to map area is separate and labelled', () => {
    const county = all({ zoning: ['R-6'] }).first; const again = all({ zoning: ['R-6'] }).first;
    expect(again.count).toBe(county.count); expect(county.scope).toBe('county');
    const box = { west: X, south: Y, east: X + 4 * U, north: Y + 4 * U };
    const m = all({ zoning: ['R-6'] }, 'landPsf', 'desc', 7, box).first;
    expect(m.scope).toBe('map area'); expect(m.count).toBeLessThan(county.count);
  });
  it('the same predicate drives tiles and the index', () => {
    const f = { minAcres: 3, zoning: ['C-2'] }; const p = predicate(f);
    expect(fixtureRows.filter(p).length).toBe(idx.query(f, { key: 'acres', dir: 'asc' }).count);
  });
  it('duplicate accounts in the index are refused', () => expect(() => new AccountIndex([fixtureRows[0]!, fixtureRows[0]!])).toThrow(/duplicate/));
});

// ---------- guards
describe('build guards', () => {
  const ok = { status: 'complete', reason: null };
  it('refuses to build on any incomplete read', () => {
    expect(() => assertBuildable({ values: { complete: true, note: '' }, reads: { sara: ok, zoning: ok, limits: ok } })).not.toThrow();
    expect(() => assertBuildable({ values: { complete: false, note: 'pilot' }, reads: { sara: ok } })).toThrow(BuildRefused);
    expect(() => assertBuildable({ values: { complete: true, note: '' }, reads: { zoning: { status: 'incomplete', reason: 'count mismatch' } } })).toThrow(/zoning: incomplete/);
  });
  it('refuses while Bexar would be publishable, allows while held', () => {
    const manifest = { built: 'x', districts: { bexar: { records: 1, unmatched: 0, shards: 1, bytes: 1, taxYear: 2025, dataset: 'x', complete: true } } };
    expect(() => assertNotPublishable(manifest)).not.toThrow();
    expect(() => assertNotPublishable(manifest, { enabled: true, proposed: ['bexar'], held: {} })).toThrow(/publication is enabled/);
  });
  it('outlines never restore accounts missing from the values read (city-only or redacted)', () => {
    const values = new Map([['1', { m: 1 }], ['2', { m: 2 }]]); const outlines = new Map([['1', 'g1'], ['908', 'gX'], ['redacted', 'gR']]);
    const j = joinOutlines(values, outlines);
    expect(j.joined.map((x) => x.account)).toEqual(['1', '2']); expect(j.droppedOutlines).toBe(2); expect(j.noOutline).toBe(1);
  });
  it('privacy scan finds owner and address fields at any depth', () => {
    expect(privacyScan({ a: [{ account: '1', owner: 'x' }], b: { situs: 'y', situs_zip: '78' } })).toEqual(['$.a[0].owner', '$.b.situs', '$.b.situs_zip']);
    expect(privacyScan({ account: '1', acres: 2 })).toEqual([]);
  });
  it('counts are baselines: changes reported, nothing fixed', () => {
    const prev = { built: 'a', pinnedAppraisalCommit: '7b7fda3', sourceYear: 2025, counts: { accounts: 705142, notMatched: 198814 }, reads: {} };
    expect(compareBaseline(prev, { ...prev, counts: { accounts: 705150, notMatched: 198814 } })).toEqual([{ key: 'accounts', before: 705142, after: 705150, change: 8 }]);
    expect(compareBaseline(null, prev).every((d) => d.before === null)).toBe(true);
  });
  it('value labels match the agreed wording exactly', () => {
    expect(LABELS.marketValue).toBe('BCAD tax-roll market value (2025), not an asking price or current market estimate.');
    expect(LABELS.provisional).toMatch(/^Provisional/);
  });
});

describe('streamed reads', () => {
  it('onPage receives every validated row once and nothing is kept in memory', async () => {
    const got: number[] = [];
    const r = await pageByOid(server(), url, { size: 4, expectCount: 10, onPage: (f) => { got.push(...f.map((x) => x.attributes!.OBJECTID as number)); } });
    expect(r.status).toBe('complete'); expect(r.features).toHaveLength(0); expect(got).toEqual(rows.map((x) => x.attributes.OBJECTID));
  });
  it('a failure after streamed pages is still a failure', async () => {
    const r = await pageByOid(server({ 2: { error: { code: 500 } } }), url, { size: 4, onPage: () => {} });
    expect(r.status).toBe('failed'); expect(r.rows).toBeGreaterThan(0);
  });
});

import { readFileSync } from 'node:fs';
describe('outputs stay local', () => {
  it('local-data is gitignored and never part of the site build', () => {
    expect(readFileSync(new URL('../../.gitignore', import.meta.url), 'utf8')).toMatch(/^local-data\/$/m);
    expect(readFileSync(new URL('../src/bin/build-site.ts', import.meta.url), 'utf8')).not.toMatch(/local-data|rawland/);
  });
  it('no workflow uploads Raw Land outputs', async () => {
    const { readdirSync } = await import('node:fs');
    const dir = new URL('../../.github/workflows/', import.meta.url);
    for (const f of readdirSync(dir)) expect(readFileSync(new URL(f, dir), 'utf8'), f).not.toMatch(/local-data|npm run rawland/);
  });
});
