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
}

export interface MarketState {
  open: boolean;
  city: string;
  focus: string;
  sort: string;
  order: Order;
}

export const ORDERS: Order[];
export function defaultOrder(metric: Pick<Metric, 'better'> | undefined): Order;
export function sortMarkets<T extends Market>(markets: T[], key: string, order?: Order): T[];
export function ranks(markets: Market[], metric: Pick<Metric, 'key' | 'better'>): Map<string, number>;
export function ordinal(n: number): string;
export function formatValue(value: number | null | undefined, unit: Unit): string;
export function formatPoints(value: number | null | undefined): string;
export function barPercent(value: number | null | undefined, values: (number | null | undefined)[], unit: Unit): number;
export function readMarketHash(
  hash: string,
  snapshot: { groups: Group[]; metrics: Metric[]; markets: Market[] } | null | undefined
): MarketState;
export function writeMarketHash(state: Partial<MarketState>): string;
export function pruneSnapshot<T extends { groups: Group[]; metrics: Metric[]; markets: Market[] }>(snapshot: T): T;
