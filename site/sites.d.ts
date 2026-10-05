// Types for sites.js, so the backend's tests can import it under strict mode.

export interface SiteRow {
  id: string;
  city: string;
  use: 'land' | 'commercial' | 'industrial';
  landSqft: number;
  landPsf: number | null;
  value: number | null;
  zoning: string | null;
}

export interface SiteFilter {
  use: string;
  zoning: string;
  minPsf: number | null;
  maxPsf: number | null;
  minAcres: number | null;
  maxAcres: number | null;
  sort: string;
}

export const SQFT_PER_ACRE: number;
export const SITE_SORTS: [string, string][];
export const DEFAULT_SITE_FILTER: SiteFilter;
export function filterSites<T extends SiteRow>(sites: T[] | null | undefined, city: string, filter?: Partial<SiteFilter>): T[];
export function formatArea(sqft: number): string;
export function commonZoning(sites: Pick<SiteRow, 'zoning'>[] | null | undefined, limit?: number): string[];
