import type { FirmRow } from '../db/store.js';
import { SECTORS, type Sector } from '../types.js';
import type { RunReport } from '../collector/run.js';
import { tabRange, type Cell, type SheetsClient } from './google.js';

/**
 * The firm list as an editable "Firms" tab.
 *
 * The owner adds or removes companies in the sheet and the next website build
 * polls exactly that list. The seed migration stays the fallback: when the
 * sheet is not set up, cannot be reached, or holds no usable row, the build
 * runs on the seed list as it always has, so a sharing mistake or an
 * accidentally cleared tab never empties the site.
 */

export const FIRMS_TAB = 'Firms';

/**
 * Header text the tab is created with. Columns are found by header, so they can
 * be reordered. "Sector" came later and goes last, so a tab read by position
 * still finds the first six where they always were.
 */
export const FIRM_HEADERS = ['Firm', 'Board type', 'Board id', 'Workday host', 'Active', 'Last check', 'Sector', 'Real estate only'] as const;

const ATS = ['greenhouse', 'lever', 'workday', 'icims', 'workable', 'ashby', 'smartrecruiters'] as const;

export interface SheetFirm {
  /** 1-based sheet row, so a status can be written back beside it. */
  row: number;
  firm: FirmRow | null;
  /** Why a non-blank row was not used. */
  problem: string | null;
}

export interface SheetFirmList {
  firms: SheetFirm[];
  /** Column letter of "Last check", for writing results back. */
  statusColumn: string;
  /** Whether the tab has a "Sector" column. Tabs made before it existed do not. */
  hasSector: boolean;
  /** Whether the tab has a "Real estate only" column. Tabs made before it existed do not. */
  hasCreOnly: boolean;
  /** 0-based column of each header, -1 where the tab lacks it. */
  columns: Record<'name' | 'ats' | 'slug' | 'host' | 'active' | 'status' | 'sector' | 'creOnly', number>;
  /** Last non-blank row, 1-based; 1 when only the header is filled. */
  lastRow: number;
  /** False when the first row held none of the usual headers and columns were taken by position. */
  byHeader: boolean;
}

export function seedToRows(seed: FirmRow[]): Cell[][] {
  return [
    [...FIRM_HEADERS],
    ...seed.map((firm) => [firm.name, firm.ats, firm.atsSlug, firm.atsHost ?? '', firm.active ? 'yes' : 'no', '', firm.sector ?? '', firm.creOnly ? 'yes' : ''])
  ];
}

export function parseFirmTab(values: string[][]): SheetFirmList {
  const header = (values[0] ?? []).map((cell) => cell.trim().toLowerCase());
  // A tab with the usual headers is read by header, and a column it lacks is
  // treated as blank; one with none of them is read by position.
  const byHeader = FIRM_HEADERS.some((name) => header.includes(name.toLowerCase()));
  const column = (name: string, fallback: number) => {
    if (!byHeader) return fallback;
    const index = header.indexOf(name.toLowerCase());
    return index >= 0 ? index : -1;
  };
  const at = {
    name: column('Firm', 0),
    ats: column('Board type', 1),
    slug: column('Board id', 2),
    host: column('Workday host', 3),
    active: column('Active', 4),
    status: column('Last check', 5),
    sector: column('Sector', 6),
    creOnly: column('Real estate only', 7)
  };
  // Results go in "Last check", or the first column past the header when there is none.
  const statusIndex = at.status >= 0 ? at.status : Math.max(header.length, 5);

  const firms: SheetFirm[] = [];
  let lastRow = 1;
  values.slice(1).forEach((cells, index) => {
    const get = (i: number) => (i >= 0 ? (cells[i] ?? '') : '').trim();
    const row = index + 2;
    const name = get(at.name);
    const ats = get(at.ats).toLowerCase();
    const slug = get(at.slug);
    const host = get(at.host);
    if (cells.some((cell) => cell.trim())) lastRow = row;
    if (!name && !ats && !slug) return;

    const problem = !name
      ? 'Skipped: no firm name'
      : !(ATS as readonly string[]).includes(ats)
        ? `Skipped: board type must be one of ${ATS.join(', ')}`
        : !slug
          ? 'Skipped: no board id'
          : ats === 'workday' && !host
            ? 'Skipped: Workday needs a host'
            : null;

    firms.push({
      row,
      problem,
      firm: problem
        ? null
        : {
            id: row,
            name,
            ats: ats as FirmRow['ats'],
            atsSlug: slug,
            atsHost: host || null,
            // Blank means yes, so a new row only needs the first three columns.
            active: !/^(no|n|false|0|off)$/i.test(get(at.active)),
            slugVerified: false,
            sector: sectorNamed(get(at.sector)),
            creOnly: /^(yes|y|true|1|on)$/i.test(get(at.creOnly))
          }
    });
  });

  return { firms, statusColumn: letter(statusIndex), hasSector: at.sector >= 0, hasCreOnly: at.creOnly >= 0, columns: at, lastRow, byHeader };
}

