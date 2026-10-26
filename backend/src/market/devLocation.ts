/**
 * Where a development's map point came from, how far to trust it, and the
 * rules that decide whether a point may be used at all.
 *
 * Accuracy comes before coverage: a project with no trustworthy point is
 * listed as "Location not verified" rather than pinned somewhere plausible.
 * The categories describe the evidence, never more than it shows. A city's
 * permit point and a geocoded address are address or parcel level; neither
 * says where on the site a building stands.
 */

/** How a project's point was found. */
export type LocationMethod =
  /** The city's own permit record carries the point (permit/parcel GIS). */
  | 'permit-point'
  /** The filed street address, matched by the Census geocoder (street range interpolation). */
  | 'geocoded-address'
  /** Another permit's point, at an address proven to be the same site. */
  | 'same-site-permit'
  /** Only the filed ZIP code is known: an approximate area, not a site. */
  | 'zip-area'
  | 'none';

/** What a point can claim to locate. */
export type LocationAccuracy = 'address-or-parcel' | 'street-interpolated' | 'area' | 'none';

export interface LocationInfo {
  method: LocationMethod;
  accuracy: LocationAccuracy;
  /** The record or service the point came from, in words ("San Antonio permit COM-…", "Census Geocoder"). */
  source: string;
  /** YYYY-MM-DD the point was last checked against its source. */
  verified: string;
  /** For a ZIP area: the ZIP, and the area's rough radius for drawing it. */
  zip?: string;
  areaKm?: number;
  /** Checks the point failed, kept for the audit (it is still the best evidence there is). */
  flags?: string[];
}

export const ACCURACY: Record<LocationMethod, LocationAccuracy> = {
  'permit-point': 'address-or-parcel',
  'same-site-permit': 'address-or-parcel',
  'geocoded-address': 'street-interpolated',
  'zip-area': 'area',
  none: 'none'
};

/** Stronger evidence ranks higher. A point is only ever replaced by a stronger one. */
export const RANK: Record<LocationMethod, number> = {
  'permit-point': 4,
  'same-site-permit': 3,
  'geocoded-address': 2,
  'zip-area': 1,
  none: 0
};

export const locationInfo = (method: LocationMethod, source: string, verified: string, extra: Partial<LocationInfo> = {}): LocationInfo => ({
  method,
  accuracy: ACCURACY[method],
  source,
  verified,
  ...extra
});

/** True when `next` may replace `current`: a strictly stronger method, or the same method checked more recently. */
export function mayReplace(current: LocationInfo | null | undefined, next: LocationMethod): boolean {
  const have = current?.method ?? 'none';
  return RANK[next] > RANK[have] || (next === have && next !== 'zip-area');
}

/** The method behind a project saved before provenance was kept, read from its old fields. */
export function inferMethod(p: { lat: number | null; lng: number | null; approximate?: boolean; locatedFrom?: string; source?: string; location?: LocationInfo }): LocationMethod {
  if (p.location) return p.location.method;
  if (p.lat == null || p.lng == null) return 'none';
  if (p.approximate) return 'zip-area';
  if (p.locatedFrom) return 'same-site-permit';
  return p.source === 'city' ? 'permit-point' : 'geocoded-address';
}

// --- Addresses. ---

const DIRS: Record<string, string> = { NORTH: 'N', SOUTH: 'S', EAST: 'E', WEST: 'W', NORTHEAST: 'NE', NORTHWEST: 'NW', SOUTHEAST: 'SE', SOUTHWEST: 'SW' };
const DIR = /^(N|S|E|W|NE|NW|SE|SW)$/;
const SUFFIX: Record<string, string> = {
  STREET: 'ST', STR: 'ST', AVENUE: 'AVE', AV: 'AVE', BOULEVARD: 'BLVD', ROAD: 'RD', DRIVE: 'DR', LANE: 'LN', PARKWAY: 'PKWY', PKY: 'PKWY',
  COURT: 'CT', CIRCLE: 'CIR', PLACE: 'PL', TRAIL: 'TRL', TR: 'TRL', FREEWAY: 'FWY', EXPRESSWAY: 'EXPY', EXPWY: 'EXPY', HIGHWAY: 'HWY',
  TERRACE: 'TER', SQUARE: 'SQ', CROSSING: 'XING', TRACE: 'TRCE', PASS: 'PASS', POINT: 'PT', LOOP: 'LOOP', WAY: 'WAY', COVE: 'CV', BEND: 'BND'
};
const FRONTAGE = /\b(?:FRONTAGE|FRTG|ACCESS|ACC|SERVICE|SVC|SRVC)(?:\s+(?:RD|ROAD))?\b/g;

