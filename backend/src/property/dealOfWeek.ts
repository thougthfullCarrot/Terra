import { readFile } from 'node:fs/promises';
import { fetchText, type FetchJsonOptions } from '../lib/http.js';
import { fredCsvUrl, parseFredCsv } from '../market/fred.js';
import { cleanTitle, parseRss, type RssItem } from '../news/googleNews.js';
import type { City } from '../types.js';

/**
 * Deal of the week: one Texas property sale from the week's headlines,
 * walked through step by step on the site.
 *
 * Texas is a non-disclosure state, so sale prices only become public when a
 * buyer, seller or broker tells the press. Each week the build searches
 * Google News (free RSS, no key) for Texas sales with a price in the
 * headline and picks the biggest. The page then shows what the price implies
 * at a typical cap rate for that kind of property, how a loan at today's
 * rates would size, and whether the debt helps or hurts the buyer. Those cap
 * rates are Terra's assumptions and are labeled as such: the actual income
 * of a sold building is almost never published.
 *
 * Someone who knows a deal's real numbers can override the pick for a week
 * with backend/data/deal-of-week.json (see DealOverride).
 */

export type DealType = 'office' | 'industrial' | 'multifamily' | 'retail' | 'hotel' | 'land' | 'other';

/** Typical going-in cap rates for stabilized Texas property in 2026, in percent: an assumption to teach with, not data from the sale. */
export const ASSUMED_CAP_RATES: Record<DealType, { low: number; mid: number; high: number } | null> = {
  office: { low: 7, mid: 8, high: 9.5 },
  industrial: { low: 5.25, mid: 6, high: 6.75 },
  multifamily: { low: 4.75, mid: 5.25, high: 5.75 },
  retail: { low: 6, mid: 6.75, high: 7.5 },
  hotel: { low: 7.5, mid: 8.5, high: 9.5 },
  land: null,
  other: { low: 6, mid: 6.75, high: 7.5 }
};

export interface Deal {
  /** Monday of the week the deal was picked (YYYY-MM-DD). */
  week: string;
  title: string;
  url: string;
  source: string;
  publishedAt: string | null;
  city: City | null;
  /** The Texas place the headline names. */
  place: string;
  type: DealType;
  price: number;
  /** Price per square foot when the headline gives it. */
  pricePerSqft: number | null;
  squareFeet: number | null;
  units: number | null;
  /** Set only by an override that knows the real figures. */
  capRate: number | null;
  noi: number | null;
  why: string | null;
  /** True when the pick came from the override file. */
  curated: boolean;
}

export interface DealFile {
  generatedAt: string;
  /** The 10-year Treasury the loan step prices off (percent), and its date. */
  treasury: { value: number; date: string } | null;
  deal: Deal | null;
  /** Earlier weeks, newest first. */
  past: Deal[];
  /** The other candidates this week, for "also this week". */
  alsoThisWeek: { title: string; url: string; source: string; price: number }[];
}

/** Places that make a headline Texas; the market each belongs to. */
const PLACES: [string, City | null][] = [
  ['Houston', 'Houston'], ['Katy', 'Houston'], ['Sugar Land', 'Houston'], ['The Woodlands', 'Houston'], ['Pearland', 'Houston'], ['Pasadena', 'Houston'], ['Baytown', 'Houston'], ['Conroe', 'Houston'], ['Cypress', 'Houston'],
  ['Dallas', 'Dallas'], ['DFW', 'Dallas'], ['Plano', 'Dallas'], ['Frisco', 'Dallas'], ['McKinney', 'Dallas'], ['Irving', 'Dallas'], ['Richardson', 'Dallas'], ['Garland', 'Dallas'], ['Mesquite', 'Dallas'], ['Allen', 'Dallas'], ['Carrollton', 'Dallas'], ['Lewisville', 'Dallas'], ['Denton', 'Dallas'], ['Addison', 'Dallas'], ['Las Colinas', 'Dallas'],
  ['Fort Worth', 'Fort Worth'], ['Arlington', 'Fort Worth'], ['Grand Prairie', 'Dallas'], ['Alliance', 'Fort Worth'],
  ['Austin', 'Austin'], ['Round Rock', 'Austin'], ['Georgetown', 'Austin'], ['Cedar Park', 'Austin'], ['Pflugerville', 'Austin'], ['San Marcos', 'Austin'], ['Kyle', 'Austin'],
  ['San Antonio', 'San Antonio'], ['New Braunfels', 'New Braunfels'], ['El Paso', 'El Paso'], ['Lubbock', 'Lubbock'], ['Midland', 'Midland'], ['Odessa', 'Midland'],
  ['College Station', 'College Station'], ['Bryan', 'College Station'], ['Galveston', 'Galveston'], ['Texas', null]
];

const PROPERTY_WORD =
  /^(office|offices|tower|towers|building|buildings|skyscraper|high-rise|campus|apartment|apartments|multifamily|complex|community|warehouse|warehouses|industrial|distribution|logistics|shopping|retail|center|centers|mall|hotel|land|acres|portfolio|property|properties|plaza|park|medical|data|self-storage|storage)\b/i;
