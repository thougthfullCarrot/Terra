// Types for market.js, so the backend's tests can import it under strict mode.

export type Unit = 'count' | 'usd' | 'change' | 'rate' | 'taxRate';
export type Order = 'desc' | 'asc';

export interface Metric {
  key: string;
  label: string;
  unit: Unit;
  better: 'high' | 'low' | null;
  source?: string;
  note?: string;
  geography?: string;
  category?: string;
}

export interface Group {
  key: string;
  label: string;
  blurb?: string;
  metrics: string[];
}

export interface Market {
  city: string;
  metro?: string;
  values: Record<string, number | null>;
  periods?: Record<string, string | null>;
  fetchedAt?: Record<string, string | null>;
  status?: Record<string, ValueStatus>;
  shared?: Record<string, string>;
}

export type ValueStatus = 'fresh' | 'retained' | 'expired' | 'missing';

export type Tool = '' | 'compare' | 'calc' | 'leases' | 'reports' | 'sites';

export interface MarketState {
  open: boolean;
  city: string;
  focus: string;
  sort: string;
  order: Order;
  tool: Tool;
  compare: string[];
}

export const TOOLS: Tool[];
export const MAX_COMPARE: number;
export const KEY_METRICS: string[];
export function compareRows<M extends Pick<Metric, 'key' | 'better'>>(
  markets: Market[],
  metrics: M[],
  cities: string[]
): { metric: M; values: (number | null)[]; best: string[] }[];

export const ORDERS: Order[];
export function defaultOrder(metric: Pick<Metric, 'better'> | undefined): Order;
export function sortMarkets<T extends Market>(markets: T[], key: string, order?: Order): T[];
export function ranks(markets: Market[], metric: Pick<Metric, 'key' | 'better'>): Map<string, number>;
export function ordinal(n: number): string;
export function sharedWith(market: Market | null | undefined, key: string): string | null;
export function valueStatus(market: Market | null | undefined, key: string): ValueStatus;
export const CATEGORY_LABELS: Record<string, string>;
export const GEOGRAPHY_LABELS: Record<string, string>;
export function formatDate(iso: string | null | undefined): string;
export function valueNotes(market: Market | null | undefined, metric: Pick<Metric, 'key' | 'source' | 'geography'>): string[];
export function rankedCount(markets: Market[], key: string): number;
export function retainedCount(snapshot: { markets: Market[] } | null | undefined): number;
export function formatValue(value: number | null | undefined, unit: Unit): string;
export function formatPoints(value: number | null | undefined): string;
export function barPercent(value: number | null | undefined, values: (number | null | undefined)[], unit: Unit): number;
export function readMarketHash(
  hash: string,
  snapshot: { groups: Group[]; metrics: Metric[]; markets: Market[] } | null | undefined
): MarketState;
export function writeMarketHash(state: Partial<MarketState>): string;
export function pruneSnapshot<T extends { groups: Group[]; metrics: Metric[]; markets: Market[] }>(snapshot: T): T;

export interface Development {
  id: string;
  city: string;
  name: string;
  cost: number;
  isPublic: boolean;
  lat: number | null;
  lng: number | null;
  place?: string | null;
  facility?: string | null;
  address?: string | null;
  addresses?: string[];
  /** Other names and permit numbers the same site is filed under. */
  aliases?: string[];
  work?: string;
  status?: string;
  registered?: string;
}
export interface DevFilters {
  query: string;
  place: string;
  work: string;
  publicInvolvement: string;
  cost: string;
  status: string;
  filed: string;
}
export const COST_BANDS: { key: string; label: string; min: number; max: number }[];
export const FILED_WINDOWS: { key: string; label: string; days: number }[];
export const PUBLIC_INVOLVEMENT: { key: string; label: string }[];
export const EMPTY_DEV_FILTERS: Readonly<DevFilters>;
export function projectSearchText(project: Partial<Development>): string;
export function activeFilterCount(filters: Partial<DevFilters> | null | undefined): number;
export function filterProjects<T extends Partial<Development>>(projects: T[] | null | undefined, filters?: Partial<DevFilters>, asOf?: string): T[];
export function filterChoices(projects: Partial<Development>[] | null | undefined): {
  places: { value: string; count: number }[];
  works: { value: string; count: number }[];
  statuses: { value: string; count: number }[];
};
export function cityProjects<T extends Pick<Development, 'city' | 'cost' | 'isPublic'>>(
  projects: T[] | null | undefined,
  city: string,
  options?: { privateOnly?: boolean }
): T[];
export function markerRadius(cost: number, maxCost: number): number;
export function projectDates(start: string | null | undefined, end: string | null | undefined): string;
