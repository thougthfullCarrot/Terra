/**
 * Zoning is read once into memory and indexed by bounding box (flatbush). Each parcel is intersected only with the
 * zoning polygons whose boxes overlap it; there are no per-parcel server queries.
 */
import Flatbush from 'flatbush';
import * as turf from '@turf/turf';
import type { Feature as GFeature, MultiPolygon, Polygon } from 'geojson';
import { createHash } from 'node:crypto';
import { zoningAttrKey, zoningCoverage, type Coverage, type ZoningFailure, type ZoningPiece } from './metrics.js';

export type Poly = GFeature<Polygon | MultiPolygon, Record<string, unknown>>;
const SQM_TO_SQFT = 10.763910417;
export const areaSqft = (g: Poly) => turf.area(g) * SQM_TO_SQFT;
export const geomKey = (g: Poly) => createHash('sha1').update(JSON.stringify(g.geometry.coordinates)).digest('hex').slice(0, 16);

export class PolygonIndex {
  private readonly index: Flatbush;
  constructor(readonly polys: Poly[]) {
    this.index = new Flatbush(Math.max(1, polys.length));
    for (const p of polys) { const [a, b, c, d] = turf.bbox(p); this.index.add(a, b, c, d); }
    if (!polys.length) this.index.add(0, 0, 0, 0);
    this.index.finish();
  }
  candidates(g: Poly): Poly[] {
    if (!this.polys.length) return [];
    const [a, b, c, d] = turf.bbox(g);
    return this.index.search(a, b, c, d).map((i) => this.polys[i]!).filter(Boolean);
  }
}

/** One parcel's zoning coverage. `readStatus` is the status of the one-time zoning read. */
export function parcelZoning(parcel: Poly, zoning: PolygonIndex, readStatus: string): Coverage {
  const pieces: (ZoningPiece | ZoningFailure)[] = []; const parts: Poly[] = [];
  for (const z of zoning.candidates(parcel)) {
    let x: Poly | null;
    try { x = turf.intersect(turf.featureCollection([parcel, z])) as Poly | null; } catch (e) { pieces.push({ error: String((e as Error).message).slice(0, 80) }); continue; }
    if (!x) continue;
    parts.push(x);
    pieces.push({ code: String(z.properties.Zoning ?? '').trim(), sqft: areaSqft(x), geomKey: geomKey(z), attrKey: zoningAttrKey(z.properties) });
  }
  let union = 0;
  try { union = !parts.length ? 0 : areaSqft(parts.length === 1 ? parts[0]! : (turf.union(turf.featureCollection(parts)) as Poly)); } catch { pieces.push({ error: 'union failed' }); }
  return zoningCoverage(areaSqft(parcel), readStatus, pieces, union);
}

/** Share of the parcel inside each city limit polygon. Errors make the result unavailable. */
export function cityShares(parcel: Poly, limits: PolygonIndex): { cities: { city: string; share: number }[]; outsideShare: number } | null {
  const total = areaSqft(parcel); if (!(total > 0)) return null;
  const by = new Map<string, number>();
  try {
    for (const c of limits.candidates(parcel)) {
      const x = turf.intersect(turf.featureCollection([parcel, c])) as Poly | null;
      if (x) { const k = String(c.properties.city ?? ''); by.set(k, (by.get(k) ?? 0) + areaSqft(x)); }
    }
  } catch { return null; }
  const cities = [...by].map(([city, s]) => ({ city, share: Math.min(1, s / total) })).sort((a, b) => b.share - a.share);
  return { cities, outsideShare: Math.max(0, 1 - cities.reduce((s, c) => s + c.share, 0)) };
}
