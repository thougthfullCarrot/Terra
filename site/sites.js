// sites.js — the site finder's filtering and sorting, as plain functions with
// no DOM, so the backend's tests cover them. The list comes from sites.json,
// written by backend/src/bin/export-sites.ts.

export const SQFT_PER_ACRE = 43560;

export const SITE_SORTS = [
  ['size', 'Biggest first'],
  ['psf-asc', 'Lowest land $/sq ft'],
  ['psf-desc', 'Highest land $/sq ft'],
  ['value-desc', 'Highest appraised value']
];

export const DEFAULT_SITE_FILTER = { use: '', zoning: '', minPsf: null, maxPsf: null, minAcres: null, maxAcres: null, sort: 'size' };

/**
 * Sites that pass the filter, sorted. zoning matches the start of the
 * district or any word in it, case-insensitively ("PD" finds "PD-619", "MF"
 * finds "MF-3-NP"); a site with no zoning on record passes only an empty
 * zoning filter. Price bounds apply to land value per square foot.
 */
export function filterSites(sites, city, filter = DEFAULT_SITE_FILTER) {
  const f = { ...DEFAULT_SITE_FILTER, ...filter };
  const zoning = String(f.zoning ?? '').trim().toUpperCase();
  const minSqft = f.minAcres != null ? f.minAcres * SQFT_PER_ACRE : null;
  const maxSqft = f.maxAcres != null ? f.maxAcres * SQFT_PER_ACRE : null;
  const out = (sites ?? []).filter((s) => {
    if (city && s.city !== city) return false;
    if (f.use && s.use !== f.use) return false;
    if (zoning) {
      const z = String(s.zoning ?? '').toUpperCase();
      if (!z || !(z.startsWith(zoning) || z.split(/[^A-Z0-9]+/).includes(zoning))) return false;
    }
    if (f.minPsf != null && !(s.landPsf != null && s.landPsf >= f.minPsf)) return false;
    if (f.maxPsf != null && !(s.landPsf != null && s.landPsf <= f.maxPsf)) return false;
    if (minSqft != null && s.landSqft < minSqft) return false;
    if (maxSqft != null && s.landSqft > maxSqft) return false;
    return true;
  });
  const missingLast = (a, b, get, dir) => {
    const x = get(a);
    const y = get(b);
    if (x == null && y == null) return 0;
    if (x == null) return 1;
    if (y == null) return -1;
    return dir * (x - y);
  };
  const by = {
    size: (a, b) => b.landSqft - a.landSqft,
    'psf-asc': (a, b) => missingLast(a, b, (s) => s.landPsf, 1),
    'psf-desc': (a, b) => missingLast(a, b, (s) => s.landPsf, -1),
    'value-desc': (a, b) => missingLast(a, b, (s) => s.value, -1)
  }[f.sort] ?? ((a, b) => b.landSqft - a.landSqft);
  return out.sort((a, b) => by(a, b) || a.id.localeCompare(b.id));
}

/** "2.4 acres" over an acre, "18,500 sq ft" under. */
export function formatArea(sqft) {
  if (!(sqft > 0)) return '—';
  if (sqft >= SQFT_PER_ACRE) {
    const acres = sqft / SQFT_PER_ACRE;
    return `${acres >= 10 ? Math.round(acres) : acres.toFixed(1)} acres`;
  }
  return `${Math.round(sqft).toLocaleString('en-US')} sq ft`;
}

/** The zoning districts most common among the sites, for the filter's suggestions. */
export function commonZoning(sites, limit = 12) {
  const counts = new Map();
  for (const s of sites ?? []) {
    const base = String(s.zoning ?? '').toUpperCase().split(/[^A-Z0-9]+/)[0];
    if (base) counts.set(base, (counts.get(base) ?? 0) + 1);
  }
  return [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, limit).map(([z]) => z);
}
