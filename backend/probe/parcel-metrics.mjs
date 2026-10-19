// Phase 0 sample (not wired into the site): Raw Land metrics and zoning shares.
export const SQFT_PER_ACRE = 43_560;
const n = (v) => (v === null || v === undefined || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));

/**
 * Values come only from fields the source documents. Official appraised value is never
 * rebuilt by adding components: if the source has no appraised field it stays null.
 * account: { id, land, improvement, market, appraised, assessed, productivity,
 *            reportedSqft, reportedAcres, year, source, retrieved }
 * shapes: polygons mapped to this account [{ parcelId, geomSqft, geomKey }]
 */
export function accountMetrics(a, shapes = []) {
  const unique = [...new Map(shapes.map((s, i) => [s.geomKey ?? `i${i}`, s])).values()];
  let sqft = null, areaBasis = 'unavailable';
  const rs = n(a.reportedSqft), ra = n(a.reportedAcres);
  if (rs > 0) { sqft = rs; areaBasis = 'reported'; }
  else if (ra > 0) { sqft = ra * SQFT_PER_ACRE; areaBasis = 'reported'; }
  else {
    const g = unique.reduce((s, p) => s + (n(p.geomSqft) ?? 0), 0);
    if (g > 0) { sqft = g; areaBasis = 'estimated'; }
  }
  const land = n(a.land), appraised = n(a.appraised), market = n(a.market);
  const per = (v) => (v === null || sqft === null ? null : v / sqft);
  return {
    accountId: a.id, parcelCount: unique.length, multiParcel: unique.length > 1,
    duplicateGeometry: shapes.length - unique.length,
    landSqft: sqft, acres: sqft === null ? null : sqft / SQFT_PER_ACRE, areaBasis,
    land, improvement: n(a.improvement), market, appraised, assessed: n(a.assessed), productivity: n(a.productivity),
    landPsf: per(land),
    totalPsf: per(appraised),           // appraised only; market shown separately
    marketPsf: per(market),
    year: a.year ?? null, source: a.source ?? null, retrieved: a.retrieved ?? null
  };
}

/** Polygons for many map shapes: the account's values appear once, on the account, never per shape. */
export function sumAccounts(list) { return list.reduce((s, m) => s + (m.appraised ?? 0), 0); }

/**
 * Zoning shares against the parcel's FULL area.
 * pieces: [{ code, sqft }] = area of (parcel ∩ each zoning polygon), possibly overlapping.
 * unionSqft: area of (parcel ∩ union of zoning polygons).
 */
export function zoningShares(parcelSqft, rawPieces, unionSqft, { sliverSqft = 50, sliverShare = 0.002 } = {}) {
  // The live COSA layer holds duplicate polygons (seen 2026-10-18 at 1304 S Laredo St). A piece is
  // dropped as a duplicate only when its geometry AND every zoning attribute match one already kept:
  // the full Zoning string plus the structured Base / SpecDistrict / SpecCondition fields (attrKey,
  // see zoningAttrKey). Identical geometry with any differing attribute is kept and flagged.
  const kept = new Map(); const pieces = []; let duplicatePieces = 0; const sameGeometryConflicts = [];
  for (const p of rawPieces) {
    if (p.geomKey == null) { pieces.push(p); continue; }
    const attr = p.attrKey ?? p.code;
    const seen = kept.get(p.geomKey);
    if (!seen) { kept.set(p.geomKey, new Map([[attr, p.code]])); pieces.push(p); continue; }
    if (seen.has(attr)) { duplicatePieces++; continue; }
    seen.set(attr, p.code);
    sameGeometryConflicts.push({ geomKey: p.geomKey, codes: [...seen.values()], attributes: [...seen.keys()] }); pieces.push(p);
  }
  const districts = pieces.map((p) => ({
    code: p.code, share: p.sqft / parcelSqft, sqft: p.sqft,
    suspectedSliver: p.sqft < sliverSqft && p.sqft / parcelSqft < sliverShare
  })).sort((x, y) => y.sqft - x.sqft);
  const sum = pieces.reduce((s, p) => s + p.sqft, 0);
  const uncoveredShare = Math.max(0, 1 - unionSqft / parcelSqft);
  const overlapShare = Math.max(0, (sum - unionSqft) / parcelSqft);
  const distinctCodes = new Set(pieces.map((p) => p.code));
  let status = 'no zoning intersects parcel';
  if (pieces.length) status = distinctCodes.size > 1 ? 'split zoning' : 'single district';
  return { status, districts, uncoveredShare, overlapShare, duplicatePieces, sameGeometryConflicts,
    conflict: sameGeometryConflicts.length > 0 || (overlapShare > 0.001 && distinctCodes.size > 1) };
}

/** Attribute signature for zoning dedupe: every zoning field that carries a restriction. */
export function zoningAttrKey(a) {
  const t = (v) => String(v ?? '').trim();
  return JSON.stringify([t(a.Zoning), t(a.Base), t(a.SpecDistrict), t(a.SpecCondition)]);
}

