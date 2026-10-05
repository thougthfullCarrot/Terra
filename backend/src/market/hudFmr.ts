import { fetchJson, type FetchJsonOptions } from '../lib/http.js';
import type { City } from '../types.js';
import type { Metro } from './metros.js';

/**
 * HUD Fair Market Rents: what a voucher pays for a modest unit, by bedroom
 * count, for each metro FMR area. HUD's API needs a free token
 * (HUD_API_TOKEN); without one the source is skipped.
 */

export const hudFmrUrl = (entity: string) => `https://www.huduser.gov/hudapi/public/fmr/data/${encodeURIComponent(entity)}`;

export interface FmrReading {
  /** Efficiency (0) through four bedrooms. */
  rents: [number | null, number | null, number | null, number | null, number | null];
  /** e.g. "FY 2026". */
  period: string;
}

const FIELDS = ['Efficiency', 'One-Bedroom', 'Two-Bedroom', 'Three-Bedroom', 'Four-Bedroom'] as const;

type Basic = Record<string, unknown>;
interface FmrResponse {
  data?: { year?: string | number; basicdata?: Basic | Basic[] };
}

const money = (v: unknown) => {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v.replace(/[$,]/g, '')) : NaN;
  return Number.isFinite(n) && n > 0 ? n : null;
};

/**
 * One area's response. Areas with Small Area FMRs answer with a row per ZIP;
 * the "MSA level" row is the metro figure.
 */
export function parseFmr(body: FmrResponse): FmrReading | null {
  const basic = body.data?.basicdata;
  const row = Array.isArray(basic) ? (basic.find((b) => String(b.zip_code ?? '').toLowerCase() === 'msa level') ?? basic[0]) : basic;
  if (!row) return null;
  const rents = FIELDS.map((f) => money(row[f])) as FmrReading['rents'];
  if (rents.every((r) => r == null)) return null;
  const year = body.data?.year ?? row.year;
  return { rents, period: year ? `FY ${year}` : 'Current FY' };
}

export async function fetchHudFmr(
  metros: readonly Metro[],
  token: string,
  options: FetchJsonOptions = {}
): Promise<{ readings: Map<City, FmrReading>; failed: string[] }> {
  const readings = new Map<City, FmrReading>();
  const failed: string[] = [];
  for (const metro of metros) {
    try {
      const body = await fetchJson<FmrResponse>(hudFmrUrl(metro.hudFmr), {
        timeoutMs: 30_000,
        ...options,
        headers: { authorization: `Bearer ${token}` }
      });
      const reading = parseFmr(body);
      if (reading) readings.set(metro.city, reading);
      else failed.push(`${metro.city} (no rents in response)`);
    } catch (error) {
      failed.push(`${metro.city} (${error instanceof Error ? error.message : String(error)})`);
    }
  }
  return { readings, failed };
}
