import { fetchText, type FetchJsonOptions } from '../lib/http.js';
import { csvLines, csvNumber, parseCsvLine } from './csv.js';

/**
 * Interest rates and bank lending conditions from FRED, the St. Louis Fed's
 * free data service. Read from its keyless CSV download (fredgraph.csv), so
 * no API key is needed. These are national figures: the same for every
 * Texas city, so the page shows them once above the city table.
 */

export interface RateSeries {
  /** FRED series id. */
  id: string;
  label: string;
  /** One line on what the rate is and why a CRE reader watches it. */
  note: string;
  /** How often FRED publishes it, for the period label. */
  frequency: 'daily' | 'weekly' | 'quarterly';
}

export const RATE_SERIES: RateSeries[] = [
  {
    id: 'DGS10',
    label: '10-year Treasury',
    note: 'The benchmark most commercial mortgages and cap rates are priced off.',
    frequency: 'daily'
  },
  {
    id: 'DGS5',
    label: '5-year Treasury',
    note: 'The base for shorter fixed-rate loans on stabilized property.',
    frequency: 'daily'
  },
  {
    id: 'SOFR',
    label: 'SOFR',
    note: 'Secured Overnight Financing Rate: the base for floating-rate construction and bridge loans.',
    frequency: 'daily'
  },
  {
    id: 'DFF',
    label: 'Fed funds rate',
    note: 'The Federal Reserve\'s policy rate (effective), which short-term lending follows.',
    frequency: 'daily'
  },
  {
    id: 'DPRIME',
    label: 'Prime rate',
    note: 'Bank prime loan rate: what many local bank and SBA property loans float over.',
    frequency: 'daily'
  },
  {
    id: 'MORTGAGE30US',
    label: '30-year mortgage',
    note: 'Average 30-year fixed home loan rate (Freddie Mac survey): drives for-sale housing demand.',
    frequency: 'weekly'
  },
  {
    id: 'SUBLPDRCSC',
    label: 'Banks tightening construction loans',
    note:
      'Net share of banks tightening standards on construction and land development loans (Fed senior loan officer survey). Above zero means credit is getting harder to get.',
    frequency: 'quarterly'
  },
  {
    id: 'SUBLPDRCSN',
    label: 'Banks tightening CRE loans',
    note:
      'Net share of banks tightening standards on loans for existing office, retail, industrial and other non-residential property. Above zero means tighter.',
    frequency: 'quarterly'
  }
];

export const fredCsvUrl = (id: string) => `https://fred.stlouisfed.org/graph/fredgraph.csv?id=${encodeURIComponent(id)}`;
export const fredPageUrl = (id: string) => `https://fred.stlouisfed.org/series/${encodeURIComponent(id)}`;

export interface Observation {
  date: string;
  value: number;
}

/** The dated values in a fredgraph.csv file; FRED marks a missing day with "." or a blank. */
export function parseFredCsv(text: string): Observation[] {
  const out: Observation[] = [];
  for (const line of csvLines(text).slice(1)) {
    const [date, raw] = parseCsvLine(line);
    const value = csvNumber(raw === '.' ? '' : raw);
    if (date && /^\d{4}-\d{2}-\d{2}$/.test(date) && value != null) out.push({ date, value });
  }
  return out.sort((a, b) => a.date.localeCompare(b.date));
}

export interface RateReading {
  key: string;
  label: string;
  note: string;
  /** Percent. */
  value: number;
  /** Change from a year earlier, in percentage points; null without a year of history. */
  change: number | null;
  /** e.g. "Oct 2, 2026", "Q3 2026". */
  period: string;
  url: string;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function periodLabel(date: string, frequency: RateSeries['frequency']): string {
  const [year, month, day] = date.split('-').map(Number) as [number, number, number];
  if (frequency === 'quarterly') return `Q${Math.floor((month - 1) / 3) + 1} ${year}`;
  if (frequency === 'weekly') return `week of ${MONTHS[month - 1]} ${day}, ${year}`;
  return `${MONTHS[month - 1]} ${day}, ${year}`;
}

/** The latest value and its change from the last reading on or before the same date a year earlier. */
export function readRate(series: RateSeries, observations: Observation[]): RateReading | null {
  const last = observations.at(-1);
  if (!last) return null;
  const [year, month, day] = last.date.split('-');
  const cutoff = `${Number(year) - 1}-${month}-${day}`;
  const before = [...observations].reverse().find((o) => o.date <= cutoff);
  // A year-ago reading more than a quarter older than the cutoff is a gap, not a comparison.
  const usable = before && Date.parse(cutoff) - Date.parse(before.date) <= 100 * 86_400_000;
  return {
    key: series.id,
    label: series.label,
    note: series.note,
    value: last.value,
    change: usable ? Math.round((last.value - before.value) * 100) / 100 : null,
    period: periodLabel(last.date, series.frequency),
    url: fredPageUrl(series.id)
  };
}

/** Every rate that answers; one that fails is left out and logged by the caller. */
export async function fetchRates(
  options: FetchJsonOptions = {}
): Promise<{ rates: RateReading[]; failed: string[] }> {
  const rates: RateReading[] = [];
  const failed: string[] = [];
  for (const series of RATE_SERIES) {
    try {
      const text = await fetchText(fredCsvUrl(series.id), { timeoutMs: 30_000, ...options, accept: 'text/csv' });
      const reading = readRate(series, parseFredCsv(text));
      if (reading) rates.push(reading);
      else failed.push(series.id);
    } catch (error) {
      failed.push(`${series.id} (${error instanceof Error ? error.message : String(error)})`);
    }
  }
  return { rates, failed };
}
