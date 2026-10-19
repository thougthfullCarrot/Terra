/**
 * Synthetic Raw Land build for the UI and its checks. Every account, value and outline is invented; nothing comes
 * from BCAD, SARA or the city. It exercises each state the real build can produce.
 */
import type { AccountRow } from './accountIndex.js';
import { LABELS } from './labels.js';
import { SQFT_PER_ACRE } from './metrics.js';
import { tileKey } from './tiles.js';

export interface TileFeature extends AccountRow { cityMatch: string; zoning: unknown; outline: { type: 'Polygon'; coordinates: number[][][] }; synthetic?: true }

export function synthBuild(n = 2400): { rows: AccountRow[]; tiles: Map<string, TileFeature[]>; manifest: Record<string, unknown> } {
  let s = 7; const rnd = () => ((s = (s * 1103515245 + 12345) >>> 0) / 2 ** 32);
  const rows: AccountRow[] = []; const tiles = new Map<string, TileFeature[]>();
  const cols = 60, W = 0.0016, X0 = -98.56, Y0 = 29.40;
  const codes = ['C1', 'C1', 'C1', 'A1', 'E1', 'D1', 'F1', 'O1', 'C2'];
  const zones = ['R-6', 'C-2', 'I-1', 'MF-33', 'C-3', 'R-4', 'IDZ-1'];
  for (let i = 0; i < n; i++) {
    const cx = X0 + (i % cols) * W, cy = Y0 + Math.floor(i / cols) * W;
    const w = W * (0.55 + rnd() * 0.4), h = W * (0.55 + rnd() * 0.4);
    const acres = +(w * h * 2.66e6 * (0.9 + rnd() * 0.2)).toFixed(3); // ~acres of a w x h degree box near 29.4°N
    const code = codes[Math.floor(rnd() * codes.length)]!;
    const market = Math.round((20000 + rnd() * 900000) / 10) * 10;
    let land: number | null = Math.round(market * (0.2 + rnd() * 0.7)), valueStatus = 'ok';
    if (i % 97 === 0) { land = null; valueStatus = `${LABELS.unavailable}: components do not reproduce the market value`; }
    const zero = i % 211 === 0;
    const col = i % cols;
    // west band: unincorporated; a middle strip: a PDF-only city; one block: coverage unavailable
    let zoningStatus = 'single district', bases = [zones[Math.floor(rnd() * zones.length)]!], zoning: unknown;
    if (col < 6) { zoningStatus = LABELS.unincorporated; bases = []; zoning = null; }
    else if (col >= 40 && col < 44) { zoningStatus = 'Alamo Heights: published as PDF only'; bases = []; zoning = null; }
    else if (i % 53 === 0) { zoningStatus = LABELS.coverageUnavailable; bases = []; zoning = { status: 'coverage unavailable', reason: '1 intersection(s) failed' }; }
    else if (i % 41 === 0) { zoningStatus = 'split zoning'; bases = ['RM-4', 'IDZ-1']; zoning = { status: 'split zoning', conflict: true, districts: [{ code: 'RM-4', share: 1 }, { code: 'IDZ-1', share: 1 }], sameGeometryConflicts: [{ codes: ['RM-4', 'IDZ-1'] }], uncoveredShare: 0, overlapShare: 1 }; }
    else if (i % 7 === 0) { zoningStatus = 'split zoning'; bases = [bases[0]!, 'C-2']; zoning = { status: 'split zoning', conflict: false, districts: [{ code: bases[0], share: 0.72 }, { code: 'C-2', share: 0.28 }], sameGeometryConflicts: [], uncoveredShare: 0, overlapShare: 0 }; }
    else zoning = { status: 'single district', conflict: false, districts: [{ code: bases[0], share: 1 }], sameGeometryConflicts: [], uncoveredShare: 0, overlapShare: 0 };
    const row: AccountRow = {
      account: `SYN-${String(100000 + i)}`, acres: i % 89 === 0 ? null : acres, stateCode: code, zoningBases: bases, zoningStatus,
      market: zero ? 0 : market, land: zero ? 0 : land, landPsf: null, valueStatus, cx: cx + w / 2, cy: cy + h / 2
    };
    row.landPsf = row.land == null || row.acres == null ? null : +(row.land / (row.acres * SQFT_PER_ACRE)).toFixed(2);
    rows.push(row);
    const cityMatch = i % 4 === 0 ? LABELS.notMatched : i % 31 === 0 ? 'matched; area discrepancy' : 'matched; area agrees; outline not compared';
    const t: TileFeature = { ...row, cityMatch, zoning, synthetic: true, outline: { type: 'Polygon', coordinates: [[[cx, cy], [cx + w, cy], [cx + w, cy + h], [cx, cy + h], [cx, cy]]] } };
    const k = tileKey(row.cx, row.cy); (tiles.get(k) ?? tiles.set(k, []).get(k)!).push(t);
  }
  return { rows, tiles, manifest: { built: new Date().toISOString(), synthetic: true, sourceYear: 2025, counts: { accounts: rows.length, tiles: tiles.size } } };
}
