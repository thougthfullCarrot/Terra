/** Raw Land metrics. Ported from the Phase 0 sample (backend/probe/parcel-metrics.mjs, 50 tests). */
export const SQFT_PER_ACRE = 43_560;

/** A number, or a plain numeric string. Empty strings, booleans and text are not numbers. */
export const strictNum = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v) ? v : typeof v === 'string' && /^\s*-?\d+(\.\d+)?\s*$/.test(v) ? Number(v) : null;

export interface ZoningPiece { code: string; sqft: number; geomKey?: string; attrKey?: string }
export interface ZoningFailure { error: string }
export interface District { code: string; share: number; sqft: number; suspectedSliver: boolean }
export interface ZoningShares {
  status: 'single district' | 'split zoning' | 'no zoning intersects parcel';
  districts: District[]; uncoveredShare: number; overlapShare: number; duplicatePieces: number;
  sameGeometryConflicts: { geomKey: string; codes: string[]; attributes: string[] }[]; conflict: boolean;
}

/** Attribute signature for zoning dedupe: every zoning field that carries a restriction. */
export function zoningAttrKey(a: Record<string, unknown>): string {
  const t = (v: unknown) => String(v ?? '').trim();
  return JSON.stringify([t(a.Zoning), t(a.Base), t(a.SpecDistrict), t(a.SpecCondition)]);
}

/**
 * Zoning shares against the parcel's FULL area. A piece is dropped as a duplicate only when its geometry AND every
 * zoning attribute match one already kept; identical geometry with any differing attribute is kept and flagged.
 */
export function zoningShares(parcelSqft: number, rawPieces: ZoningPiece[], unionSqft: number, { sliverSqft = 50, sliverShare = 0.002 } = {}): ZoningShares {
  const kept = new Map<string, Map<string, string>>(); const pieces: ZoningPiece[] = []; let duplicatePieces = 0;
  const sameGeometryConflicts: ZoningShares['sameGeometryConflicts'] = [];
  for (const p of rawPieces) {
    if (p.geomKey == null) { pieces.push(p); continue; }
    const attr = p.attrKey ?? p.code; const seen = kept.get(p.geomKey);
    if (!seen) { kept.set(p.geomKey, new Map([[attr, p.code]])); pieces.push(p); continue; }
    if (seen.has(attr)) { duplicatePieces++; continue; }
    seen.set(attr, p.code);
    sameGeometryConflicts.push({ geomKey: p.geomKey, codes: [...seen.values()], attributes: [...seen.keys()] }); pieces.push(p);
  }
  const districts = pieces.map((p) => ({ code: p.code, share: p.sqft / parcelSqft, sqft: p.sqft, suspectedSliver: p.sqft < sliverSqft && p.sqft / parcelSqft < sliverShare })).sort((x, y) => y.sqft - x.sqft);
  const sum = pieces.reduce((s, p) => s + p.sqft, 0);
  const uncoveredShare = Math.max(0, 1 - unionSqft / parcelSqft);
  const overlapShare = Math.max(0, (sum - unionSqft) / parcelSqft);
  const distinct = new Set(pieces.map((p) => p.code));
  const status = !pieces.length ? 'no zoning intersects parcel' : distinct.size > 1 ? 'split zoning' : 'single district';
  return { status, districts, uncoveredShare, overlapShare, duplicatePieces, sameGeometryConflicts, conflict: sameGeometryConflicts.length > 0 || (overlapShare > 0.001 && distinct.size > 1) };
}

export type Coverage = ZoningShares | { status: 'coverage unavailable'; reason: string };
/** Any failed read, intersection or union makes the whole parcel unavailable; never a result from the pieces that worked. */
export function zoningCoverage(parcelSqft: number, readStatus: string, pieces: (ZoningPiece | ZoningFailure)[], unionSqft: number): Coverage {
  if (readStatus !== 'complete') return { status: 'coverage unavailable', reason: `zoning read ${readStatus}` };
  const failed = pieces.filter((p): p is ZoningFailure => 'error' in p);
  if (failed.length) return { status: 'coverage unavailable', reason: `${failed.length} intersection(s) failed` };
  if (!(parcelSqft > 0) || !Number.isFinite(unionSqft)) return { status: 'coverage unavailable', reason: 'no parcel area' };
  return zoningShares(parcelSqft, pieces as ZoningPiece[], unionSqft);
}

