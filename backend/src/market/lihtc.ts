import { fetchBuffer, type FetchJsonOptions } from '../lib/http.js';
import { unzip } from '../lib/xlsx.js';
import { csvLines, csvNumber, parseCsvLine } from './csv.js';
import type { Metro } from './metros.js';

/**
 * HUD's Low-Income Housing Tax Credit database: every LIHTC property placed
 * in service, a free bulk zip (LIHTCPUB.ZIP) with a CSV inside. Counted per
 * metro by county, from each property's 2010 census tract.
 */

export const LIHTC_URL = 'https://lihtc.huduser.gov/LIHTCPUB.ZIP';

export interface LihtcCount {
  projects: number;
  /** Low-income units (all units where the file leaves that blank). */
  units: number;
  /** Projects placed in service in the last five years with a known year. */
  recentProjects: number;
}

export function parseLihtc(text: string, metros: readonly Metro[], now: Date = new Date()): Map<string, LihtcCount> {
  const [rawHead, ...rows] = csvLines(text).map(parseCsvLine);
  const out = new Map<string, LihtcCount>();
  if (!rawHead) return out;
  const head = rawHead.map((h) => h.trim().toLowerCase());
  const at = (name: string) => head.indexOf(name);
  const recent = now.getUTCFullYear() - 5;
  for (const row of rows) {
    const tract = (row[at('fips2010')] ?? '').trim();
    let state = tract.slice(0, 2);
    let county = tract.slice(2, 5);
    if (tract.length !== 11) {
      state = (row[at('st2010')] ?? row[at('proj_st')] ?? '').trim();
      county = (row[at('cnty2010')] ?? '').trim().slice(-3);
    }
    if (state !== '48' && state !== 'TX') continue;
    const metro = metros.find((m) => m.counties.includes(county));
    if (!metro) continue;
    const count = out.get(metro.area) ?? { projects: 0, units: 0, recentProjects: 0 };
    count.projects++;
    count.units += csvNumber(row[at('li_units')]) ?? csvNumber(row[at('n_units')]) ?? 0;
    const year = csvNumber(row[at('yr_pis')]);
    if (year != null && year >= recent && year < 8888) count.recentProjects++;
    out.set(metro.area, count);
  }
  return out;
}

export async function fetchLihtc(metros: readonly Metro[], options: FetchJsonOptions & { now?: Date } = {}): Promise<Map<string, LihtcCount>> {
  const zip = await fetchBuffer(LIHTC_URL, { timeoutMs: 180_000, ...options });
  const files = [...unzip(zip)];
  const entry = files.find(([name]) => /lihtcpub\.csv$/i.test(name)) ?? files.find(([name]) => /\.csv$/i.test(name));
  if (!entry) throw new Error('No CSV in the LIHTC zip');
  return parseLihtc(entry[1].toString('latin1'), metros, options.now);
}
