import { fetchBuffer, fetchText, type FetchJsonOptions } from '../lib/http.js';
import { streamFirstSheet } from '../lib/xlsx.js';
import type { City } from '../types.js';

/**
 * Salary reality check: what commercial real estate employers in Terra's
 * Texas markets actually offer, by job title and city, from the Labor
 * Department's Labor Condition Application (LCA) disclosure files.
 *
 * Every employer hiring on an H-1B (or E-3, H-1B1) visa files an LCA naming
 * the job title, worksite and the wage it will pay, and the department
 * publishes every certified filing. It is free, needs no key, and is the only
 * public record of real offers at named firms. Two caveats the page states:
 * it covers visa hires only, and the wage is the offer at filing (at least
 * the prevailing wage), not a W-2.
 *
 * The files are cumulative within a federal fiscal year (October-September)
 * and about 250 MB by the fourth quarter, so this runs from its own weekly
 * workflow (salaries.yml), keeps a few hundred KB of summaries, and the
 * market data build folds them in. www.dol.gov turns away browser-like user
 * agents from GitHub's runners but answers the collector's own, honest one.
 */

export const DISCLOSURE_PAGE = 'https://www.dol.gov/agencies/eta/foreign-labor/performance';

/** Texas counties in each market's metro area (OMB 2023; metros.ts lists their FIPS codes). */
const COUNTY_MARKET: Record<string, City> = {
  COLLIN: 'Dallas', DALLAS: 'Dallas', DENTON: 'Dallas', ELLIS: 'Dallas', HUNT: 'Dallas', KAUFMAN: 'Dallas', ROCKWALL: 'Dallas',
  JOHNSON: 'Fort Worth', PARKER: 'Fort Worth', TARRANT: 'Fort Worth', WISE: 'Fort Worth',
  AUSTIN: 'Houston', BRAZORIA: 'Houston', CHAMBERS: 'Houston', 'FORT BEND': 'Houston', GALVESTON: 'Houston', HARRIS: 'Houston',
  LIBERTY: 'Houston', MONTGOMERY: 'Houston', 'SAN JACINTO': 'Houston', WALLER: 'Houston',
  BASTROP: 'Austin', CALDWELL: 'Austin', HAYS: 'Austin', TRAVIS: 'Austin', WILLIAMSON: 'Austin',
  ATASCOSA: 'San Antonio', BANDERA: 'San Antonio', BEXAR: 'San Antonio', COMAL: 'San Antonio', GUADALUPE: 'San Antonio',
  KENDALL: 'San Antonio', MEDINA: 'San Antonio', WILSON: 'San Antonio',
  'EL PASO': 'El Paso', HUDSPETH: 'El Paso',
  BRAZOS: 'College Station', BURLESON: 'College Station', ROBERTSON: 'College Station',
  CROSBY: 'Lubbock', LUBBOCK: 'Lubbock', LYNN: 'Lubbock',
  MARTIN: 'Midland', MIDLAND: 'Midland'
};

/** Cities that are their own market inside a bigger metro. */
const CITY_MARKET: Record<string, City> = { 'NEW BRAUNFELS': 'New Braunfels', GALVESTON: 'Galveston' };

/** The market a worksite is in, by its city first, then its county. */
export function marketFor(city: string, county: string, state: string): City | null {
  if (String(state).trim().toUpperCase() !== 'TX') return null;
  const place = String(city).trim().toUpperCase();
  if (CITY_MARKET[place]) return CITY_MARKET[place];
  const name = String(county).trim().toUpperCase().replace(/\s+COUNTY$/, '');
  return COUNTY_MARKET[name] ?? null;
}

/**
 * Industries that are commercial real estate (2022 NAICS): real estate (531),
 * REITs and other financial vehicles (5259), building construction (236),
 * land subdivision (237210) and architecture (541310).
 */
export function isCreIndustry(naics: string): boolean {
  const code = String(naics).trim();
  return /^(531|5259|236|237210|541310)/.test(code);
}

/** Titles that are real estate work wherever the employer sits (a bank's real estate analyst). */
const CRE_TITLE =
  /\breal estate\b|\bacquisitions?\b|\basset manage|\bproperty manag|\bleasing\b|\bapprais|\bunderwrit\w* (analyst|associate)|\b(development|construction) (analyst|associate|manager|project manager|coordinator)\b|\bcapital markets\b/i;

export function isCreTitle(title: string): boolean {
  return CRE_TITLE.test(title);
}

