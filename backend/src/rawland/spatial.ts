/**
 * Zoning is read once into memory and indexed by bounding box (flatbush). Each parcel is intersected only with the
 * zoning polygons whose boxes overlap it; there are no per-parcel server queries.
 */
import Flatbush from 'flatbush';
import * as turf from '@turf/turf';
import type { Feature as GFeature, MultiPolygon, Polygon, Position } from 'geojson';
import { createHash } from 'node:crypto';
import { zoningAttrKey, zoningCoverage, type Coverage, type ZoningFailure, type ZoningPiece } from './metrics.js';

export type Poly = GFeature<Polygon | MultiPolygon, Record<string, unknown>>;
const SQM_TO_SQFT = 10.763910417;
export const areaSqft = (g: Poly) => turf.area(g) * SQM_TO_SQFT;
export const geomKey = (g: Poly) => createHash('sha1').update(JSON.stringify(g.geometry.coordinates)).digest('hex').slice(0, 16);

/**
 * Large polygons (the county's Unincorporated area has tens of thousands of vertices) are cut once into grid-cell
 * pieces, so each parcel is intersected with a few small pieces instead of the whole polygon; intersecting a parcel
 * with a 5,000-vertex polygon costs ~150 ms, which made a 705k-parcel build take days. The pieces partition the
 * polygon, so areas are unchanged. `source(piece)` returns the original polygon (for geometry keys).
 */
function vertexCount(p: Poly): number {
  const g = p.geometry; let n = 0;
  for (const poly of g.type === 'Polygon' ? [g.coordinates] : g.coordinates) for (const r of poly) n += r.length;
  return n;
}

export class PolygonIndex {
  private readonly index: Flatbush;
  private readonly pieces: Poly[] = [];
  private readonly src = new Map<Poly, Poly>();
  /** Number of pieces made by cutting large polygons. */
  cut = 0;
  constructor(readonly polys: Poly[], { cell = 0.01, maxVerts = 1000 } = {}) {
    for (const p of polys) {
      // Only polygons that are both detailed and span several cells are cut; ordinary zoning polygons stay whole,
      // so memory stays close to the input size (cutting every detailed polygon ran a 768k-polygon build out of memory).
      const [a, b, c, d] = turf.bbox(p);
      if ((c - a <= 2 * cell && d - b <= 2 * cell) || vertexCount(p) <= maxVerts) { this.pieces.push(p); continue; }
      for (let x = Math.floor(a / cell) * cell; x < c; x += cell) for (let y = Math.floor(b / cell) * cell; y < d; y += cell) {
        const g = turf.bboxClip(p, [x, y, x + cell, y + cell]).geometry;
        const polys2 = (g.type === 'Polygon' ? [g.coordinates] : g.coordinates) as Position[][][];
        const rings = polys2.filter((r) => r.length && r[0]!.length >= 4);
        if (!rings.length) continue;
        const piece = turf.multiPolygon(rings, p.properties) as Poly;
        if (!(turf.area(piece) > 0)) continue;
        this.pieces.push(piece); this.src.set(piece, p); this.cut++;
      }
    }
    this.index = new Flatbush(Math.max(1, this.pieces.length));
    for (const p of this.pieces) { const [a, b, c, d] = turf.bbox(p); this.index.add(a, b, c, d); }
    if (!this.pieces.length) this.index.add(0, 0, 0, 0);
    this.index.finish();
  }
  get size(): number { return this.pieces.length; }
  source(piece: Poly): Poly { return this.src.get(piece) ?? piece; }
  candidates(g: Poly): Poly[] {
    if (!this.pieces.length) return [];
    const [a, b, c, d] = turf.bbox(g);
    return this.index.search(a, b, c, d).map((i) => this.pieces[i]!).filter(Boolean);
  }
}

/** One parcel's zoning coverage. `readStatus` is the status of the one-time zoning read. */
export function parcelZoning(parcel: Poly, zoning: PolygonIndex, readStatus: string): Coverage {
  const pieces: (ZoningPiece | ZoningFailure)[] = []; const parts: Poly[] = [];
  const bySource = new Map<Poly, number>();
  for (const z of zoning.candidates(parcel)) {
    let x: Poly | null;
    try { x = turf.intersect(turf.featureCollection([parcel, z])) as Poly | null; } catch (e) { pieces.push({ error: String((e as Error).message).slice(0, 80) }); continue; }
    if (!x) continue;
    parts.push(x);
    const o = zoning.source(z); bySource.set(o, (bySource.get(o) ?? 0) + areaSqft(x));
  }
  for (const [z, sqft] of bySource) pieces.push({ code: String(z.properties.Zoning ?? '').trim(), sqft, geomKey: geomKey(z), attrKey: zoningAttrKey(z.properties) });
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