/** "IH-10 W", "Interstate Highway 10", "I 10" → "IH 10"; US, state, farm and ranch roads alike. */
function highways(s: string): string {
  return s
    .replace(/\bINTERSTATE(?:\s+(?:HIGHWAY|HWY))?\s*-?\s*(\d+)/g, 'IH $1')
    .replace(/\bI\s*H?\s*-?\s*(\d+)\b/g, 'IH $1')
    .replace(/\bU\s*S\s*(?:HIGHWAY|HWY)?\s*-?\s*(\d+)/g, 'US $1')
    .replace(/\b(?:STATE\s+(?:HIGHWAY|HWY)|ST\s+HWY|SH|TX|TEXAS\s+(?:HIGHWAY|HWY)|STATE\s+HIGHWAY\s+LOOP)\s*-?\s*(\d+)/g, 'SH $1')
    .replace(/\b(?:FARM\s+TO\s+MARKET(?:\s+(?:ROAD|RD))?|FM\s*RD|FARM\s+RD|F\s*M)\s*-?\s*(\d+)/g, 'FM $1')
    .replace(/\b(?:RANCH\s+TO\s+MARKET(?:\s+(?:ROAD|RD))?|RANCH\s+(?:ROAD|RD)|RM|R\s*R)\s*-?\s*(\d+)/g, 'RM $1')
    .replace(/\b(?:STATE\s+)?LOOP\s*-?\s*(\d+)/g, 'LOOP $1')
    .replace(/\b(?:SPUR)\s*-?\s*(\d+)/g, 'SPUR $1')
    .replace(/\b(?:BELTWAY|BW)\s*-?\s*(\d+)/g, 'BW $1');
}

export interface ParsedAddress {
  /** The first house number ("5730" of "5730-5734"). */
  number: string | null;
  /** Every house number a range names. */
  numbers: string[];
  /** Street name without its direction or frontage words: "IH 10", "MAIN ST". */
  street: string;
  /** The street's direction, wherever it was written: "N Main St" and "Main St N" are both N. */
  dir: string | null;
  /** The address names a frontage, access or service road. */
  frontage: boolean;
  /** A building, unit or suite the address names. */
  unit: string | null;
  place: string | null;
  zip: string | null;
}

