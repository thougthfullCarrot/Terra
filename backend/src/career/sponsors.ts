/**
 * New-agent sponsors: the brokerages licensing the most new sales agents in
 * each Terra market, from the Texas Real Estate Commission's license holder
 * data set on the Texas Open Data Portal (data.texas.gov s7ft-44qi, updated
 * daily, free, no key).
 *
 * Every Texas sales agent must be sponsored by a broker, so the brokerages
 * sponsoring the most first-time licensees are the ones hiring and training
 * beginners. Only brokerage names and counts leave this file; nothing about
 * an individual agent is kept.
 */
import { METRO_COUNTIES } from '../market/developments.js';
import { fetchJson, type FetchJsonOptions } from '../lib/http.js';
import type { City } from '../types.js';

export const TREC_DATASET = 'https://data.texas.gov/resource/s7ft-44qi.json';
export const TREC_PAGE = 'https://data.texas.gov/dataset/Broker-and-Sales-Agent-License-Holder-Information/s7ft-44qi';

export interface Sponsor {
  /** The sponsoring broker's license number (a company's ends in -BB). */
  license: string;
  name: string;
  /** The Terra market most of its new agents live in. */
  city: City;
  /** That county, for the label. */
  place: string;
  /** Active sales agents first licensed in the window and sponsored here. */
  newAgents: number;
  /** All active sales agents it sponsors. */
  agents: number;
}

export interface SponsorsFile {
  generatedAt: string;
  /** YYYY-MM-DD of the data set's newest license. */
  asOf: string;
  windowLabel: string;
  source: string;
  brokers: Sponsor[];
}

/** The market a county belongs to; Galveston County goes to Galveston, not Houston. */
export function countyMarkets(): Map<string, City> {
  const out = new Map<string, City>();
  for (const [city, counties] of Object.entries(METRO_COUNTIES) as [City, string[]][]) {
    for (const county of counties) if (!out.has(county) || city === 'Galveston') out.set(county, city);
  }
  return out;
}

/**
 * A SoQL test for "first licensed in the last twelve months": the data set
 * stores dates as MM/DD/YYYY text, so the window is twelve month patterns.
 */
export function lastYearWhere(now: Date, field = 'original_license_date'): string {
  const parts: string[] = [];
  for (let i = 0; i < 12; i++) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    parts.push(`${field} like '${String(d.getUTCMonth() + 1).padStart(2, '0')}/%/${d.getUTCFullYear()}'`);
  }
  return `(${parts.join(' OR ')})`;
}

export function windowLabel(now: Date): string {
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 11, 1));
  const fmt = (d: Date) => d.toLocaleDateString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' });
  return `${fmt(start)} to ${fmt(now)}`;
}

interface NewRow {
  related_license_number?: string;
  related_license_full_name?: string;
  county?: string;
  n: string;
}
interface TotalRow {
  related_license_number?: string;
  n: string;
}

/** Fold the two aggregate queries into one list per market. */
export function buildSponsors(newRows: NewRow[], totalRows: TotalRow[], { minNew = 2, perMarket = 60 } = {}): Sponsor[] {
  const markets = countyMarkets();
  const totals = new Map(totalRows.filter((r) => r.related_license_number).map((r) => [r.related_license_number!, Number(r.n)]));
  const brokers = new Map<string, { license: string; name: string; counties: Map<string, number>; newAgents: number }>();
  for (const row of newRows) {
    const license = row.related_license_number;
    if (!license || !row.related_license_full_name) continue;
    const b = brokers.get(license) ?? { license, name: tidyName(row.related_license_full_name), counties: new Map(), newAgents: 0 };
    const n = Number(row.n) || 0;
    b.newAgents += n;
    if (row.county) b.counties.set(row.county, (b.counties.get(row.county) ?? 0) + n);
    brokers.set(license, b);
  }
  const out: Sponsor[] = [];
  for (const b of brokers.values()) {
    if (b.newAgents < minNew) continue;
    // Where its new agents live, Terra markets only, busiest county first.
    const [county] = [...b.counties].filter(([c]) => markets.has(c)).sort((x, y) => y[1] - x[1])[0] ?? [];
    if (!county) continue;
    out.push({ license: b.license, name: b.name, city: markets.get(county)!, place: `${county} County`, newAgents: b.newAgents, agents: Math.max(totals.get(b.license) ?? 0, b.newAgents) });
  }
  out.sort((a, b) => b.newAgents - a.newAgents || a.name.localeCompare(b.name));
  const kept = new Map<City, number>();
  return out.filter((s) => {
    const n = kept.get(s.city) ?? 0;
    kept.set(s.city, n + 1);
    return n < perMarket;
  });
}

/** "KELLER WILLIAMS REALTY, INC." -> "Keller Williams Realty, Inc."; short all-caps words (LLC, JPAR) stay. */
export function tidyName(name: string): string {
  return name
    .trim()
    .replace(/\s+/g, ' ')
    .split(' ')
    .map((word) => {
      if (word !== word.toUpperCase()) return word;
      if (/^(LLC|LP|LLP|PLLC|INC\.?|DBA|USA|TX|II|III|IV|JPAR|EXP|RE\/MAX|CBRE|JLL|NAI|HPI)[,.]?$/i.test(word)) return word.toUpperCase().replace(/^INC/, 'Inc');
      if (word === word.toUpperCase() && /[A-Z]/.test(word)) return word.charAt(0) + word.slice(1).toLowerCase();
      return word;
    })
    .join(' ');
}

export async function fetchSponsors(now = new Date(), options: FetchJsonOptions = {}): Promise<SponsorsFile> {
  const base = "license_type='Sales Agent' AND status='Active' AND related_license_number IS NOT NULL";
  const query = (params: Record<string, string>) => `${TREC_DATASET}?${new URLSearchParams(params)}`;
  const opts = { timeoutMs: 120_000, ...options };
  const [newRows, totalRows, newest] = await Promise.all([
    fetchJson<NewRow[]>(
      query({
        $select: 'related_license_number, related_license_full_name, county, count(*) as n',
        $where: `${base} AND ${lastYearWhere(now)}`,
        $group: 'related_license_number, related_license_full_name, county',
        $limit: '50000'
      }),
      opts
    ),
    fetchJson<TotalRow[]>(
      query({ $select: 'related_license_number, count(*) as n', $where: base, $group: 'related_license_number', $limit: '100000' }),
      opts
    ),
    fetchJson<{ updated?: string }[]>(query({ $select: 'max(updated) as updated' }), opts)
  ]);
  const brokers = buildSponsors(newRows, totalRows);
  return {
    generatedAt: now.toISOString(),
    asOf: (newest[0]?.updated ?? now.toISOString()).slice(0, 10),
    windowLabel: windowLabel(now),
    source: TREC_PAGE,
    brokers
  };
}