/**
 * San Antonio zoning string -> tokens. Only tokens in the official table are labelled;
 * everything else is kept as 'unknown'. The raw string is always returned.
 * table: { token: 'base' | 'overlay' | 'special' | 'prefix' } built from the UDC in Phase 0.
 */
export function parseZoning(raw, table) {
  const tokens = String(raw ?? '').trim().split(/\s+/).filter(Boolean)
    .map((t) => ({ token: t, kind: table[t] ?? table[t.replace(/-\d+$/, '-#')] ?? 'unknown' }));
  return { raw, tokens, base: tokens.filter((t) => t.kind === 'base').map((t) => t.token), unknown: tokens.filter((t) => t.kind === 'unknown').map((t) => t.token) };
}

/** Vacancy only from Comptroller category C1 (vacant lots and tracts); C2 colonia lots are excluded because they cannot be sold. $0 improvements alone never qualifies. */
export function vacantPerRoll(stateCode, vacantCodes = ['C1']) {
  const c = String(stateCode ?? '').trim().toUpperCase();
  return vacantCodes.some((v) => c.startsWith(v));
}

/**
 * BCAD rows -> accounts. The SARA copy repeats an account once per owner (Prop_id 182698 has
 * 35 rows, each with the same Market_val), so values are taken once per account. Rows whose
 * values disagree are flagged instead of summed or picked silently. Negative ids in the CoSA
 * layer are unassigned polygons (right of way, etc.) and are not accounts.
 */
export function collapseAccounts(rows, idKey = 'Prop_id', valueKeys = ['Market_val', 'Land_hstd_val', 'Land_non_hstd_val']) {
  const by = new Map();
  for (const r of rows) {
    const id = Number(r[idKey]);
    if (!Number.isFinite(id) || id <= 0) continue;
    const a = by.get(id) ?? { id, owners: [], rows: 0, values: null, conflict: false };
    a.rows++; if (r.Owner_name && !a.owners.includes(r.Owner_name)) a.owners.push(r.Owner_name);
    const v = valueKeys.map((k) => r[k] ?? null);
    if (!a.values) a.values = v; else if (v.some((x, i) => x !== a.values[i])) a.conflict = true;
    by.set(id, a);
  }
  return [...by.values()];
}

/**
 * Join older roll values to newer geometry, account by account. Each result keeps separate facts:
 *   idMatch   the account id is in both sources
 *   area      'agrees' | 'unavailable' | 'discrepancy'  (reported acreage, within tol)
 *   geometry  'verified' | 'differs' | 'unknown'       (only from a real outline comparison)
 * Values are attached only when ids match, area agrees and the outline is not known to differ.
 * A >tol area difference is a discrepancy, not proof of a boundary change. Acreage is compared only
 * for single-polygon accounts, because per-polygon legal_acre semantics are unverified for the rest.
 * values: Map id -> { acres }   geometry: Map id -> { acres, polygons }
 * outline: optional Map id -> overlap ratio (intersection / union) of the two outlines.
 */
export function joinValues(values, geometry, { tol = 0.05, outline = null, outlineAgree = 0.95 } = {}) {
  const out = new Map();
  for (const [id, g] of geometry) {
    const v = values.get(id);
    if (!v) { out.set(id, { idMatch: false, area: 'unavailable', geometry: 'unknown', status: 'geometry without 2025 values (new, split, renumbered, or missing from the extract)', values: null }); continue; }
    const a = Number(v.acres), b = Number(g.acres);
    let area = 'unavailable';
    if ((g.polygons ?? 1) === 1 && a > 0 && b > 0) area = Math.abs(a - b) / Math.max(a, b) > tol ? 'discrepancy' : 'agrees';
    const r = outline?.get(id);
    const geom = r == null ? 'unknown' : r >= outlineAgree ? 'verified' : 'differs';
    const ok = area === 'agrees' && geom !== 'differs';
    const status = ok ? (geom === 'verified' ? 'matched; area agrees; outline verified' : 'matched; area agrees; outline not compared')
      : geom === 'differs' ? 'matched id; outline differs' : area === 'discrepancy' ? 'matched id; area discrepancy' : 'matched id; area unavailable';
    out.set(id, { idMatch: true, area, geometry: geom, status, values: ok ? v : null, priorAcres: a || null, currentAcres: b || null });
  }
  for (const id of values.keys()) if (!geometry.has(id)) out.set(id, { idMatch: false, area: 'unavailable', geometry: 'unknown', status: 'values without geometry in this layer (current status unknown)', values: values.get(id), mapped: false });
  return out;
}

/**
 * County-wide paging by keyset (sort value, then account id). fetchRows(cursor, n) must return rows
 * strictly after the cursor in (value DESC, id ASC) order; repeated rows for one account are adjacent
 * under that order. Pages hold unique accounts, and no account repeats or is skipped between pages.
 */
