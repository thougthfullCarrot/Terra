// The block-by-block build must give exactly the same rows and tiles as processing everything in memory at once.
import { describe, expect, it } from 'vitest';
import * as turf from '@turf/turf';
import { mkdtemp, readdir, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { buildBlocked } from '../src/rawland/blocked.js';
import { PolygonIndex, parcelZoning, cityShares, geomKey, unionPolys, type Poly } from '../src/rawland/spatial.js';
import { zoningStatus } from '../src/rawland/jurisdiction.js';
import { cityMatch } from '../src/rawland/metrics.js';
import { tileKey } from '../src/rawland/tiles.js';

let seed = 7; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
const X0 = -98.6, Y0 = 29.3;
const sq = (x: number, y: number, s: number, p: Record<string, unknown>) => turf.bboxPolygon([x, y, x + s, y + s], { properties: p }) as unknown as Poly;
function fixture() {
  const outlines: Poly[] = [], values = new Map<string, any>();
  for (let i = 1; i <= 1500; i++) {
    const id = String(100000 + i), s = rnd() < 0.02 ? 0.12 : 0.002 + rnd() * 0.004; // a few parcels larger than a block
    outlines.push(sq(X0 + rnd() * 0.3, Y0 + rnd() * 0.3, s, { Prop_id: id }));
    if (i % 50 === 0) outlines.push(sq(X0 + rnd() * 0.3, Y0 + rnd() * 0.3, 0.003, { Prop_id: id })); // second record, other place
    if (i % 7 !== 0) values.set(id, { acres: 1 + (i % 5), stateCode: 'D1', market: i * 10, land: i * 5, landPsf: 1, status: 'ok' });
  }
  for (let i = 0; i < 40; i++) values.set(String(900000 + i), { acres: 2, stateCode: 'E1', market: 1, land: 1, landPsf: 1, status: 'ok' }); // no outline
  const zoning: Poly[] = [];
  for (let x = 0; x < 30; x++) for (let y = 0; y < 30; y++) zoning.push(sq(X0 + x * 0.011, Y0 + y * 0.011, 0.011, { Zoning: ['R-6', 'C-2', 'I-1'][(x + y) % 3] }));
  zoning.push(sq(X0 + 0.05, Y0 + 0.05, 0.2, { Zoning: 'OCL' })); // a large polygon spanning many blocks
  const ring: number[][] = []; for (let i = 0; i < 3000; i++) { const a = (2 * Math.PI * i) / 3000; ring.push([X0 + 0.15 + 0.12 * Math.cos(a), Y0 + 0.15 + 0.12 * Math.sin(a)]); } ring.push(ring[0]!);
  const limits = [turf.polygon([ring], { city: 'Unincorporated' }) as unknown as Poly, sq(X0, Y0, 0.05, { city: 'San Antonio' })];
  const cityAcct = new Map([['100001', { acres: 1, polygons: 1 }]]);
  return { outlines, values, zoning, limits, cityAcct };
}

/** The previous all-in-memory algorithm. */
function reference(fx: ReturnType<typeof fixture>, li: PolygonIndex) {
  const outlines = new Map<string, Poly>();
  for (const f of fx.outlines) { const id = String(f.properties.Prop_id); if (!fx.values.has(id)) continue; const p = outlines.get(id); if (!p) outlines.set(id, f); else if (geomKey(p) !== geomKey(f)) outlines.set(id, unionPolys([p, f]) ?? p); }
  const zi = new PolygonIndex(fx.zoning); const rows: any[] = []; const tiles = new Map<string, any[]>();
  for (const [account, value] of fx.values) {
    const outline = outlines.get(account);
    if (!outline) { rows.push({ account, acres: value.acres, stateCode: value.stateCode, zoningBases: [], zoningStatus: 'Outline unavailable', market: value.market, land: value.land, landPsf: value.landPsf, valueStatus: value.status, cx: NaN, cy: NaN }); continue; }
    const c = parcelZoning(outline, zi, 'complete'); const zs = zoningStatus('complete', cityShares(outline, li), c);
    const bases = 'districts' in c ? [...new Set(c.districts.map((d) => d.code.split(/\s+/)[0]!))] : [];
    const [cx, cy] = turf.centroid(outline).geometry.coordinates as [number, number];
    const row = { account, acres: value.acres, stateCode: value.stateCode, zoningBases: bases, zoningStatus: zs.status, market: value.market, land: value.land, landPsf: value.landPsf, valueStatus: value.status, cx, cy };
    rows.push(row); const k = tileKey(cx, cy); (tiles.get(k) ?? tiles.set(k, []).get(k)!).push(JSON.parse(JSON.stringify({ ...row, cityMatch: cityMatch(value.acres, fx.cityAcct.get(account)), zoning: c, outline: outline.geometry })));
  }
  return { rows, tiles };
}
async function* iter(a: Poly[]) { for (const x of a) yield JSON.parse(JSON.stringify(x)) as Poly; }
const byAccount = (a: any, b: any) => (a.account < b.account ? -1 : 1);

describe('block-by-block build', () => {
  it('matches the in-memory build exactly, across block edges and for parcels bigger than a block', async () => {
    const fx = fixture(); const li = new PolygonIndex(fx.limits); const ref = reference(fx, li);
    const dir = await mkdtemp(join(tmpdir(), 'rl-blocked-'));
    const res = await buildBlocked({ values: fx.values, outlines: () => iter(fx.outlines), zoning: () => iter(fx.zoning), limits: li, cityAcct: fx.cityAcct, status: { zoning: 'complete', cityLimits: 'complete' }, tmp: join(dir, 'tmp'), tilesDir: join(dir, 'tiles'), block: 0.02 });
    expect(res.blocks).toBeGreaterThan(50);
    expect(JSON.parse(JSON.stringify(res.rows))).toEqual(JSON.parse(JSON.stringify(ref.rows)));
    expect(res.noOutline).toBe(40 + [...fx.values.keys()].filter((k) => k < '900000' && !fx.outlines.some((o) => o.properties.Prop_id === k)).length);
    expect(res.droppedOutlines).toBe(new Set(fx.outlines.map((o) => String(o.properties.Prop_id)).filter((k) => !fx.values.has(k))).size);
    const files = await readdir(join(dir, 'tiles'));
    expect(files.length).toBe(ref.tiles.size); expect(res.tiles).toBe(ref.tiles.size);
    for (const f of files) {
      const got = JSON.parse(gunzipSync(await readFile(join(dir, 'tiles', f))).toString());
      expect(got.sort(byAccount)).toEqual(ref.tiles.get(f.replace('.json.gz', ''))!.sort(byAccount));
    }
    await expect(readdir(join(dir, 'tmp'))).rejects.toThrow(); // temp files removed
  }, 60000);
});

describe('timing trial', () => {
  it('processes only the first N blocks and keeps nothing', async () => {
    const fx = fixture(); const dir = await mkdtemp(join(tmpdir(), 'rl-trial-'));
    const res = await buildBlocked({ values: fx.values, outlines: () => iter(fx.outlines), zoning: () => iter(fx.zoning), limits: new PolygonIndex(fx.limits), cityAcct: fx.cityAcct, status: { zoning: 'complete', cityLimits: 'complete' }, tmp: join(dir, 'tmp'), tilesDir: join(dir, 'tiles'), block: 0.02, maxBlocks: 3 });
    expect(res.blocks).toBe(3); expect(res.rows).toEqual([]);
    await expect(readdir(join(dir, 'tmp'))).rejects.toThrow();
  }, 60000);
});