/** The sector a cell names, matched loosely ('homebuilder' is Homebuilder); null for blank or unknown. */
function sectorNamed(value: string): Sector | null {
  const wanted = value.trim().toLowerCase();
  return SECTORS.find((sector) => sector.toLowerCase() === wanted) ?? null;
}

export type FirmSource = 'sheet' | 'seed';

export interface LoadedFirms {
  firms: FirmRow[];
  source: FirmSource;
  note: string;
  sheet: SheetFirmList | null;
}

/**
 * The firms this build polls: the sheet's when it has usable rows, the seed's
 * otherwise. With `write`, an empty or missing tab is filled with the seed
 * list so the owner starts from what the site already polls.
 */
export async function loadFirms(
  client: SheetsClient | null,
  seed: FirmRow[],
  options: { write: boolean }
): Promise<LoadedFirms> {
  if (!client) return { firms: seed, source: 'seed', note: 'Google Sheets not set up; using the seed list.', sheet: null };

  try {
    const created = options.write && (await client.ensureTabs([FIRMS_TAB])).length > 0;
    const values = created ? [] : await client.read(tabRange(FIRMS_TAB)).catch(() => []);
    let sheet = parseFirmTab(values);
    let upgraded = '';
    let current = values;

    if (sheet.firms.length && !sheet.hasSector && options.write && sheet.byHeader) {
      const added = await addSectorColumn(client, current, sheet, seed);
      current = added.values;
      sheet = parseFirmTab(current);
      upgraded = added.firms.length ? `; added ${added.firms.length} homebuilders (${added.firms.join(', ')})` : '';
    }
    if (sheet.firms.length && sheet.hasSector && !sheet.hasCreOnly && options.write && sheet.byHeader) {
      const added = await addCreOnlyColumn(client, current, sheet, seed);
      current = added.values;
      sheet = parseFirmTab(current);
      upgraded += added.firms.length ? `; added ${added.firms.length} lenders, title, tax and other firms (${added.firms.join(', ')})` : '';
    }
    if (!sheet.hasSector) pinSeedSectors(sheet, seed);
    if (!sheet.hasCreOnly) pinSeedCreOnly(sheet, seed);

    if (!sheet.firms.length) {
      if (options.write) {
        await client.write(tabRange(FIRMS_TAB, 'A1'), seedToRows(seed));
        return { firms: seed, source: 'seed', note: `The ${FIRMS_TAB} tab was empty; filled it with the seed list.`, sheet: null };
      }
      return { firms: seed, source: 'seed', note: `The ${FIRMS_TAB} tab is empty or missing; using the seed list.`, sheet: null };
    }

    const usable = sheet.firms.flatMap((entry) => (entry.firm ? [entry.firm] : []));
    if (!usable.length) {
      return { firms: seed, source: 'seed', note: `No usable row in the ${FIRMS_TAB} tab; using the seed list.`, sheet };
    }
    const skipped = sheet.firms.length - usable.length;
    return {
      firms: usable,
      source: 'sheet',
      note: `Read ${usable.length} firms from the ${FIRMS_TAB} tab${skipped ? ` (${skipped} rows skipped)` : ''}${upgraded}.`,
      sheet
    };
  } catch (error) {
    return {
      firms: seed,
      source: 'seed',
      note: `Could not read the Google Sheet (${error instanceof Error ? error.message : String(error)}); using the seed list.`,
      sheet: null
    };
  }
}

