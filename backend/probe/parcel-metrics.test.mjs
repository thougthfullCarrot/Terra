import test from 'node:test';
import assert from 'node:assert/strict';
import { accountMetrics, sumAccounts, zoningShares, parseZoning, vacantPerRoll, collapseAccounts, joinValues, pageAccounts, SQFT_PER_ACRE } from './parcel-metrics.mjs';
const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} != ${b}`);

test('land $/sf uses reported acres x 43,560', () => {
  const m = accountMetrics({ id: 'A', land: 250000, appraised: 250000, reportedAcres: 2.5 });
  assert.equal(m.landSqft, 2.5 * SQFT_PER_ACRE); close(m.landPsf, 250000 / 108900); assert.equal(m.areaBasis, 'reported');
});
test('reported zero stays zero', () => {
  const m = accountMetrics({ id: 'Z', land: 0, appraised: 0, reportedAcres: 1 });
  assert.equal(m.landPsf, 0); assert.equal(m.totalPsf, 0);
});
test('missing values are unavailable, not zero', () => {
  const m = accountMetrics({ id: 'M', reportedAcres: 1 });
  assert.equal(m.landPsf, null); assert.equal(m.totalPsf, null);
});
test('appraised is never rebuilt from land + improvement', () => {
  const m = accountMetrics({ id: 'S', land: 100, improvement: 50, reportedSqft: 10 });
  assert.equal(m.appraised, null); assert.equal(m.totalPsf, null); close(m.landPsf, 10);
});
test('market and appraised stay separate', () => {
  const m = accountMetrics({ id: 'H', land: 1e5, market: 5e5, appraised: 4e5, reportedSqft: 1e4 });
  close(m.totalPsf, 40); close(m.marketPsf, 50);
});
test('no valid area: everything per sf unavailable', () => {
  const m = accountMetrics({ id: 'N', land: 1, appraised: 1, reportedAcres: 0 });
  assert.equal(m.areaBasis, 'unavailable'); assert.equal(m.landPsf, null);
});
test('geometry area used only as labelled estimate', () => {
  const m = accountMetrics({ id: 'G', land: 2e4 }, [{ geomSqft: 1e4 }]);
  assert.equal(m.areaBasis, 'estimated'); close(m.landPsf, 2);
});
test('multiple parcels per account: one value, flagged, counted once', () => {
  const m = accountMetrics({ id: 'P', land: 9e5, appraised: 9e5, reportedAcres: 10 }, [{ geomKey: 'a', geomSqft: 2e5 }, { geomKey: 'b', geomSqft: 1.5e5 }, { geomKey: 'c', geomSqft: 8.5e4 }]);
  assert.equal(m.multiParcel, true); assert.equal(m.parcelCount, 3);
  assert.equal(sumAccounts([m]), 9e5);
});
test('duplicate geometry is counted once and reported', () => {
  const m = accountMetrics({ id: 'D', land: 1 }, [{ geomKey: 'x', geomSqft: 100 }, { geomKey: 'x', geomSqft: 100 }]);
  assert.equal(m.parcelCount, 1); assert.equal(m.duplicateGeometry, 1); assert.equal(m.landSqft, 100);
});
test('split zoning shares use full parcel area and report uncovered area', () => {
  const z = zoningShares(100000, [{ code: 'C-2', sqft: 60000 }, { code: 'R-6', sqft: 30000 }], 90000);
  assert.equal(z.status, 'split zoning'); close(z.districts[0].share, 0.6); close(z.uncoveredShare, 0.1);
});
test('partial coverage (parcel leaves city limits)', () => {
  const z = zoningShares(100000, [{ code: 'I-1', sqft: 40000 }], 40000);
  assert.equal(z.status, 'single district'); close(z.uncoveredShare, 0.6);
});
test('no intersections', () => {
  const z = zoningShares(100000, [], 0);
  assert.equal(z.status, 'no zoning intersects parcel'); assert.equal(z.uncoveredShare, 1);
});
test('tiny legitimate district is kept, not dropped', () => {
  const z = zoningShares(1e6, [{ code: 'C-3', sqft: 995000 }, { code: 'R-4', sqft: 5000 }], 1e6);
  const r4 = z.districts.find((d) => d.code === 'R-4');
  assert.ok(r4); assert.equal(r4.suspectedSliver, false);
});
test('suspected sliver is flagged but still listed', () => {
  const z = zoningShares(1e6, [{ code: 'C-3', sqft: 999980 }, { code: 'R-4', sqft: 20 }], 1e6);
  assert.equal(z.districts.length, 2); assert.equal(z.districts[1].suspectedSliver, true);
});
test('overlapping conflicting coverage is reported', () => {
  const z = zoningShares(100, [{ code: 'C-2', sqft: 100 }, { code: 'MF-33', sqft: 20 }], 100);
  close(z.overlapShare, 0.2); assert.equal(z.conflict, true);
});
test('zoning parse keeps raw string and unknown tokens', () => {
  const p = parseZoning('C-2 MLOD-2 MLR-1 AHOD XYZ', { 'C-2': 'base', 'MLOD-#': 'overlay', 'MLR-#': 'overlay', AHOD: 'overlay' });
  assert.equal(p.raw, 'C-2 MLOD-2 MLR-1 AHOD XYZ'); assert.deepEqual(p.base, ['C-2']); assert.deepEqual(p.unknown, ['XYZ']);
});
test('a non-overlay token after the base is not called an overlay', () => {
  const p = parseZoning('IDZ-2 S', { 'IDZ-#': 'base', S: 'special' });
  assert.equal(p.tokens[1].kind, 'special');
});
test('vacancy needs an official vacant code, zero improvements alone is not enough', () => {
  assert.equal(vacantPerRoll('C1'), true); assert.equal(vacantPerRoll('C2'), false); assert.equal(vacantPerRoll('E1'), false); assert.equal(vacantPerRoll('D1'), false); assert.equal(vacantPerRoll('A1'), false);
});

test('identical duplicate zoning polygons are counted once, not as conflict', () => {
  const z = zoningShares(39789, [{ code: 'C-2', sqft: 3887, geomKey: 'a' }, { code: 'C-2 CD', sqft: 35217, geomKey: 'b' }, { code: 'C-2', sqft: 3887, geomKey: 'a' }, { code: 'C-2 CD', sqft: 35217, geomKey: 'b' }], 39104);
  assert.equal(z.duplicatePieces, 2); assert.equal(z.conflict, false); assert.equal(z.districts.length, 2);
});
test('one account repeated per owner row is one account with all owners', () => {
  const rows = [{ Prop_id: 182698, Owner_name: 'URBAN WILDERNESS S A', Market_val: 113680, Land_hstd_val: 0, Land_non_hstd_val: 113680 }, { Prop_id: 182698, Owner_name: 'GEMBLER MATTHEW CHRISTIAN', Market_val: 113680, Land_hstd_val: 0, Land_non_hstd_val: 113680 }];
  const a = collapseAccounts(rows);
  assert.equal(a.length, 1); assert.deepEqual(a[0].owners.length, 2); assert.equal(a[0].values[0], 113680); assert.equal(a[0].conflict, false);
});
test('disagreeing rows for one account are flagged', () => {
  const a = collapseAccounts([{ Prop_id: 1, Market_val: 5 }, { Prop_id: 1, Market_val: 6 }]);
  assert.equal(a[0].conflict, true);
});
test('negative and missing ids are not accounts', () => {
  assert.equal(collapseAccounts([{ Prop_id: -1021 }, { Prop_id: null }, { Prop_id: 7 }]).length, 1);
});

test('identical geometry with different zoning codes stays as a conflict', () => {
  const z = zoningShares(100, [{ code: 'C-2', sqft: 100, geomKey: 'g' }, { code: 'MF-33', sqft: 100, geomKey: 'g' }], 100);
  assert.equal(z.duplicatePieces, 0); assert.equal(z.conflict, true); assert.deepEqual(z.sameGeometryConflicts[0].codes, ['C-2', 'MF-33']);
  assert.equal(z.districts.length, 2);
});
test('same code on different geometry is not deduplicated', () => {
  const z = zoningShares(100, [{ code: 'R-6', sqft: 40, geomKey: 'a' }, { code: 'R-6', sqft: 60, geomKey: 'b' }], 100);
  assert.equal(z.duplicatePieces, 0); assert.equal(z.districts.length, 2); assert.equal(z.conflict, false);
});

const V = new Map([[1, { acres: 2 }], [2, { acres: 10 }], [3, { acres: 1 }], [5, { acres: 3 }], [6, { acres: 0 }], [7, { acres: 4 }], [8, { acres: 5 }]]);
const G = new Map([[1, { acres: 2.02, polygons: 1 }], [2, { acres: 4, polygons: 1 }], [4, { acres: 6, polygons: 1 }], [5, { acres: 3, polygons: 1 }], [6, { acres: 2, polygons: 1 }], [7, { acres: 4, polygons: 2 }], [8, { acres: 5, polygons: 1 }]]);
const OUT = new Map([[5, 0.62], [8, 0.99]]);
test('join: matched id with agreeing area keeps values, outline marked not compared', () => {
  const r = joinValues(V, G).get(1); assert.equal(r.idMatch, true); assert.equal(r.area, 'agrees'); assert.equal(r.geometry, 'unknown'); assert.ok(r.values); assert.match(r.status, /not compared/);
});
test('join: area discrepancy withholds values and is not called a boundary change', () => {
  const r = joinValues(V, G).get(2); assert.equal(r.values, null); assert.equal(r.area, 'discrepancy'); assert.doesNotMatch(r.status, /boundary changed/);
});
test('join: same area but a different outline is caught when outlines are compared', () => {
  const r = joinValues(V, G, { outline: OUT }).get(5); assert.equal(r.area, 'agrees'); assert.equal(r.geometry, 'differs'); assert.equal(r.values, null);
});
test('join: outline verified only from a real comparison', () => {
  assert.equal(joinValues(V, G, { outline: OUT }).get(8).geometry, 'verified'); assert.equal(joinValues(V, G).get(8).geometry, 'unknown');
});
test('join: missing acreage is unavailable, never a silent match', () => {
  const r = joinValues(V, G).get(6); assert.equal(r.area, 'unavailable'); assert.equal(r.values, null);
});
test('join: multi-polygon account acreage is not compared', () => { assert.equal(joinValues(V, G).get(7).area, 'unavailable'); });
test('join: new account has no values', () => { assert.equal(joinValues(V, G).get(4).values, null); assert.equal(joinValues(V, G).get(4).idMatch, false); });
test('join: values without geometry are not mapped and their status is unknown', () => {
  const r = joinValues(V, G).get(3); assert.equal(r.mapped, false); assert.match(r.status, /status unknown/); assert.doesNotMatch(r.status, /retired/);
});

// fake keyset server over rows sorted (v DESC, id ASC), with repeated rows per account
const ROWS = [];
for (let id = 1; id <= 37; id++) { const v = 100 - Math.floor(id / 3); for (let k = 0; k < (id % 4) + 1; k++) ROWS.push({ id, v }); }
ROWS.sort((a, b) => b.v - a.v || a.id - b.id);
const after = (c) => (r) => !c || r.v < c[0] || (r.v === c[0] && r.id > c[1]);
const fetchRows = async (c, n) => ROWS.filter(after(c)).slice(0, n);
test('keyset paging returns every account once, in order, across page boundaries', async () => {
  for (const size of [1, 2, 5, 7, 50]) {
    const ids = (await pageAccounts(fetchRows, size, 'v')).flat().map((r) => r.id);
    const truth = [...new Set(ROWS.map((r) => r.id))];
    assert.deepEqual(ids, truth, `page size ${size}`);
  }
});
test('per-page dedupe with offsets repeats or skips accounts (why keyset is used)', () => {
  const repeats = [2, 3, 4, 7].map((n) => { const flat = []; for (let o = 0; o < ROWS.length; o += n) flat.push(...new Set(ROWS.slice(o, o + n).map((r) => r.id))); return flat.length - new Set(flat).size; });
  assert.ok(repeats.every((r) => r > 0), String(repeats));
});

import { bexarLandMarket, zoningAttrKey } from './parcel-metrics.mjs';
test('keyset paging rejects rows without a sort value', async () => {
  await assert.rejects(pageAccounts(async () => [{ id: 1, v: null }], 5, 'v'), /missing sort value/);
});
test('keyset paging rejects a server that does not advance past the cursor', async () => {
  const stuck = async () => [{ id: 1, v: 9 }, { id: 2, v: 8 }];
  await assert.rejects(pageAccounts(stuck, 2, 'v'), /not after the cursor/);
});
test('keyset paging propagates fetch errors instead of returning a short list', async () => {
  let k = 0; const flaky = async (c, n) => { if (k++) throw new Error('timeout'); return ROWS.filter(after(c)).slice(0, n); };
  await assert.rejects(pageAccounts(flaky, 3, 'v'), /timeout/);
});
test('an account whose rows disagree on the sort value is listed once and reported', async () => {
  const rows = [{ id: 1, v: 9 }, { id: 2, v: 8 }, { id: 1, v: 7 }, { id: 3, v: 6 }];
  const f = async (c, n) => rows.filter(after(c)).slice(0, n);
  for (const size of [1, 2, 3]) {
    const pages = await pageAccounts(f, size, 'v');
    assert.deepEqual(pages.flat().map((r) => r.id), [1, 2, 3], `size ${size}`); assert.deepEqual(pages.conflicts, [1]);
  }
});
test('zoning: same geometry and Zoning string but different condition is a conflict, not a duplicate', () => {
  const a = { Zoning: 'C-2 S', Base: 'C-2', SpecDistrict: 'S', SpecCondition: 'Ord 2019-01' }, b = { ...a, SpecCondition: 'Ord 2023-07' };
  const z = zoningShares(100, [{ code: 'C-2 S', sqft: 100, geomKey: 'g', attrKey: zoningAttrKey(a) }, { code: 'C-2 S', sqft: 100, geomKey: 'g', attrKey: zoningAttrKey(b) }], 100);
  assert.equal(z.duplicatePieces, 0); assert.equal(z.conflict, true);
});
test('zoning: identical geometry and identical attributes dedupe', () => {
  const a = { Zoning: 'C-2 S', Base: 'C-2', SpecDistrict: 'S', SpecCondition: null };
  const z = zoningShares(100, [{ code: 'C-2 S', sqft: 100, geomKey: 'g', attrKey: zoningAttrKey(a) }, { code: 'C-2 S', sqft: 100, geomKey: 'g', attrKey: zoningAttrKey({ ...a, SpecCondition: '' }) }], 100);
  assert.equal(z.duplicatePieces, 1); assert.equal(z.conflict, false);
});
const BX = { Market_val: 406000, Land_hstd_val: 18430, Land_non_hstd_val: 0, Imprv_hstd_val: 138060, Imprv_non_hstd_val: 0, AG_Market: 249510 };
test('Bexar: a null component makes land value unavailable and names the field', () => {
  const r = bexarLandMarket({ ...BX, AG_Market: null }); assert.equal(r.landMarket, null); assert.deepEqual(r.missing, ['AG_Market']);
});
test('Bexar: null counts as zero only for fields explicitly listed', () => {
  const r = bexarLandMarket({ ...BX, Market_val: 156490, AG_Market: null }, { nullAsZero: ['AG_Market'] }); assert.equal(r.reconciles, true); assert.equal(r.landMarket, 18430);
});
test('Bexar: numeric strings accepted, empty strings and text are not', () => {
  assert.equal(bexarLandMarket({ ...BX, Land_hstd_val: '18430' }).landMarket, 267940);
  assert.equal(bexarLandMarket({ ...BX, Land_hstd_val: '' }).landMarket, null);
  assert.equal(bexarLandMarket({ ...BX, Land_hstd_val: 'n/a' }).landMarket, null);
  assert.equal(bexarLandMarket({ ...BX, Market_val: undefined }).landMarket, null);
});
test('Bexar land market value includes ag land market value and reconciles to Market_val', () => {
  const r = bexarLandMarket({ Market_val: 406000, Land_hstd_val: 18430, Land_non_hstd_val: 0, Imprv_hstd_val: 138060, Imprv_non_hstd_val: 0, AG_Market: 249510, AG_Use_val: 1200 });
  assert.equal(r.reconciles, true); assert.equal(r.landMarket, 267940);
});
test('Bexar land market value is unavailable when components do not reconcile', () => {
  assert.equal(bexarLandMarket({ Market_val: 191710, Land_hstd_val: 0, Land_non_hstd_val: 0, Imprv_hstd_val: 0, Imprv_non_hstd_val: 0, AG_Market: 0 }).landMarket, null);
});
test('Bexar reported zero land value with reconciling total stays zero', () => {
  assert.equal(bexarLandMarket({ Market_val: 0, Land_hstd_val: 0, Land_non_hstd_val: 0, Imprv_hstd_val: 0, Imprv_non_hstd_val: 0, AG_Market: 0 }).landMarket, 0);
});
