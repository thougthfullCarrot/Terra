import { fetchText, type FetchJsonOptions } from '../lib/http.js';
import type { City } from '../types.js';
import { csvLines, csvNumber, latestMonthly, monthName, parseCsvLine, type MonthlyReading } from './csv.js';

/**
 * Apartment List's national rent data: median apartment rent with its
 * year-over-year change, and the apartment vacancy index, monthly, by city.
 * Published free for reuse with attribution, which the page's sources line
 * gives.
 *
 * The CSVs live at content-hashed URLs that change every month, so the
 * newest ones are found by reading the data page's download links.
 */

export const DATA_PAGE = 'https://www.apartmentlist.com/research/category/data-rent-estimates';

/** The newest summary and vacancy CSV linked from the data page. */
export function findApartmentListFiles(html: string): { summary: string | null; vacancy: string | null } {
  const newest = (kind: string) => {
    const pattern = new RegExp(`//assets\\.ctfassets\\.net/[^"'\\\\\\s]+/Apartment_List_${kind}_(\\d{4})_(\\d{2})\\.csv`, 'g');
    let best: { url: string; at: number } | null = null;
    for (const match of html.matchAll(pattern)) {
      const at = Number(match[1]) * 100 + Number(match[2]);
      if (!best || at > best.at) best = { url: `https:${match[0]}`, at };
    }
    return best?.url ?? null;
  };
  return { summary: newest('Rent_Estimates_Summary'), vacancy: newest('Vacancy_Index') };
}

const label = (city: City) => `${city}, TX`;

/** Summary file: one row per place for the latest month, rent change as a fraction. */
export function parseRentSummary(text: string, cities: readonly City[]): Map<City, MonthlyReading> {
  const [head, ...rows] = csvLines(text).map(parseCsvLine);
  const out = new Map<City, MonthlyReading>();
  if (!head) return out;
  const col = (name: string) => head.indexOf(name);
  for (const row of rows) {
    const city = cities.find((c) => label(c) === row[col('location_name')]);
    if (!city || row[col('location_type')] !== 'City') continue;
    const value = csvNumber(row[col('price_overall')]);
    const change = csvNumber(row[col('rent_change_yoy')]);
    const year = csvNumber(row[col('year')]);
    const month = csvNumber(row[col('month')]);
    if (value == null || year == null || month == null) continue;
    // Store the year-ago rent the change implies, so growth is computed the same way as every other source.
    out.set(city, { value, yearAgo: change == null ? null : value / (1 + change), period: monthName(year, month) });
  }
  return out;
}

/** Vacancy file: one row per place, a column per month (2026_09), vacancy as a fraction. */
export function parseVacancy(text: string, cities: readonly City[]): Map<City, MonthlyReading> {
  const [head, ...rows] = csvLines(text).map(parseCsvLine);
  const out = new Map<City, MonthlyReading>();
  if (!head) return out;
  const toMonth = (column: string) => {
    const match = /^(\d{4})_(\d{2})$/.exec(column);
    return match ? { year: Number(match[1]), month: Number(match[2]) } : null;
  };
  for (const row of rows) {
    const city = cities.find((c) => label(c) === row[head.indexOf('location_name')]);
    if (!city || row[head.indexOf('location_type')] !== 'City') continue;
    const reading = latestMonthly(head, row, toMonth);
    if (reading) out.set(city, { ...reading, value: reading.value * 100, yearAgo: reading.yearAgo == null ? null : reading.yearAgo * 100 });
  }
  return out;
}

export interface ApartmentListResult {
  rent: Map<City, MonthlyReading>;
  vacancy: Map<City, MonthlyReading>;
}

export async function fetchApartmentList(cities: readonly City[], options: FetchJsonOptions = {}): Promise<ApartmentListResult> {
  const page = await fetchText(DATA_PAGE, { timeoutMs: 60_000, ...options });
  const files = findApartmentListFiles(page);
  if (!files.summary && !files.vacancy) throw new Error('No Apartment List download links on the data page');
  const read = (url: string | null) =>
    url ? fetchText(url, { timeoutMs: 60_000, ...options, accept: 'text/csv' }) : Promise.resolve('');
  const [summary, vacancy] = await Promise.all([read(files.summary), read(files.vacancy)]);
  return { rent: parseRentSummary(summary, cities), vacancy: parseVacancy(vacancy, cities) };
}