/**
 * Bring a tab made before sectors existed up to date, once.
 *
 * Adds the "Sector" column, fills it for the firms the seed list pins (by
 * name), and appends the seed firms that carry a sector and are not in the tab
 * yet: the homebuilders. The new column is also the marker that this has run,
 * so a builder the owner later deletes from the tab stays deleted.
 */
async function addSectorColumn(
  client: SheetsClient,
  values: string[][],
  sheet: SheetFirmList,
  seed: FirmRow[]
): Promise<{ values: string[][]; firms: string[] }> {
  const at = sheet.columns;
  const header = values[0] ?? [];
  const sectorAt = Math.max(header.length, at.status + 1);
  const bySeed = new Map(seed.map((firm) => [firm.name.trim().toLowerCase(), firm]));
  const nameAt = (row: number) => (values[row - 1]?.[at.name] ?? '').trim().toLowerCase();

  const next = values.map((row) => [...row]);
  const put = (row: number, column: number, value: string) => {
    const cells = (next[row - 1] ??= []);
    while (cells.length < column) cells.push('');
    cells[column] = value;
  };

  const column: Cell[][] = [];
  for (let row = 1; row <= sheet.lastRow; row++) {
    const value = row === 1 ? 'Sector' : (bySeed.get(nameAt(row))?.sector ?? '');
    put(row, sectorAt, value);
    column.push([value]);
  }
  const L = letter(sectorAt);
  await client.write(tabRange(FIRMS_TAB, `${L}1:${L}${sheet.lastRow}`), column);

  // Appending needs somewhere to put each field; a tab without one of these
  // columns gets the Sector column only.
  const present = new Set(Array.from({ length: sheet.lastRow - 1 }, (_, i) => nameAt(i + 2)));
  const missing = seed.filter((firm) => firm.sector && !present.has(firm.name.trim().toLowerCase()));
  if (!missing.length || [at.name, at.ats, at.slug, at.host].some((index) => index < 0)) {
    return { values: next, firms: [] };
  }

  const width = Math.max(sectorAt, ...Object.values(at)) + 1;
  const rows: Cell[][] = missing.map((firm) => {
    const cells: Cell[] = Array.from({ length: width }, () => '');
    cells[at.name] = firm.name;
    cells[at.ats] = firm.ats;
    cells[at.slug] = firm.atsSlug;
    cells[at.host] = firm.atsHost ?? '';
    if (at.active >= 0) cells[at.active] = firm.active ? 'yes' : 'no';
    cells[sectorAt] = firm.sector ?? '';
    return cells;
  });
  const first = sheet.lastRow + 1;
  await client.write(tabRange(FIRMS_TAB, `A${first}`), rows);
  rows.forEach((cells, i) => (next[first - 1 + i] = cells.map((cell) => String(cell ?? ''))));

  return { values: next, firms: missing.map((firm) => firm.name) };
}

/**
 * Bring a tab made before the "Real estate only" column up to date, once, the
 * way addSectorColumn did for sectors: add the column, mark the seed's
 * real-estate-only firms by name, and append the ones the tab lacks (the
 * banks, title companies and tax firms). The column marks this as done, so a
 * firm the owner deletes later stays deleted.
 */
