// Large boundary polygons are cut into grid pieces: results must match the uncut polygon, and stay fast.
import { describe, expect, it } from 'vitest';
import * as turf from '@turf/turf';
import { PolygonIndex, parcelZoning, cityShares, type Poly } from '../src/rawland/spatial.js';

function wobbly(n: number, props: Record<string, unknown>): Poly {
  const ring: number[][] = [];
  for (let i = 0; i < n; i++) { const a = (2 * Math.PI * i) / n, r = 0.1 + 0.002 * Math.sin(a * 97); ring.push([-98.5 + r * Math.cos(a), 29.4 + r * Math.sin(a)]); }
  ring.push(ring[0]!);
  return turf.polygon([ring], props) as Poly;
}
const parcel = (x: number, y: number, s = 0.004) => turf.bboxPolygon([x, y, x + s, y + s]) as Poly;

describe('PolygonIndex grid split', () => {
  const big = wobbly(5000, { city: 'Unincorporated', Zoning: 'OCL' });
  const cut = new PolygonIndex([big]), whole = new PolygonIndex([big], { maxVerts: Infinity });

  it('cuts a large polygon into many pieces', () => { expect(cut.size).toBeGreaterThan(100); expect(whole.size).toBe(1); });

  it('city shares match the uncut polygon, including parcels across cell lines and the edge', () => {
    for (const [x, y] of [[-98.5, 29.4], [-98.4955, 29.4055], [-98.4, 29.4], [-98.6, 29.4], [-98.52, 29.31]] as const) {
      const a = cityShares(parcel(x, y), cut), b = cityShares(parcel(x, y), whole);
      expect(a!.cities.map((c) => c.city)).toEqual(b!.cities.map((c) => c.city));
      a!.cities.forEach((c, i) => expect(c.share).toBeCloseTo(b!.cities[i]!.share, 6));
      expect(a!.outsideShare).toBeCloseTo(b!.outsideShare, 6);
    }
  });

  it('a parcel across cell lines gets one zoning record, not a false conflict', () => {
    const c = parcelZoning(parcel(-98.4955, 29.4055), cut, 'complete'), w = parcelZoning(parcel(-98.4955, 29.4055), whole, 'complete');
    expect(c).toEqual(w);
  });

  it('is fast: 1,000 parcels against a 5,000-vertex polygon in well under a second each', () => {
    const t = Date.now();
    for (let i = 0; i < 1000; i++) cityShares(parcel(-98.55 + (i % 40) * 0.0025, 29.35 + Math.floor(i / 40) * 0.004, 0.0005), cut);
    expect((Date.now() - t) / 1000).toBeLessThan(5); // the uncut polygon took ~150 ms per parcel
  });
});