export function overlapClass(f: number | null | undefined): string {
  if (f == null || !Number.isFinite(f)) return 'overlap unavailable';
  if (f === 0) return 'zero overlap';
  if (f < 0.01) return 'positive overlap below 1%';
  if (f < 0.5) return 'overlap 1% to 50%';
  return 'overlap 50% or more';
}

/** Vacancy only from Comptroller category C1. $0 improvements alone never qualifies; C2 colonia lots are excluded. */
export function vacantPerRoll(stateCode: string | null | undefined): boolean {
  return String(stateCode ?? '').trim().toUpperCase().startsWith('C1');
}

/** Zoning string -> tokens; only tokens in the official table are labelled, the rest kept as 'unknown'. */
export function parseZoning(raw: string | null, table: Record<string, string>) {
  const tokens = String(raw ?? '').trim().split(/\s+/).filter(Boolean).map((t) => ({ token: t, kind: table[t] ?? table[t.replace(/-\d+$/, '-#')] ?? 'unknown' }));
  return { raw, tokens, base: tokens.filter((t) => t.kind === 'base').map((t) => t.token), unknown: tokens.filter((t) => t.kind === 'unknown').map((t) => t.token) };
}

export interface LandValue { landMarket: number | null; improvementMarket?: number; reconciles: boolean; missing: string[] }
/**
 * Bexar land market value = Land_hstd + Land_non_hstd + AG_Market (measured on all 2025 accounts; BCAD layout not
 * yet confirmed, so shown with LABELS.provisional). Missing or non-numeric parts, or parts that don't reproduce
 * Market_val within $1, make it unavailable. Values are never confirmed against BCAD's own pages (2 accounts differ
 * as of 2026-10-18, PR #84 verify).
 */
export function bexarLandMarket(r: Record<string, unknown>, { nullAsZero = [] as string[] } = {}): LandValue {
  const missing: string[] = [];
  const val = (k: string) => { const x = strictNum(r[k]); if (x !== null) return x; if (r[k] == null && nullAsZero.includes(k)) return 0; missing.push(k); return 0; };
  const market = strictNum(r.Market_val); if (market === null) missing.push('Market_val');
  const land = ['Land_hstd_val', 'Land_non_hstd_val', 'AG_Market'].reduce((s, k) => s + val(k), 0);
  const imp = ['Imprv_hstd_val', 'Imprv_non_hstd_val'].reduce((s, k) => s + val(k), 0);
  if (missing.length || market === null || Math.abs(land + imp - market) >= 1) return { landMarket: null, reconciles: false, missing };
  return { landMarket: land, improvementMarket: imp, reconciles: true, missing };
}

/** Land market value per land sq ft from reported acres. Unavailable without a positive area or a land value. */
export function landPsf(landMarket: number | null, acres: unknown): number | null {
  const a = strictNum(acres);
  return landMarket == null || a == null || a <= 0 ? null : landMarket / (a * SQFT_PER_ACRE);
}

export type MatchStatus = 'matched; area agrees; outline not compared' | 'matched; area discrepancy' | 'matched; area unavailable' | 'account not matched in the city parcel layer; current status unknown';
/**
 * Account matching against the city parcel layer, by account id. A detail fact only: it never adds or removes an
 * account, and never carries a spatial-overlap claim (those were sampled).
 */
export function cityMatch(acres: unknown, city: { acres: unknown; polygons: number } | undefined, tol = 0.05): MatchStatus {
  if (!city) return 'account not matched in the city parcel layer; current status unknown';
  const a = strictNum(acres), b = strictNum(city.acres);
  if (city.polygons !== 1 || !(a && a > 0) || !(b && b > 0)) return 'matched; area unavailable';
  return Math.abs(a - b) / Math.max(a, b) > tol ? 'matched; area discrepancy' : 'matched; area agrees; outline not compared';
}