/** A wage in its pay unit, as a yearly figure. */
export function annualWage(value: string | number, unit: string): number | null {
  const amount = typeof value === 'number' ? value : Number(String(value).replace(/[$,\s]/g, ''));
  if (!Number.isFinite(amount) || amount <= 0) return null;
  const per: Record<string, number> = { year: 1, month: 12, 'bi-weekly': 26, week: 52, hour: 2080 };
  const factor = per[String(unit).trim().toLowerCase()];
  if (!factor) return null;
  const yearly = Math.round(amount * factor);
  // Filings with a typo'd unit (an hourly figure marked yearly) fall outside any real salary.
  return yearly >= 20_000 && yearly <= 2_000_000 ? yearly : null;
}

/** Title families a student scans for, in career order. */
export const FAMILIES = ['Analyst', 'Associate', 'Project / construction', 'Manager', 'Director', 'Vice president', 'Other'] as const;
export type Family = (typeof FAMILIES)[number];

export function titleFamily(title: string): Family {
  const t = title.toLowerCase();
  if (/\b(vice president|vp|svp|evp|managing director|principal|partner)\b/.test(t)) return 'Vice president';
  if (/\bdirector\b/.test(t)) return 'Director';
  if (/\b(project manager|construction|superintendent|estimator|engineer|preconstruction|scheduler)\b/.test(t)) return 'Project / construction';
  if (/\bmanager\b|\bhead\b/.test(t)) return 'Manager';
  if (/\bassociate\b/.test(t)) return 'Associate';
  if (/\banalyst\b|\bspecialist\b|\bcoordinator\b/.test(t)) return 'Analyst';
  return 'Other';
}

/** One certified filing kept from the files. */
export interface WageFiling {
  /** The department's case number, to drop a case that appears in two files. */
  caseNumber: string;
  employer: string;
  title: string;
  market: City;
  /** The worksite city as filed ("Plano"). */
  place: string;
  wage: number;
  /** The prevailing-wage level the job was filed at: I is entry level, IV fully experienced. */
  level: 'I' | 'II' | 'III' | 'IV' | null;
  /** YYYY-MM-DD the department certified it. */
  decided: string;
}

/** Column names in the record layout (FY2020 onward). */
const COLUMNS = [
  'CASE_NUMBER',
  'CASE_STATUS',
  'DECISION_DATE',
  'JOB_TITLE',
  'EMPLOYER_NAME',
  'NAICS_CODE',
  'WORKSITE_CITY',
  'WORKSITE_COUNTY',
  'WORKSITE_STATE',
  'WAGE_RATE_OF_PAY_FROM',
  'WAGE_UNIT_OF_PAY',
  'PW_WAGE_LEVEL'
] as const;

function title(value: string): string {
  return value
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/(^|[\s(/&-])([a-z])/g, (_, lead: string, char: string) => lead + char.toUpperCase())
    .replace(/\b(Llc|Lp|Llp|Inc|Ltd|Reit|Usa|Us|Vp|Svp|Evp|Ii|Iii|Iv)\b/g, (word) => word.toUpperCase())
    .replace(/\bCbre\b/g, 'CBRE')
    .replace(/\bJll\b/g, 'JLL');
}

/** Excel stores dates as day counts; the files also carry text dates in some years. */
export function isoDate(value: string): string | null {
  const text = String(value).trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(text)) return text.slice(0, 10);
  const serial = Number(text);
  if (Number.isFinite(serial) && serial > 30_000 && serial < 80_000) return new Date(Date.UTC(1899, 11, 30) + serial * 86_400_000).toISOString().slice(0, 10);
  const us = /^(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(text);
  if (us) return `${us[3]}-${us[1]!.padStart(2, '0')}-${us[2]!.padStart(2, '0')}`;
  return null;
}

/**
 * The commercial real estate filings in one workbook's rows: certified,
 * worksite in a Terra market, and either a CRE industry, a CRE job title, or
 * an employer the job feed follows (isFirm).
 */
