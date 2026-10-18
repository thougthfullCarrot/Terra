import type { District, FieldMap } from './districts.js';
import type { AppraisalRecord } from './types.js';

const SQFT_PER_ACRE = 43_560;

/** A case-insensitive reader over one source row. */
export function reader(row: Record<string, unknown>): (names: string[] | undefined) => unknown {
  const lower = new Map(Object.keys(row).map((k) => [k.toLowerCase(), k]));
  return (names) => {
    for (const name of names ?? []) {
      // 'A+B' sums two fields (homestead and non-homestead land, say); missing parts count as 0.
      if (name.includes('+')) {
        const parts = name.split('+').map((n) => lower.get(n.toLowerCase())).filter((k): k is string => k != null);
        if (!parts.length) continue;
        const values = parts.map((k) => Number(String(row[k] ?? '').replace(/[$,\s]/g, ''))).filter(Number.isFinite);
        if (values.length) return values.reduce((a, b) => a + b, 0);
        continue;
      }
      const key = lower.get(name.toLowerCase());
      if (key == null) continue;
      const v = row[key];
      if (v != null && String(v).trim() !== '' && String(v).trim().toLowerCase() !== 'null') return v;
    }
    return null;
  };
}

/** Which candidate field each normalized field resolved to, for the per-district report. */
export function resolvedFields(fields: FieldMap, available: string[]): Record<string, string | null> {
  const lower = new Map(available.map((k) => [k.toLowerCase(), k]));
  return Object.fromEntries(
    Object.entries(fields).map(([key, names]) => [
      key,
      (names as string[]).map((n) => (n.includes('+') ? (n.split('+').every((x) => lower.has(x.toLowerCase())) ? n : undefined) : lower.get(n.toLowerCase()))).find(Boolean) ?? null
    ])
  );
}

export function text(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v).replace(/\s+/g, ' ').trim();
  return s ? s : null;
}

export function number(v: unknown): number | null {
  if (v == null || v === '') return null;
  const n = typeof v === 'number' ? v : Number(String(v).replace(/[$,\s]/g, ''));
  return Number.isFinite(n) ? n : null;
}

function year(v: unknown): number | null {
  const n = number(v);
  return n != null && n >= 1800 && n <= 2100 ? Math.trunc(n) : null;
}

/** A source row in the shared shape. null when it has no account id. */
export function normalizeRow(
  d: District,
  row: Record<string, unknown>,
  extra: { retrieved: string; dataset: string; lat?: number | null; lng?: number | null; taxYear?: number | null }
): AppraisalRecord | null {
  const f = d.fields!;
  const get = reader(row);
  const account = text(get(f.account));
  if (!account) return null;
  const acres = number(get(f.landAcres));
  const sqft = number(get(f.landSqft)) ?? (acres != null ? Math.round(acres * SQFT_PER_ACRE) : null);
  const mailing = f.mailing.map((name) => text(get([name]))).filter(Boolean).join(', ') || null;
  const zip = text(get(f.situsZip))?.match(/\d{5}/)?.[0] ?? null;
  const yearBuilt = year(get(f.yearBuilt));
  const city = text(get(f.situsCity));
  let situs = text(get(f.situs));
  // Some rolls run the city and ZIP into the street line ("11502 TANGLEBRIAR TRL AUSTIN 78750"): cut them off.
  if (situs && city && !situs.includes(',')) {
    const at = situs.toUpperCase().lastIndexOf(` ${city.toUpperCase().replace(/\s*\(.*\)$/, '')}`);
    if (at > 0) situs = situs.slice(0, at).trim();
  }
  return {
    district: d.id,
    account,
    sourceUrl: d.accountUrl ? d.accountUrl.replace('{account}', encodeURIComponent(account)) : null,
    situs,
    situsCity: city && !/^no city/i.test(city) ? city : null,
    situsZip: zip,
    owner: text(get(f.owner)),
    mailing,
    landValue: number(get(f.landValue)),
    improvementValue: number(get(f.improvementValue)),
    totalValue: number(get(f.totalValue)),
    valueBasis: d.valueBasis ?? null,
    taxYear: year(get(f.taxYear)) ?? extra.taxYear ?? null,
    stateCode: text(get(f.stateCode)),
    landSqft: sqft != null && sqft > 0 ? sqft : null,
    buildingSqft: (() => {
      const b = number(get(f.buildingSqft));
      return b != null && b > 0 ? b : null;
    })(),
    yearBuilt: yearBuilt && yearBuilt > 1800 ? yearBuilt : null,
    lat: extra.lat ?? null,
    lng: extra.lng ?? null,
    retrieved: extra.retrieved,
    dataset: extra.dataset
  };
}

/** The middle of a polygon's outer ring (bounding box centre: good enough to place a pin). */
export function ringCenter(geometry: { rings?: number[][][]; x?: number; y?: number } | null | undefined): { lat: number; lng: number } | null {
  if (!geometry) return null;
  if (typeof geometry.x === 'number' && typeof geometry.y === 'number') return { lng: geometry.x, lat: geometry.y };
  const ring = geometry.rings?.[0];
  if (!ring?.length) return null;
  let [minX, minY, maxX, maxY] = [Infinity, Infinity, -Infinity, -Infinity];
  for (const [x, y] of ring) {
    if (x! < minX) minX = x!;
    if (x! > maxX) maxX = x!;
    if (y! < minY) minY = y!;
    if (y! > maxY) maxY = y!;
  }
  return { lng: Math.round(((minX + maxX) / 2) * 1e6) / 1e6, lat: Math.round(((minY + maxY) / 2) * 1e6) / 1e6 };
}