async function addCreOnlyColumn(
  client: SheetsClient,
  values: string[][],
  sheet: SheetFirmList,
  seed: FirmRow[]
): Promise<{ values: string[][]; firms: string[] }> {
  const at = sheet.columns;
  const header = values[0] ?? [];
  const flagAt = Math.max(header.length, at.sector + 1, at.status + 1);
  const bySeed = new Map(seed.map((firm) => [firm.name.trim().toLowerCase(), firm]));
  const nameAt = (row: number) => (values[row - 1]?.[at.name] ?? '').trim().toLowerCase();

  const next = values.map((row) => [...row]);
  const put = (row: number, column: number, value: string) => {
    const cells = (next[row - 1] ??= []);
    while (cells.length < column) cells.push('');
    cells[column] = value;
  };

  const column: Cell[][] = [];
  for (let row = 1; row <= sheet.lastRow; row++) {
    const value = row === 1 ? 'Real estate only' : bySeed.get(nameAt(row))?.creOnly ? 'yes' : '';
    put(row, flagAt, value);
    column.push([value]);
  }
  const L = letter(flagAt);
  await client.write(tabRange(FIRMS_TAB, `${L}1:${L}${sheet.lastRow}`), column);

  const present = new Set(Array.from({ length: sheet.lastRow - 1 }, (_, i) => nameAt(i + 2)));
  const missing = seed.filter((firm) => firm.creOnly && !present.has(firm.name.trim().toLowerCase()));
  if (!missing.length || [at.name, at.ats, at.slug, at.host].some((index) => index < 0)) {
    return { values: next, firms: [] };
  }

  const width = Math.max(flagAt, ...Object.values(at)) + 1;
  const rows: Cell[][] = missing.map((firm) => {
    const cells: Cell[] = Array.from({ length: width }, () => '');
    cells[at.name] = firm.name;
    cells[at.ats] = firm.ats;
    cells[at.slug] = firm.atsSlug;
    cells[at.host] = firm.atsHost ?? '';
    if (at.active >= 0) cells[at.active] = firm.active ? 'yes' : 'no';
    if (at.sector >= 0) cells[at.sector] = firm.sector ?? '';
    cells[flagAt] = 'yes';
    return cells;
  });
  const first = sheet.lastRow + 1;
  await client.write(tabRange(FIRMS_TAB, `A${first}`), rows);
  rows.forEach((cells, i) => (next[first - 1 + i] = cells.map((cell) => String(cell ?? ''))));

  return { values: next, firms: missing.map((firm) => firm.name) };
}

/** A tab without the "Real estate only" column still applies the seed's rule, matched by firm name. */
function pinSeedCreOnly(sheet: SheetFirmList, seed: FirmRow[]): void {
  const bySeed = new Map(seed.map((firm) => [firm.name.trim().toLowerCase(), firm.creOnly === true]));
  for (const entry of sheet.firms) {
    if (entry.firm && !entry.firm.creOnly) entry.firm.creOnly = bySeed.get(entry.firm.name.trim().toLowerCase()) ?? false;
  }
}

/**
 * A tab without a Sector column (a read-only build, before the upgrade above
 * has run) still pins the seed's sectors, matched by firm name.
 */
function pinSeedSectors(sheet: SheetFirmList, seed: FirmRow[]): void {
  const bySeed = new Map(seed.map((firm) => [firm.name.trim().toLowerCase(), firm.sector ?? null]));
  for (const entry of sheet.firms) {
    if (entry.firm && !entry.firm.sector) entry.firm.sector = bySeed.get(entry.firm.name.trim().toLowerCase()) ?? null;
  }
}

/** One "Last check" cell per sheet row, from this pass's report and postings. */
export function firmStatuses(
  sheet: SheetFirmList,
  report: Pick<RunReport, 'errors' | 'ranAt'>,
  jobsByFirm: Map<string, number>
): { range: string; rows: Cell[][] } | null {
  if (!sheet.firms.length) return null;
  const when = report.ranAt.toISOString().slice(0, 16).replace('T', ' ') + ' UTC';
  const errors = new Map(report.errors.map((error) => [error.firm, error.message]));

  const first = sheet.firms[0]!.row;
  const last = sheet.firms[sheet.firms.length - 1]!.row;
  const rows: Cell[][] = Array.from({ length: last - first + 1 }, () => ['']);
  for (const entry of sheet.firms) {
    const status = entry.problem
      ? entry.problem
      : !entry.firm!.active
        ? 'Not polled (Active is no)'
        : errors.has(entry.firm!.name)
          ? `Failed ${when}: ${errors.get(entry.firm!.name)}`.slice(0, 300)
          : `OK ${when}: ${jobsByFirm.get(entry.firm!.name) ?? 0} matching jobs`;
    rows[entry.row - first] = [status];
  }
  return { range: tabRange(FIRMS_TAB, `${sheet.statusColumn}${first}:${sheet.statusColumn}${last}`), rows };
}

function letter(index: number): string {
  let n = index + 1;
  let out = '';
  while (n > 0) {
    const rem = (n - 1) % 26;
    out = String.fromCharCode(65 + rem) + out;
    n = Math.floor((n - 1) / 26);
  }
  return out;
}