const SALE = /\b(sells?|sold|buys?|bought|acquires?|acquired|acquisition|purchases?|purchased|pays|paid|snags?|lands|trades?|traded|closes on|scoops up|picks up)\b/i;
const NOT_A_SALE = /\b(loans?|refinanc\w*|on the market|listed|for sale|lists|foreclos\w*|hit on|lawsuit|expansion|plans?|to build|break ground|groundbreaking|proposed|stake)\b/i;

/** "$300 Million", "$155M", "$1.2 billion" → dollars. */
export function readPrice(title: string): number | null {
  const m = /\$\s?(\d{1,3}(?:,\d{3})*(?:\.\d+)?)\s*(million|mil|m|billion|bn|b)\b/i.exec(title);
  if (!m) return null;
  const n = Number(m[1]!.replace(/,/g, ''));
  const scale = /^b/i.test(m[2]!) ? 1e9 : 1e6;
  return Number.isFinite(n) && n > 0 ? Math.round(n * scale) : null;
}

/** "$733 per sf", "$250/SF", "$180 a square foot". */
export function readPricePerSqft(title: string): number | null {
  const m = /\$\s?(\d{2,4}(?:\.\d+)?)\s*(?:per|\/|a)\s*(?:sf|sq\.? ?ft|square[- ]f(?:oo|ee)t)\b/i.exec(title);
  return m ? Number(m[1]) : null;
}

export function readSize(title: string): { squareFeet: number | null; units: number | null } {
  const sf = /(\d{1,3}(?:,\d{3})+|\d+(?:\.\d+)?)\s*(million)?[- ](?:sf|square[- ]f(?:oo|ee)t)\b/i.exec(title);
  const units = /(\d{2,4})[- ]units?\b/i.exec(title);
  let squareFeet: number | null = null;
  if (sf) {
    const n = Number(sf[1]!.replace(/,/g, ''));
    squareFeet = sf[2] ? Math.round(n * 1e6) : n;
  }
  return { squareFeet: squareFeet && squareFeet >= 1000 ? squareFeet : null, units: units ? Number(units[1]) : null };
}

export function dealType(title: string): DealType {
  if (/\b(apartments?|multifamily|multi-family|units)\b/i.test(title)) return 'multifamily';
  if (/\b(warehouses?|industrial|distribution|logistics|manufacturing)\b/i.test(title)) return 'industrial';
  if (/\b(shopping|retail|mall|grocery|strip center)\b/i.test(title)) return 'retail';
  if (/\b(hotels?|resort)\b/i.test(title)) return 'hotel';
  if (/\b(office|offices|tower|skyscraper|high-rise|campus)\b/i.test(title)) return 'office';
  if (/\b(land|acres)\b/i.test(title)) return 'land';
  return 'other';
}

/**
 * The Texas place the property is in, when the headline places it there: the
 * place right before a property word ("Austin tower", "Plano apartment
 * complex"), "in Austin", or "Austin's". "Dallas firm buys Miami building"
 * names Dallas only as the buyer's home, so it doesn't count.
 */
export function texasPlace(title: string): { place: string; city: City | null } | null {
  for (const [place, city] of PLACES) {
    const re = new RegExp(`(^|[^-\\w])${place.replace(/ /g, '\\s')}(?![-\\w])('s)?`, 'gi');
    for (const m of title.matchAll(re)) {
      const after = title.slice(m.index! + m[0].length).trim();
      const before = title.slice(0, m.index! + m[1]!.length);
      const nextWords = after.split(/\s+/).slice(0, 3).join(' ');
      if (m[2] || /\bin\s+(downtown\s+|north\s+|south\s+|east\s+|west\s+)?$/i.test(before) || /^,?\s*(Texas|TX)\b/.test(after) ||
        nextWords.split(' ').some((w) => PROPERTY_WORD.test(w.replace(/[^\w-]/g, '')))) {
        if (/^(firm|company|developer|investor|based|REIT|-based)\b/i.test(after)) continue;
        return { place, city };
      }
    }
  }
  return null;
}

export interface Candidate {
  title: string;
  url: string;
  source: string;
  publishedAt: string | null;
  place: string;
  city: City | null;
  price: number;
}

/** Headlines that report a priced sale of a Texas property, one per price and place. */
export function candidates(items: RssItem[]): Candidate[] {
  const out = new Map<string, Candidate>();
  for (const item of items) {
    const title = cleanTitle(item.title, item.source).replace(/^News \| /, '');
    if (!SALE.test(title) || NOT_A_SALE.test(title)) continue;
    const price = readPrice(title);
    const where = texasPlace(title);
    if (!price || !where || price < 1e6) continue;
    const key = `${where.place}|${price}`;
    if (!out.has(key)) out.set(key, { title, url: item.link, source: item.source, publishedAt: item.publishedAt, place: where.place, city: where.city, price });
  }
  return [...out.values()].sort((a, b) => b.price - a.price);
}

