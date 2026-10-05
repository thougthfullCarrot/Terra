import { fetchText, type FetchJsonOptions } from '../lib/http.js';
import { csvLines, csvNumber, parseCsvLine } from './csv.js';

/**
 * FHFA House Price Index, all-transactions, quarterly, by metro and
 * metropolitan division. No header row; columns are metro name, CBSA code,
 * year, quarter, index, standard error. Divisions are listed, so Dallas
 * (19124) and Fort Worth (23104) get their own figures.
 */

export const FHFA_URL = 'https://www.fhfa.gov/hpi/download/quarterly_datasets/hpi_at_metro.csv';

export interface HpiReading {
  index: number;
  /** Percent change from the same quarter one and five years earlier. */
  change1y: number | null;
  change5y: number | null;
  period: string;
}

export function parseFhfaMetro(text: string, codes: readonly string[]): Map<string, HpiReading> {
  const series = new Map<string, Map<number, number>>();
  for (const line of csvLines(text)) {
    const [, code, year, quarter, index] = parseCsvLine(line).map((f) => f.trim());
    const value = csvNumber(index);
    if (!code || !codes.includes(code) || value == null || !/^\d{4}$/.test(year ?? '') || !/^[1-4]$/.test(quarter ?? '')) continue;
    const points = series.get(code) ?? new Map<number, number>();
    points.set(Number(year) * 4 + Number(quarter) - 1, value);
    series.set(code, points);
  }
  const out = new Map<string, HpiReading>();
  const change = (now: number, then: number | undefined) => (then ? Math.round((now / then - 1) * 1000) / 10 : null);
  for (const [code, points] of series) {
    const last = Math.max(...points.keys());
    const index = points.get(last)!;
    out.set(code, {
      index,
      change1y: change(index, points.get(last - 4)),
      change5y: change(index, points.get(last - 20)),
      period: `Q${(last % 4) + 1} ${Math.floor(last / 4)}`
    });
  }
  return out;
}

export async function fetchFhfa(codes: readonly string[], options: FetchJsonOptions = {}): Promise<Map<string, HpiReading>> {
  const text = await fetchText(FHFA_URL, { timeoutMs: 120_000, ...options, accept: 'text/csv' });
  return parseFhfaMetro(text, codes);
}