export async function readFilings(
  rows: AsyncIterable<string[]> | Iterable<string[]>,
  { isFirm = () => false, since = '' }: { isFirm?: (employer: string) => boolean; since?: string } = {}
): Promise<{ filings: WageFiling[]; read: number }> {
  type Index = Record<(typeof COLUMNS)[number], number>;
  let index: Index | null = null;
  const filings: WageFiling[] = [];
  let read = 0;
  for await (const cells of rows) {
    if (!index) {
      const header = cells.map((c) => c.trim().toUpperCase());
      if (!header.includes('EMPLOYER_NAME')) continue;
      index = Object.fromEntries(COLUMNS.map((name) => [name, header.indexOf(name)])) as Index;
      const missing = COLUMNS.filter((name) => index![name] < 0 && name !== 'PW_WAGE_LEVEL' && name !== 'NAICS_CODE' && name !== 'CASE_NUMBER');
      if (missing.length) throw new Error(`LCA file is missing columns: ${missing.join(', ')}`);
      continue;
    }
    read++;
    const get = (name: (typeof COLUMNS)[number]) => (index![name] >= 0 ? (cells[index![name]] ?? '') : '');
    if (get('WORKSITE_STATE').trim().toUpperCase() !== 'TX') continue;
    if (!/^certified/i.test(get('CASE_STATUS').trim())) continue;
    const market = marketFor(get('WORKSITE_CITY'), get('WORKSITE_COUNTY'), 'TX');
    if (!market) continue;
    const employer = get('EMPLOYER_NAME').trim();
    const job = get('JOB_TITLE').trim();
    if (!employer || !job) continue;
    if (!isCreIndustry(get('NAICS_CODE')) && !isCreTitle(job) && !isFirm(employer)) continue;
    const wage = annualWage(get('WAGE_RATE_OF_PAY_FROM'), get('WAGE_UNIT_OF_PAY'));
    if (!wage) continue;
    const decided = isoDate(get('DECISION_DATE')) ?? '';
    if (since && decided && decided < since) continue;
    const level = /^(I|II|III|IV)$/i.exec(get('PW_WAGE_LEVEL').trim())?.[1]?.toUpperCase() as WageFiling['level'] | undefined;
    filings.push({ caseNumber: get('CASE_NUMBER').trim(), employer: title(employer), title: title(job), market, place: title(get('WORKSITE_CITY')), wage, level: level ?? null, decided });
  }
  return { filings, read };
}

/* ------------------------------------------------------------ Summaries */

export interface SalaryRow {
  employer: string;
  title: string;
  family: Family;
  filings: number;
  median: number;
  low: number;
  high: number;
  /** Most common prevailing-wage level among the filings. */
  level: WageFiling['level'];
  /** Latest certification date, YYYY-MM-DD. */
  latest: string;
}

export interface FamilyRow {
  family: Family;
  filings: number;
  median: number;
  /** Median of the filings at wage level I or II: what entry-level hires were offered. */
  entryMedian: number | null;
  entryFilings: number;
}

export interface MarketSalaries {
  city: City;
  filings: number;
  employers: number;
  families: FamilyRow[];
  rows: SalaryRow[];
}

export interface SalaryFile {
  generatedAt: string;
  /** "Oct 2025 – Jun 2026": the certification dates covered. */
  period: string;
  /** The department's files read, newest first. */
  files: string[];
  source: string;
  markets: MarketSalaries[];
}

export function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid]! : Math.round((sorted[mid - 1]! + sorted[mid]!) / 2);
}

function mode<T>(values: T[]): T | null {
  const counts = new Map<T, number>();
  for (const v of values) if (v != null) counts.set(v, (counts.get(v) ?? 0) + 1);
  return [...counts].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
}

/** How many employer-and-title rows each market keeps, most filings first. */
export const ROWS_PER_MARKET = 250;

/** Per market: pay by title family, and by employer and title. */
export function summarize(filings: WageFiling[]): MarketSalaries[] {
  const byMarket = new Map<City, WageFiling[]>();
  for (const f of filings) {
    const list = byMarket.get(f.market) ?? [];
    list.push(f);
    byMarket.set(f.market, list);
  }
  const out: MarketSalaries[] = [];
  for (const [city, list] of byMarket) {
    const groups = new Map<string, WageFiling[]>();
    for (const f of list) {
      const key = `${f.employer.toLowerCase()}|${f.title.toLowerCase()}`;
      const group = groups.get(key) ?? [];
      group.push(f);
      groups.set(key, group);
    }
    const rows: SalaryRow[] = [...groups.values()]
      .map((g) => {
        const wages = g.map((f) => f.wage);
        return {
          employer: g[0]!.employer,
          title: g[0]!.title,
          family: titleFamily(g[0]!.title),
          filings: g.length,
          median: median(wages),
          low: Math.min(...wages),
          high: Math.max(...wages),
          level: mode(g.map((f) => f.level)),
          latest: g.map((f) => f.decided).sort().at(-1) ?? ''
        };
      })
      .sort((a, b) => b.filings - a.filings || b.latest.localeCompare(a.latest) || a.employer.localeCompare(b.employer))
      .slice(0, ROWS_PER_MARKET);
    const families: FamilyRow[] = FAMILIES.map((family) => {
      const inFamily = list.filter((f) => titleFamily(f.title) === family);
      const entry = inFamily.filter((f) => f.level === 'I' || f.level === 'II').map((f) => f.wage);
      return {
        family,
        filings: inFamily.length,
        median: inFamily.length ? median(inFamily.map((f) => f.wage)) : 0,
        entryMedian: entry.length ? median(entry) : null,
        entryFilings: entry.length
      };
    }).filter((row) => row.filings);
    out.push({ city, filings: list.length, employers: new Set(list.map((f) => f.employer.toLowerCase())).size, families, rows });
  }
  return out.sort((a, b) => b.filings - a.filings);
}

