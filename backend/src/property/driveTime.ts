import { gunzipSync } from 'node:zlib';
import { fetchBuffer, fetchJson, fetchText, type FetchJsonOptions } from '../lib/http.js';

/**
 * The people and jobs behind the drive-time rings: every Texas census tract
 * as one point (its internal point from the Census gazetteer) with its
 * population (American Community Survey 5-year, B01003) and the jobs located
 * there (LEHD LODES workplace area characteristics, all jobs). All three are
 * free Census Bureau files. The browser draws 10, 20 and 30 minute drive
 * areas from a public routing server and adds up the tracts inside each one.
 */

export interface TractFile {
  generatedAt: string;
  /** Survey and file years, for the source note. */
  acsYear: number;
  lodesYear: number;
  /** [lat, lng, population, jobs] per tract. */
  tracts: [number, number, number, number][];
}

export const gazetteerUrl = (year: number) =>
  `https://www2.census.gov/geo/docs/maps-data/data/gazetteer/${year}_Gazetteer/${year}_gaz_tracts_48.txt`;
export const acsTractUrl = (year: number, apiKey?: string) =>
  `https://api.census.gov/data/${year}/acs/acs5?get=B01003_001E&for=tract:*&in=state:48${apiKey ? `&key=${encodeURIComponent(apiKey)}` : ''}`;
export const LODES_INDEX = 'https://lehd.ces.census.gov/data/lodes/LODES8/tx/wac/';
export const lodesUrl = (year: number) => `${LODES_INDEX}tx_wac_S000_JT00_${year}.csv.gz`;

/** Tract id → [lat, lng] from the gazetteer (tab separated, GEOID … INTPTLAT INTPTLONG). */
export function parseGazetteer(text: string): Map<string, [number, number]> {
  const lines = text.split(/\r?\n/);
  const header = (lines[0] ?? '').split('\t').map((h) => h.trim().toUpperCase());
  const [id, lat, lng] = ['GEOID', 'INTPTLAT', 'INTPTLONG'].map((n) => header.indexOf(n)) as [number, number, number];
  const out = new Map<string, [number, number]>();
  if (id < 0 || lat < 0 || lng < 0) return out;
  for (const line of lines.slice(1)) {
    const cells = line.split('\t');
    const geoid = cells[id]?.trim();
    const y = Number(cells[lat]);
    const x = Number(cells[lng]);
    if (geoid && Number.isFinite(y) && Number.isFinite(x)) out.set(geoid, [round(y, 4), round(x, 4)]);
  }
  return out;
}

/** Tract id → population from the ACS table (header row, then state, county, tract codes). */
export function parseAcsTracts(table: string[][]): Map<string, number> {
  const [header, ...rows] = table;
  const out = new Map<string, number>();
  if (!header) return out;
  const [value, state, county, tract] = ['B01003_001E', 'state', 'county', 'tract'].map((n) => header.indexOf(n)) as [number, number, number, number];
  for (const row of rows) {
    const n = Number(row[value]);
    if (Number.isFinite(n) && n >= 0) out.set(`${row[state]}${row[county]}${row[tract]}`, n);
  }
  return out;
}

/** Tract id → jobs, summing the LODES blocks (15-digit ids; the first 11 are the tract). */
export function parseLodes(csv: string): Map<string, number> {
  const lines = csv.split(/\r?\n/);
  const header = (lines[0] ?? '').split(',');
  const id = header.indexOf('w_geocode');
  const jobs = header.indexOf('C000');
  const out = new Map<string, number>();
  if (id < 0 || jobs < 0) return out;
  for (const line of lines.slice(1)) {
    const cells = line.split(',');
    const block = cells[id]?.replace(/"/g, '');
    const n = Number(cells[jobs]);
    if (!block || block.length < 11 || !Number.isFinite(n)) continue;
    const tract = block.slice(0, 11);
    out.set(tract, (out.get(tract) ?? 0) + n);
  }
  return out;
}

/** The newest LODES year the index lists. */
export function latestLodesYear(indexHtml: string): number | null {
  const years = [...indexHtml.matchAll(/tx_wac_S000_JT00_(\d{4})\.csv\.gz/g)].map((m) => Number(m[1]));
  return years.length ? Math.max(...years) : null;
}

/** Tracts with a point and at least one person or job. */
export function joinTracts(points: Map<string, [number, number]>, people: Map<string, number>, jobs: Map<string, number>): TractFile['tracts'] {
  const out: TractFile['tracts'] = [];
  for (const [id, [lat, lng]] of points) {
    const pop = people.get(id) ?? 0;
    const work = jobs.get(id) ?? 0;
    if (pop || work) out.push([lat, lng, pop, work]);
  }
  return out;
}

export interface BuildTractOptions extends FetchJsonOptions {
  apiKey?: string;
  now?: Date;
  log?: (line: string) => void;
}

/** Fetch the three files, trying the newest year first and stepping back when one isn't out yet. */
export async function buildTractFile(options: BuildTractOptions = {}): Promise<TractFile> {
  const { apiKey, now = new Date(), log = () => {}, ...http } = options;
  const year = now.getUTCFullYear();
  const firstOk = async <T>(years: number[], read: (y: number) => Promise<T>): Promise<[number, T]> => {
    let last: unknown;
    for (const y of years) {
      try {
        return [y, await read(y)];
      } catch (error) {
        last = error;
      }
    }
    throw last;
  };
  const [gazYear, points] = await firstOk([year, year - 1, year - 2], async (y) => {
    const map = parseGazetteer(await fetchText(gazetteerUrl(y), { timeoutMs: 60_000, accept: 'text/plain', ...http }));
    if (!map.size) throw new Error(`gazetteer ${y} empty`);
    return map;
  });
  log(`Gazetteer ${gazYear}: ${points.size} tracts.`);
  // The 5-year survey comes out each December for the year two before.
  const [acsYear, people] = await firstOk([year - 1, year - 2, year - 3], async (y) => {
    const map = parseAcsTracts(await fetchJson<string[][]>(acsTractUrl(y, apiKey), { timeoutMs: 60_000, ...http }));
    if (!map.size) throw new Error(`ACS ${y} empty`);
    return map;
  });
  log(`ACS ${acsYear}: population for ${people.size} tracts.`);
  const lodesYear = latestLodesYear(await fetchText(LODES_INDEX, { timeoutMs: 60_000, ...http })) ?? year - 3;
  const jobs = parseLodes(gunzipSync(await fetchBuffer(lodesUrl(lodesYear), { timeoutMs: 120_000, ...http })).toString('utf8'));
  log(`LODES ${lodesYear}: jobs for ${jobs.size} tracts.`);
  const tracts = joinTracts(points, people, jobs);
  if (tracts.length < 1000) throw new Error(`only ${tracts.length} tracts joined`);
  return { generatedAt: now.toISOString(), acsYear, lodesYear, tracts };
}

const round = (v: number, digits: number) => Math.round(v * 10 ** digits) / 10 ** digits;
