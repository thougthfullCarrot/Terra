import type { CountyCoverage } from '../market/registrations.js';
import type { MarketSnapshot, ValueStatus } from '../market/snapshot.js';
import type { City } from '../types.js';

/**
 * A compact copy of one day's market file, kept in market_history (migration
 * 0016) so watchlist digests can say what changed since the member's last
 * email. It keeps every figure with its period and status, each project's
 * status, cost and end date, and the recent TABS registrations with their
 * coverage. Everything else (map points, scopes, research links) is left out.
 */
export const HISTORY_VERSION = 1;
/** Days of history kept. Rod chose 90 to start (2026-10-10). */
export const HISTORY_DAYS = 90;

export interface HistoryFigure {
  v: number | null;
  /** Reporting period, e.g. "Aug 2026". */
  p: string | null;
  s?: ValueStatus;
  /** The market whose observation this repeats (New Braunfels shows San Antonio's metro). */
  sh?: City;
}

export interface HistoryProject {
  c: City;
  n: string;
  st: string;
  cost: number;
  end: string | null;
  src: 'tabs' | 'city';
  url: string;
}

export interface HistoryRegistration {
  id: string;
  cities: City[];
  county: string;
  n: string;
  w: string;
  cost: number;
  reg: string;
  st: string;
  url: string;
}

export interface HistoryDay {
  v: number;
  /** Texas calendar day, YYYY-MM-DD. */
  day: string;
  generatedAt: string;
  /** Label and unit per metric key, so a digest can name a figure without the full file. */
  metricInfo: Record<string, [label: string, unit: string]>;
  metrics: Partial<Record<City, Record<string, HistoryFigure>>>;
  behind: { source: string; latest: string }[];
  projects: Record<string, HistoryProject>;
  /** Null when the registrations search did not run or failed on this build. */
  registrations: { days: number; items: HistoryRegistration[]; coverage: CountyCoverage[] } | null;
}

/** Today's date in Texas, which is what a digest's "day" means to members. */
export function texasDay(now = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago' }).format(now);
}

export function digestOf(snapshot: MarketSnapshot, now = new Date()): HistoryDay {
  const metrics: HistoryDay['metrics'] = {};
  for (const market of snapshot.markets) {
    const figures: Record<string, HistoryFigure> = {};
    for (const [key, v] of Object.entries(market.values)) {
      const figure: HistoryFigure = { v: v ?? null, p: market.periods[key] ?? null };
      const status = market.status?.[key];
      if (status) figure.s = status;
      const shared = market.shared?.[key];
      if (shared) figure.sh = shared;
      figures[key] = figure;
    }
    metrics[market.city] = figures;
  }
  const projects: Record<string, HistoryProject> = {};
  for (const p of snapshot.developments?.projects ?? []) {
    projects[p.id] = { c: p.city, n: p.name, st: p.status, cost: p.cost, end: p.end, src: p.source ?? 'tabs', url: p.url };
  }
  const reg = snapshot.registrations;
  return {
    v: HISTORY_VERSION,
    day: texasDay(now),
    generatedAt: snapshot.generatedAt,
    metricInfo: Object.fromEntries(snapshot.metrics.map((m) => [m.key, [m.label, m.unit]])),
    metrics,
    behind: (snapshot.behind ?? []).map((b) => ({ source: b.source, latest: b.latest })),
    projects,
    registrations: reg
      ? {
          days: reg.days,
          items: reg.registrations.map((r) => ({
            id: r.id,
            cities: r.cities,
            county: r.county,
            n: r.name,
            w: r.work,
            cost: r.cost,
            reg: r.registered,
            st: r.status,
            url: r.url
          })),
          coverage: reg.coverage
        }
      : null
  };
}

/** The first day no longer kept, given today. */
export function pruneBefore(today: string, keepDays = HISTORY_DAYS): string {
  const date = new Date(`${today}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() - keepDays);
  return date.toISOString().slice(0, 10);
}

export function addDays(day: string, days: number): string {
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}
