import { CITY_ZONING, LABELS } from './labels.js';
import type { Coverage } from './metrics.js';

/**
 * Zoning status from verified city limits, never from the zoning layer alone (its OCL code is cross-checked, not
 * trusted). Unincorporated only when the city-limit read completed and the parcel lies outside every city.
 */
export function zoningStatus(limitsRead: string, shares: { cities: { city: string; share: number }[]; outsideShare: number } | null, coverage: Coverage | null, { minShare = 0.001 } = {}): { status: string; cities: string[]; note?: string } {
  if (limitsRead !== 'complete' || !shares) return { status: LABELS.coverageUnavailable, cities: [], note: 'city limits unavailable' };
  const cities = shares.cities.filter((c) => c.share >= minShare).map((c) => c.city);
  if (!cities.length) {
    const cityCodes = coverage && 'districts' in coverage && coverage.districts.some((d) => d.code !== 'OCL');
    return { status: LABELS.unincorporated, cities, ...(cityCodes ? { note: 'zoning layer has city codes here; check the boundary' } : {}) };
  }
  if (cities.length === 1 && cities[0] !== 'San Antonio') return { status: `${cities[0]}: ${CITY_ZONING[cities[0]!] ?? 'not yet checked'}`, cities };
  if (!cities.includes('San Antonio')) return { status: `Several cities: ${cities.map((c) => `${c} (${CITY_ZONING[c] ?? 'not yet checked'})`).join(', ')}`, cities };
  if (!coverage || coverage.status === 'coverage unavailable') return { status: LABELS.coverageUnavailable, cities, ...(coverage && 'reason' in coverage ? { note: coverage.reason } : {}) };
  if (coverage.status === 'no zoning intersects parcel') return { status: LABELS.zoningNotFound, cities };
  const others = cities.filter((c) => c !== 'San Antonio');
  return { status: coverage.status, cities, ...(others.length ? { note: `also in ${others.join(', ')}` } : shares.outsideShare >= minShare ? { note: 'partly outside city limits' } : {}) };
}