/* ------------------------------------------------------------ Download */

export interface DisclosureFile {
  year: number;
  quarter: number;
  url: string;
}

/** The disclosure workbooks linked from the department's page (they move between folders, so read the links). */
export function disclosureFiles(html: string, base = DISCLOSURE_PAGE): DisclosureFile[] {
  const out = new Map<string, DisclosureFile>();
  for (const match of html.matchAll(/href="([^"]*LCA_Disclosure_Data_FY(\d{4})_Q(\d)\.xlsx)"/gi)) {
    const year = Number(match[2]);
    const quarter = Number(match[3]);
    out.set(`${year}-${quarter}`, { year, quarter, url: new URL(match[1]!, base).href });
  }
  return [...out.values()].sort((a, b) => b.year - a.year || b.quarter - a.quarter);
}

/** How many of the newest workbooks to read; a case filed in one quarter can reappear in the next, so cases are matched by number. */
export const FILES_TO_READ = 4;
/** Filings older than this are dropped: pay moves, and two years is enough for every market to have some. */
export const WINDOW_DAYS = 730;

export function filesToRead(files: DisclosureFile[]): DisclosureFile[] {
  return files.slice(0, FILES_TO_READ);
}

/** One filing per case number, the latest decision winning; filings without a number are kept as they are. */
export function dedupe(filings: WageFiling[]): WageFiling[] {
  const byCase = new Map<string, WageFiling>();
  const loose: WageFiling[] = [];
  for (const f of filings) {
    if (!f.caseNumber) {
      loose.push(f);
      continue;
    }
    const seen = byCase.get(f.caseNumber);
    if (!seen || f.decided > seen.decided) byCase.set(f.caseNumber, f);
  }
  return [...byCase.values(), ...loose];
}

export interface FetchSalariesOptions extends FetchJsonOptions {
  now?: Date;
  isFirm?: (employer: string) => boolean;
  log?: (line: string) => void;
}

export async function fetchSalaries(options: FetchSalariesOptions = {}): Promise<SalaryFile> {
  const { now = new Date(), isFirm, log = () => {} } = options;
  const http = { timeoutMs: 300_000, retries: 2, ...options };
  const page = await fetchText(DISCLOSURE_PAGE, http);
  const files = filesToRead(disclosureFiles(page));
  if (!files.length) throw new Error('No LCA disclosure files linked from the performance page');
  const since = new Date(now.getTime() - WINDOW_DAYS * 86_400_000).toISOString().slice(0, 10);
  const filings: WageFiling[] = [];
  const names: string[] = [];
  for (const file of files) {
    const data = await fetchBuffer(file.url, http);
    const result = await readFilings(streamFirstSheet(data), { isFirm, since });
    log(`FY${file.year} Q${file.quarter}: ${(data.length / 1e6).toFixed(0)} MB, ${result.read} filings read, ${result.filings.length} Texas CRE kept`);
    filings.push(...result.filings);
    names.push(`FY${file.year} Q${file.quarter}`);
  }
  const unique = dedupe(filings);
  const dates = unique.map((f) => f.decided).filter(Boolean).sort();
  const month = (iso?: string) => (iso ? new Date(`${iso}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' }) : '');
  return {
    generatedAt: now.toISOString(),
    period: dates.length ? `${month(dates[0])} – ${month(dates.at(-1))}` : '',
    files: names,
    source: DISCLOSURE_PAGE,
    markets: summarize(unique)
  };
}