export async function pageAccounts(fetchRows, pageSize, valueKey, idKey = 'id') {
  // Guards: the sort value must be present (callers filter IS NOT NULL and count those separately),
  // rows must come strictly after the cursor, and an account that reappears non-adjacently (its rows
  // disagree on the sort value) is listed once and reported in pages.conflicts, never repeated.
  const pages = []; let cursor = null; const emitted = new Set(); pages.conflicts = [];
  const cmp = (r, c) => (r[valueKey] < c[0] || (r[valueKey] === c[0] && r[idKey] > c[1]));
  for (;;) {
    const page = [];
    let c = cursor;
    while (page.length < pageSize) {
      const rows = await fetchRows(c, pageSize * 2);
      if (!rows.length) break;
      for (const r of rows) {
        if (r[valueKey] == null || !Number.isFinite(Number(r[valueKey]))) throw new Error(`missing sort value for ${r[idKey]}`);
        if (c && !cmp(r, c)) throw new Error(`row ${r[idKey]} is not after the cursor`);
        if (page.length && page[page.length - 1][idKey] === r[idKey]) continue;
        if (emitted.has(r[idKey]) && !(page.length === 0 && cursor && cursor[1] === r[idKey])) { if (!pages.conflicts.includes(r[idKey])) pages.conflicts.push(r[idKey]); continue; }
        if (pages.length && page.length === 0 && cursor && cursor[1] === r[idKey]) continue;
        if (page.length >= pageSize) break;
        page.push(r); emitted.add(r[idKey]);
      }
      const last = rows[rows.length - 1]; c = [last[valueKey], last[idKey]];
      if (rows.length < pageSize * 2) break;
    }
    if (!page.length) break;
    pages.push(page);
    const last = page[page.length - 1]; cursor = [last[valueKey], last[idKey]];
    if (page.length < pageSize) break;
  }
  return pages;
}

/**
 * Bexar (SARA copy) land market value. Measured over all 705,142 accounts on 2026-10-18:
 * Market_val = land + improvements for 698,789; for all 6,351 accounts with AG_Market > 0,
 * Market_val = land + improvements + AG_Market. So ag/timber land market value sits in AG_Market,
 * not in the Land_* columns, and belongs in the land figure. AG_Use_val (productivity) never does.
 * Returns null when the components don't reproduce Market_val, rather than guessing.
 */
const LAND_FIELDS = ['Land_hstd_val', 'Land_non_hstd_val', 'AG_Market'], IMP_FIELDS = ['Imprv_hstd_val', 'Imprv_non_hstd_val'];
/** A number, or a plain numeric string. Empty strings, booleans and text are not numbers. */
const strictNum = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : typeof v === 'string' && /^\s*-?\d+(\.\d+)?\s*$/.test(v) ? Number(v) : null);
/**
 * nullAsZero lists component fields whose null is known to mean zero (decided from the official
 * layout or a full-dataset census). Any other missing or non-numeric component, or a missing
 * Market_val, makes the figure unavailable and names the fields.
 */
export function bexarLandMarket(r, { nullAsZero = [] } = {}) {
  const missing = [];
  const val = (k) => { const x = strictNum(r[k]); if (x !== null) return x; if (r[k] == null && nullAsZero.includes(k)) return 0; missing.push(k); return null; };
  const market = strictNum(r.Market_val); if (market === null) missing.push('Market_val');
  const land = LAND_FIELDS.map(val), imp = IMP_FIELDS.map(val);
  if (missing.length) return { landMarket: null, reconciles: false, missing };
  const L = land.reduce((a, b) => a + b, 0), I = imp.reduce((a, b) => a + b, 0);
  if (Math.abs(L + I - market) >= 1) return { landMarket: null, reconciles: false, missing };
  return { landMarket: L, improvementMarket: I, reconciles: true, missing };
}

/**
 * Zoning coverage for one parcel from per-polygon intersection results. pieces: [{ code, sqft,
 * geomKey, attrKey }] or [{ error }] for a polygon whose intersection failed. readStatus is the
 * status of the zoning read. Any failure makes the whole parcel 'coverage unavailable': a result
 * is never built from the pieces that happened to succeed.
 */
export function zoningCoverage(parcelSqft, readStatus, pieces, unionSqft) {
  if (readStatus !== 'complete') return { status: 'coverage unavailable', reason: `zoning read ${readStatus}` };
  const failed = pieces.filter((p) => p.error);
  if (failed.length) return { status: 'coverage unavailable', reason: `${failed.length} intersection(s) failed` };
  if (!(parcelSqft > 0) || !Number.isFinite(unionSqft)) return { status: 'coverage unavailable', reason: 'no parcel area' };
  return zoningShares(parcelSqft, pieces, unionSqft);
}

/** Overlap class keeps exactly zero apart from small positive overlap; the fraction itself is always reported. */
export function overlapClass(fraction) {
  if (fraction == null || !Number.isFinite(fraction)) return 'overlap unavailable';
  if (fraction === 0) return 'zero overlap';
  if (fraction < 0.01) return 'positive overlap below 1%';
  if (fraction < 0.5) return 'overlap 1% to 50%';
  return 'overlap 50% or more';
}
