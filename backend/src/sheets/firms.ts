import type { FirmRow } from '../db/store.js';
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

/** Header text the tab is created with. Columns are found by header, so they can be reordered. */
export const FIRM_HEADERS = ['Firm', 'Board type', 'Board id', 'Workday host', 'Active', 'Last check'] as const;

const ATS = ['greenhouse', 'lever', 'workday', 'icims'] as const;

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
}

export function seedToRows(seed: FirmRow[]): Cell[][] {
  return [
    [...FIRM_HEADERS],
    ...seed.map((firm) => [firm.name, firm.ats, firm.atsSlug, firm.atsHost ?? '', firm.active ? 'yes' : 'no', ''])
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
    status: column('Last check', 5)
  };
  // Results go in "Last check", or the first column past the header when there is none.
  const statusIndex = at.status >= 0 ? at.status : Math.max(header.length, FIRM_HEADERS.length - 1);

  const firms: SheetFirm[] = [];
  values.slice(1).forEach((cells, index) => {
    const get = (i: number) => (i >= 0 ? (cells[i] ?? '') : '').trim();
    const row = index + 2;
    const name = get(at.name);
    const ats = get(at.ats).toLowerCase();
    const slug = get(at.slug);
    const host = get(at.host);
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
            slugVerified: false
          }
    });
  });

  return { firms, statusColumn: letter(statusIndex) };
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
    const sheet = parseFirmTab(values);

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
      note: `Read ${usable.length} firms from the ${FIRMS_TAB} tab${skipped ? ` (${skipped} rows skipped)` : ''}.`,
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
