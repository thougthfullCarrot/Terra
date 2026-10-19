import { CITY_ZONING, LABELS } from './labels.js';
import type { Coverage } from './metrics.js';

/** How the county Cities layer names a polygon. Only an explicit Unincorporated polygon counts as unincorporated. */
export type JurisKind = 'city' | 'unincorporated' | 'military';
export const jurisKind = (name: string): JurisKind => /^\s*unincorporated\s*$/i.test(name) ? 'unincorporated' : CITY_ZONING[name.trim()] === 'military installation, no city zoning' ? 'military' : 'city';

/**
 * Zoning status from verified city limits, never from the zoning layer alone (its OCL code is cross-checked, not
 * trusted). Unincorporated only where the county layer's own Unincorporated polygon covers the parcel; land
 * outside every polygon is unknown, never assumed unincorporated.
 */
export function zoningStatus(limitsRead: string, shares: { cities: { city: string; share: number }[]; outsideShare: number } | null, coverage: Coverage | null, { minShare = 0.001 } = {}): { status: string; cities: string[]; note?: string } {
  if (limitsRead !== 'complete' || !shares) return { status: LABELS.coverageUnavailable, cities: [], note: 'city limits unavailable' };
  const named = shares.cities.filter((c) => c.share >= minShare).map((c) => c.city.trim());
  const gap = shares.outsideShare >= minShare ? { note: 'part of the parcel is outside every county boundary polygon (unknown)' } : {};
  if (!named.length) return { status: LABELS.jurisdictionUnknown, cities: [] };
  const cities = named.filter((c) => jurisKind(c) === 'city');
  const other = named.filter((c) => jurisKind(c) !== 'city');
  if (!cities.length) {
    if (other.length === 1 && jurisKind(other[0]!) === 'unincorporated') {
      const cityCodes = coverage && 'districts' in coverage && coverage.districts.some((d) => d.code !== 'OCL');
      return { status: LABELS.unincorporated, cities: [], ...(cityCodes ? { note: 'zoning layer has city codes here; check the boundary' } : gap) };
    }
    if (other.length === 1) return { status: `${other[0]}: military installation, no city zoning`, cities: [], ...gap };
    return { status: `Several jurisdictions: ${other.join(', ')}`, cities: [], ...gap };
  }
  const also = other.length ? { note: `also in ${other.join(', ')}` } : gap;
  if (cities.length === 1 && cities[0] !== 'San Antonio') return { status: `${cities[0]}: ${CITY_ZONING[cities[0]!] ?? 'not yet checked'}`, cities, ...also };
  if (!cities.includes('San Antonio')) return { status: `Several cities: ${cities.map((c) => `${c} (${CITY_ZONING[c] ?? 'not yet checked'})`).join(', ')}`, cities, ...also };
  if (!coverage || coverage.status === 'coverage unavailable') return { status: LABELS.coverageUnavailable, cities, ...(coverage && 'reason' in coverage ? { note: coverage.reason } : {}) };
  if (coverage.status === 'no zoning intersects parcel') return { status: LABELS.zoningNotFound, cities };
  const others = cities.filter((c) => c !== 'San Antonio').concat(other);
  return { status: coverage.status, cities, ...(others.length ? { note: `also in ${others.join(', ')}` } : shares.outsideShare >= minShare ? { note: 'partly outside city limits' } : {}) };
}