/** Breaks a one-line address into comparable parts (upper case, abbreviations unified). */
export function parseAddress(address: string | null | undefined): ParsedAddress | null {
  if (!address?.trim()) return null;
  const parts = address.split(',').map((p) => p.trim());
  let line = (parts[0] ?? '').toUpperCase().replace(/\./g, '').replace(/#/g, ' # ');
  const tail = parts.slice(1).join(', ').toUpperCase();
  const zip = /\b(\d{5})(?:-\d{4})?\s*$/.exec(tail)?.[1] ?? /\b(\d{5})(?:-\d{4})?\s*$/.exec(line)?.[1] ?? null;
  const place = parts.length > 1 ? (/^\s*(?:CITY OF\s+)?([A-Z][A-Z .'-]*?)\s*(?:,|\s+(?:TX|TEXAS)\b|\s+\d{5}|$)/.exec(tail)?.[1]?.trim() ?? null) : null;
  // Units and buildings: "BLDG 3", "BUILDING A", "STE 100", "UNIT 4", "# 12".
  let unit: string | null = null;
  line = line.replace(/\s+(?:BLDG|BUILDING|STE|SUITE|UNIT|APT|#)\s*([A-Z0-9-]+)\b.*$/, (_m, u: string) => {
    unit = u;
    return '';
  });
  // House numbers: "5730-5734", "5730 & 5734", "5730/5734".
  const lead = /^(\d+[A-Z]?)((?:\s*(?:-|&|\/|AND)\s*\d+[A-Z]?)*)\s+/.exec(line);
  const numbers = lead ? [lead[1]!, ...(lead[2]!.match(/\d+[A-Z]?/g) ?? [])] : [];
  let rest = lead ? line.slice(lead[0].length) : line;
  rest = highways(rest.replace(/[^A-Z0-9 &/-]/g, ' ').replace(/\s+/g, ' ').trim());
  let frontage = false;
  rest = rest.replace(FRONTAGE, () => {
    frontage = true;
    return ' ';
  });
  const words = rest
    .replace(/-/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => DIRS[w] ?? w);
  let dir: string | null = null;
  if (words.length > 1 && DIR.test(words[0]!)) dir = words.shift()!;
  if (words.length > 1 && DIR.test(words[words.length - 1]!)) {
    const last = words.pop()!;
    dir ??= last;
  }
  const street = words.map((w, i) => (i === words.length - 1 || i > 0 ? (SUFFIX[w] ?? w) : w)).join(' ');
  return { number: numbers[0] ?? null, numbers, street, dir, frontage, unit, place: place || null, zip };
}

/** A key for one street address in one town: number, direction, street, and ZIP (or town). */
export function addressKey(address: string | null | undefined): string | null {
  const a = parseAddress(address);
  if (!a?.number || !a.street) return null;
  return [a.number, a.dir ?? '', a.street, a.zip ?? a.place ?? ''].join('|');
}

// --- Same site. ---

/** Names of big sites (campuses, hospitals, malls, business parks), where one street address can span a square kilometre. */
export const CAMPUS = /\b(campus|universit|college|school|isd\b|hospital|medical (?:center|campus|district)|shopping|mall\b|business park|industrial park|logistics park|office park|airport|marketplace)/i;
const PHASE = /\b(phase|ph|buildings?|bldgs?|tract|lot)\.?\s*(?:no\.?|number|#)?\s*:?\s*([a-z0-9]{1,3}(?:\s*(?:&|and|,)\s*[a-z0-9]{1,3})*)\b/gi;
const KIND: Record<string, string> = { PH: 'PHASE', BUILDINGS: 'BUILDING', BLDG: 'BUILDING', BLDGS: 'BUILDING' };

/** Phase or building markers a name carries: "Phase 2" → PHASE2, "Buildings 1 & 2" → BUILDING1, BUILDING2, "Building No: 1" → BUILDING1. */
export function phaseMarks(text: string | null | undefined): string[] {
  const out: string[] = [];
  for (const m of (text ?? '').matchAll(PHASE)) {
    const kind = KIND[m[1]!.toUpperCase()] ?? m[1]!.toUpperCase();
    for (const id of m[2]!.toUpperCase().split(/\s*(?:&|AND|,)\s*/)) if (id) out.push(`${kind}${id}`);
  }
  return out;
}

const GENERIC = new Set('THE OF AND AT ON IN FOR NEW A BUILDING BUILDINGS BLDG PHASE CENTER CENTRE PARK PLAZA COMMERCIAL RETAIL OFFICE SHELL ADDITION CONSTRUCTION PROJECT DEVELOPMENT UNIT SUITE TX TEXAS SAN ANTONIO AUSTIN FORT WORTH DALLAS HOUSTON ST RD DR BLVD AVE LN PKWY HWY'.split(' '));

/** Distinctive words in a name, for telling whether two records name the same project. */
export function nameWords(text: string | null | undefined): Set<string> {
  return new Set(
    (text ?? '')
      .toUpperCase()
      .replace(/[^A-Z0-9 ]/g, ' ')
      .split(/\s+/)
      .filter((w) => w.length > 2 && !GENERIC.has(w) && !/^\d+$/.test(w))
  );
}

export interface SiteRecord {
  address: string | null;
  /** The town the project is in, where the record says (TABS city, permit city). */
  place?: string | null;
  /** Names the record goes by. */
  names?: (string | null | undefined)[];
}

export interface SameSite {
  same: boolean;
  reason: string;
  /** Something to look at even though the records match (a filed ZIP that differs within one town). */
  flag?: string;
}

const norm = (s: string | null | undefined) => (s ?? '').toUpperCase().replace(/^CITY OF\s+/, '').replace(/[^A-Z]/g, '');

/**
 * Whether two records are proven to be one site, strongly enough to lend one
 * record's point to the other. House number and street must agree, with the
 * same direction, in the same ZIP (or, with no ZIP on one side, the same
 * town). Campuses, shopping centers and phased projects need more: a shared
 * distinctive name, and no conflicting phase or building.
 */
export function sameSite(a: SiteRecord, b: SiteRecord): SameSite {
  const base = sameAddress(a, b);
  if (!base.same) return base;
  const x = parseAddress(a.address)!;
  const y = parseAddress(b.address)!;
  const namesA = (a.names ?? []).filter(Boolean).join(' ');
  const namesB = (b.names ?? []).filter(Boolean).join(' ');
  const phasesA = phaseMarks(namesA);
  const phasesB = phaseMarks(namesB);
  for (const kind of ['PHASE', 'BUILDING', 'TRACT', 'LOT']) {
    const a1 = phasesA.filter((p) => p.startsWith(kind));
    const b1 = phasesB.filter((p) => p.startsWith(kind));
    if (a1.length && b1.length && !a1.some((p) => b1.includes(p))) return { same: false, reason: `different ${kind.toLowerCase()} in the names` };
  }
  const multi = x.numbers.length > 1 || y.numbers.length > 1 || CAMPUS.test(namesA) || CAMPUS.test(namesB);
  if (multi) {
    const wordsA = nameWords(namesA);
    const shared = [...nameWords(namesB)].filter((w) => wordsA.has(w));
    if (!shared.length) return { same: false, reason: 'multi-building or campus site: the address alone is not enough' };
    return { ...base, same: true, reason: `same address and ZIP/town, names share ${shared.slice(0, 3).join(', ')}` };
  }
  return { ...base, same: true, reason: 'same house number, direction, street and ZIP/town' };
}

/** Same street address in the same ZIP (or town): enough to call two records one listing, not to lend a point. */
export function sameAddress(a: SiteRecord, b: SiteRecord): SameSite {
  const x = parseAddress(a.address);
  const y = parseAddress(b.address);
  if (!x?.number || !y?.number) return { same: false, reason: 'no street number on one record' };
  if (x.number !== y.number) return { same: false, reason: 'different house number' };
  if (x.street !== y.street) return { same: false, reason: 'different street' };
  if ((x.dir ?? '') !== (y.dir ?? '')) return { same: false, reason: 'different or missing street direction' };
  const zipA = x.zip;
  const zipB = y.zip;
  const placeA = norm(a.place ?? x.place);
  const placeB = norm(b.place ?? y.place);
  let flag: string | undefined;
  if (zipA && zipB && zipA !== zipB) {
    // Filings carry wrong ZIPs (TDLR has The Merc on UTSA Blvd in 78243; the
    // city says 78249). In one town that is a flag to check, not a refusal;
    // across towns it is a different street (Main St in Boerne is not Main St in San Antonio).
    if (!placeA || !placeB || placeA !== placeB) return { same: false, reason: `different ZIP (${zipA} vs ${zipB})` };
    flag = `filed ZIP ${zipA} differs from ${zipB} on the other record`;
  } else if (!zipA || !zipB) {
    if (!placeA || !placeB) return { same: false, reason: 'no ZIP or town to compare' };
    if (placeA !== placeB) return { same: false, reason: `different town (${a.place ?? x.place} vs ${b.place ?? y.place})` };
  }
  // Same ZIP with different town names is usual: a mailing town (Crowley,
  // Haslet) for a site inside Fort Worth's limits, or a county for a town.
  if (x.unit && y.unit && x.unit !== y.unit) return { same: false, reason: `different building or unit (${x.unit} vs ${y.unit})` };
  return { same: true, reason: 'same street address', ...(flag ? { flag } : {}) };
}

// --- Checking a point. ---

/** Kilometres between two points, near enough for a sanity check. */
export function km([lat1, lng1]: [number, number], [lat2, lng2]: [number, number]): number {
  const rad = Math.PI / 180;
  const x = (lng2 - lng1) * rad * Math.cos(((lat1 + lat2) / 2) * rad);
  const y = (lat2 - lat1) * rad;
  return Math.sqrt(x * x + y * y) * 6371;
}

/** A ZIP code area from the Census gazetteer: its interior point and the radius of a circle of its land area. */
export interface ZipArea {
  at: [number, number];
  radiusKm: number;
}

/** How far outside its ZIP's circle a point may sit before it is suspicious (ZCTAs are not circles). */
export const zipSlackKm = (area: ZipArea) => Math.max(3, area.radiusKm * 1.5 + 1.5);

export interface PointCheck {
  ok: boolean;
  flags: string[];
}

/**
 * Flags for a point: outside the market, or well outside the ZIP its address
 * names. A flag means "look at this", not "wrong": suburban projects sit far
 * from the city center legitimately, so only the market radius rejects.
 */
export function checkPoint(at: [number, number], o: { center: [number, number]; radiusKm: number; zip?: string | null; zips?: Map<string, ZipArea> }): PointCheck {
  const flags: string[] = [];
  const fromCenter = km(at, o.center);
  if (fromCenter > o.radiusKm) flags.push(`outside the market (${fromCenter.toFixed(0)} km from the city center)`);
  const area = o.zip ? o.zips?.get(o.zip) : undefined;
  if (area) {
    const d = km(at, area.at);
    if (d > zipSlackKm(area)) flags.push(`${d.toFixed(1)} km from the center of its ZIP ${o.zip} (about ${area.radiusKm.toFixed(1)} km across)`);
  } else if (o.zip && o.zips?.size) flags.push(`ZIP ${o.zip} is not a Texas ZIP area`);
  return { ok: fromCenter <= o.radiusKm, flags };
}

// --- The Census geocoder's answer. ---

export interface CensusMatch {
  coordinates?: { x: number; y: number };
  matchedAddress?: string;
  addressComponents?: { zip?: string; city?: string; state?: string; preDirection?: string; suffixDirection?: string; fromAddress?: string; toAddress?: string };
}

export interface GeocodePick {
  at: [number, number] | null;
  matched?: string;
  /** Why no point was taken. */
  rejected?: string;
}

/**
 * The geocoder's match, only if it is the filed address: same house number,
 * direction, ZIP (or town when no ZIP was filed), in Texas. Several matches
 * that disagree by more than a kilometre are ambiguous and give no point.
 */
export function pickGeocode(address: string, matches: CensusMatch[] | undefined): GeocodePick {
  const filed = parseAddress(address);
  const usable = (matches ?? []).filter((m) => Number.isFinite(m.coordinates?.x) && Number.isFinite(m.coordinates?.y));
  if (!usable.length) return { at: null, rejected: 'no match' };
  const fits = usable.filter((m) => {
    const c = m.addressComponents ?? {};
    if (c.state && c.state.toUpperCase() !== 'TX') return false;
    const got = parseAddress(m.matchedAddress);
    if (filed?.zip) {
      const zip = c.zip ?? got?.zip;
      if (zip && zip !== filed.zip) return false;
    } else if (filed?.place) {
      const city = c.city ?? got?.place;
      if (city && norm(city) !== norm(filed.place)) return false;
    }
    if (filed?.number && got?.number && got.number !== filed.number) return false;
    const dir = (c.preDirection || c.suffixDirection || got?.dir || '').toUpperCase();
    if (filed?.dir && dir && dir !== filed.dir) return false;
    return true;
  });
  if (!fits.length) {
    const m = usable[0]!;
    return { at: null, matched: m.matchedAddress, rejected: `match is not the filed address (${m.matchedAddress ?? 'no address'})` };
  }
  const points = fits.map((m) => [m.coordinates!.y, m.coordinates!.x] as [number, number]);
  const spreadKm = Math.max(...points.map((p) => km(p, points[0]!)));
  if (spreadKm > 1) return { at: null, matched: fits[0]!.matchedAddress, rejected: `${fits.length} matches up to ${spreadKm.toFixed(1)} km apart` };
  return { at: points[0]!, matched: fits[0]!.matchedAddress };
}
