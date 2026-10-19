/**
 * County-wide account index: one row per account in the completed values read. Filtering, sorting and counts run
 * here, never on the parcels the map has loaded. The same predicate shades the map tiles, so a shared filter
 * changes both; moving the map changes neither the county-wide list nor its count. Counts are exact because rows
 * are already one per account.
 */
export interface AccountRow {
  account: string; acres: number | null; stateCode: string | null; zoningBases: string[]; zoningStatus: string;
  market: number | null; land: number | null; landPsf: number | null; valueStatus: string; cx: number; cy: number;
}
export interface Filters { minAcres?: number; maxAcres?: number; zoning?: string[]; stateCodes?: string[]; vacant?: boolean; minMarket?: number; maxMarket?: number; minPsf?: number; maxPsf?: number }
export type SortKey = 'acres' | 'market' | 'land' | 'landPsf';
export interface Bbox { west: number; south: number; east: number; north: number }

const inRange = (v: number | null, lo?: number, hi?: number) => (lo == null && hi == null) || (v != null && (lo == null || v >= lo) && (hi == null || v <= hi));

/** One predicate for the index and the tiles. A range filter on a missing value excludes the row. */
export function predicate(f: Filters): (r: Pick<AccountRow, 'acres' | 'stateCode' | 'zoningBases' | 'market' | 'landPsf'>) => boolean {
  return (r) => inRange(r.acres, f.minAcres, f.maxAcres) && inRange(r.market, f.minMarket, f.maxMarket) && inRange(r.landPsf, f.minPsf, f.maxPsf)
    && (!f.zoning?.length || r.zoningBases.some((z) => f.zoning!.includes(z)))
    && (!f.stateCodes?.length || f.stateCodes.some((c) => String(r.stateCode ?? '').toUpperCase().startsWith(c.toUpperCase())))
    && (!f.vacant || String(r.stateCode ?? '').toUpperCase().startsWith('C1'));
}

export interface Cursor { v: number; account: string }
export interface Page { rows: AccountRow[]; next: Cursor | null; count: number; unranked: number; scope: 'county' | 'map area' }

export class AccountIndex {
  private readonly sorted = new Map<string, AccountRow[]>();
  constructor(readonly rows: AccountRow[]) {
    const ids = new Set<string>();
    for (const r of rows) { if (ids.has(r.account)) throw new Error(`duplicate account ${r.account} in index`); ids.add(r.account); }
  }
  /** Rows with the key, ordered (key, account); built once per key and direction. */
  private order(key: SortKey, dir: 'asc' | 'desc') {
    const k = `${key}:${dir}`; let s = this.sorted.get(k);
    if (!s) { s = this.rows.filter((r) => r[key] != null).sort((a, b) => (dir === 'asc' ? a[key]! - b[key]! : b[key]! - a[key]!) || (a.account < b.account ? -1 : a.account > b.account ? 1 : 0)); this.sorted.set(k, s); }
    return s;
  }
  query(f: Filters, sort: { key: SortKey; dir: 'asc' | 'desc' }, { pageSize = 50, after = null as Cursor | null, bbox = null as Bbox | null } = {}): Page {
    const p = predicate(f);
    const inBox = (r: AccountRow) => !bbox || (r.cx >= bbox.west && r.cx <= bbox.east && r.cy >= bbox.south && r.cy <= bbox.north);
    const match = (r: AccountRow) => p(r) && inBox(r);
    const ranked = this.order(sort.key, sort.dir).filter(match);
    const count = this.rows.reduce((n, r) => n + (match(r) ? 1 : 0), 0);
    const beyond = (r: AccountRow) => !after || (sort.dir === 'asc' ? r[sort.key]! > after.v || (r[sort.key] === after.v && r.account > after.account) : r[sort.key]! < after.v || (r[sort.key] === after.v && r.account > after.account));
    const start = after ? ranked.findIndex(beyond) : 0;
    const rows = start < 0 ? [] : ranked.slice(start, start + pageSize);
    const last = rows[rows.length - 1];
    const next = last && start + pageSize < ranked.length ? { v: last[sort.key]!, account: last.account } : null;
    return { rows, next, count, unranked: count - ranked.length, scope: bbox ? 'map area' : 'county' };
  }
}