/** Monday of the week, as YYYY-MM-DD. */
export function weekOf(date: Date): string {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d.toISOString().slice(0, 10);
}

export function toDeal(c: Candidate, week: string): Deal {
  const size = readSize(c.title);
  return {
    week,
    title: c.title,
    url: c.url,
    source: c.source,
    publishedAt: c.publishedAt,
    city: c.city,
    place: c.place,
    type: dealType(c.title),
    price: c.price,
    pricePerSqft: readPricePerSqft(c.title),
    squareFeet: size.squareFeet,
    units: size.units,
    capRate: null,
    noi: null,
    why: null,
    curated: false
  };
}

/** A week's pick written by hand, with the deal's real figures where they are known. */
export interface DealOverride extends Partial<Omit<Deal, 'curated'>> {
  week: string;
  title: string;
  url: string;
  price: number;
}

export function readOverride(raw: unknown, week: string): Deal | null {
  const list = Array.isArray(raw) ? raw : raw ? [raw] : [];
  const pick = (list as DealOverride[]).find((d) => d && d.week === week && d.title && d.url && Number(d.price) > 0);
  if (!pick) return null;
  return {
    week,
    title: pick.title,
    url: pick.url,
    source: pick.source ?? '',
    publishedAt: pick.publishedAt ?? null,
    city: pick.city ?? null,
    place: pick.place ?? pick.city ?? 'Texas',
    type: pick.type ?? dealType(pick.title),
    price: Number(pick.price),
    pricePerSqft: pick.pricePerSqft ?? null,
    squareFeet: pick.squareFeet ?? null,
    units: pick.units ?? null,
    capRate: pick.capRate ?? null,
    noi: pick.noi ?? null,
    why: pick.why ?? null,
    curated: true
  };
}

const QUERIES = [
  '(sells OR sold OR acquires OR buys OR purchased) (Houston OR Dallas OR Austin OR "San Antonio" OR "Fort Worth") (office OR industrial OR apartments OR retail OR warehouse OR multifamily OR tower OR "shopping center") million',
  '(sells OR sold OR acquires OR buys OR purchased) Texas (office OR industrial OR apartments OR retail OR warehouse OR multifamily OR tower OR "shopping center" OR hotel) million'
];
export const dealSearchUrl = (q: string, days: number) =>
  `https://news.google.com/rss/search?${new URLSearchParams({ q: `${q} when:${days}d`, hl: 'en-US', gl: 'US', ceid: 'US:en' })}`;

export interface DealOptions extends FetchJsonOptions {
  now?: Date;
  previous?: DealFile | null;
  overridePath?: string;
  log?: (line: string) => void;
}

export async function buildDealFile(options: DealOptions = {}): Promise<DealFile> {
  const { now = new Date(), previous = null, overridePath, log = () => {}, ...http } = options;
  const week = weekOf(now);

  let treasury: DealFile['treasury'] = previous?.treasury ?? null;
  try {
    const obs = parseFredCsv(await fetchText(fredCsvUrl('DGS10'), { timeoutMs: 30_000, ...http, accept: 'text/csv' }));
    const last = obs[obs.length - 1];
    if (last) treasury = { value: last.value, date: last.date };
  } catch (error) {
    log(`10-year Treasury: ${error instanceof Error ? error.message : error}`);
  }

  const override = overridePath ? readOverride(await readFile(overridePath, 'utf8').then(JSON.parse).catch(() => null), week) : null;
  let found: Candidate[] = [];
  for (const days of [7, 14]) {
    const items: RssItem[] = [];
    for (const q of QUERIES) {
      try {
        items.push(...parseRss(await fetchText(dealSearchUrl(q, days), { timeoutMs: 30_000, ...http, accept: 'application/rss+xml' })));
      } catch (error) {
        log(`News search: ${error instanceof Error ? error.message : error}`);
      }
    }
    found = candidates(items);
    if (found.length) break;
  }
  for (const c of found) log(`  ${c.price.toLocaleString('en-US').padStart(13)}  ${c.place}: ${c.title} (${c.source})`);

  // The week's pick stays put once made, so the page doesn't change under a reader mid-week.
  const kept = previous?.deal?.week === week ? previous.deal : null;
  const deal = override ?? kept ?? (found[0] ? toDeal(found[0], week) : null);
  const past = [...(previous?.deal && previous.deal.week !== week ? [previous.deal] : []), ...(previous?.past ?? [])]
    .filter((d, i, all) => all.findIndex((x) => x.week === d.week) === i)
    .slice(0, 12);
  return {
    generatedAt: now.toISOString(),
    treasury,
    deal,
    past,
    alsoThisWeek: found.filter((c) => c.url !== deal?.url).slice(0, 5).map(({ title, url, source, price }) => ({ title, url, source, price }))
  };
}
