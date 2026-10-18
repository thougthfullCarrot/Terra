/**
 * Conservative street address matching for appraisal records.
 *
 * Every district writes situs addresses its own way ("100 N MAIN ST",
 * "100 MAIN ST N", "100 NORTH MAIN STREET UNIT 4"), so both the typed address
 * and the recorded one are reduced to the same parts and compared part by
 * part. The rule throughout: a part both sides carry must agree; a part only
 * one side carries makes the match weaker, never silently stronger. When more
 * than one parcel survives, all of them are returned for the person to pick.
 */

export interface AddressParts {
  number: string;
  /** Direction before the street name: N, S, E, W, NE, NW, SE, SW. */
  pre: string | null;
  /** Street name words, upper case, ordinals bare ("2ND" → "2"). */
  name: string[];
  /** Suffix: ST, AVE, ... */
  suffix: string | null;
  /** Direction after the street name ("MAIN ST N"). */
  post: string | null;
  /** Unit, suite or apartment ("4B"), or null. */
  unit: string | null;
  /** City and ZIP typed or recorded after the street, when there are any. */
  city: string | null;
  zip: string | null;
}

const DIRECTION_WORDS: Record<string, string> = {
  NORTH: 'N', SOUTH: 'S', EAST: 'E', WEST: 'W',
  NORTHEAST: 'NE', NORTHWEST: 'NW', SOUTHEAST: 'SE', SOUTHWEST: 'SW'
};
const DIRECTIONS = new Set(['N', 'S', 'E', 'W', 'NE', 'NW', 'SE', 'SW']);

/** USPS Publication 28 suffixes Texas rolls use, long form → standard. */
export const SUFFIXES: Record<string, string> = {
  STREET: 'ST', STR: 'ST', ST: 'ST',
  AVENUE: 'AVE', AV: 'AVE', AVE: 'AVE',
  BOULEVARD: 'BLVD', BLV: 'BLVD', BLVD: 'BLVD',
  DRIVE: 'DR', DRV: 'DR', DR: 'DR',
  ROAD: 'RD', RD: 'RD',
  LANE: 'LN', LN: 'LN',
  PARKWAY: 'PKWY', PKY: 'PKWY', PKWY: 'PKWY',
  FREEWAY: 'FWY', FWY: 'FWY',
  HIGHWAY: 'HWY', HWY: 'HWY',
  EXPRESSWAY: 'EXPY', EXPWY: 'EXPY', EXPY: 'EXPY',
  COURT: 'CT', CT: 'CT',
  PLACE: 'PL', PL: 'PL',
  CIRCLE: 'CIR', CIR: 'CIR',
  TRAIL: 'TRL', TR: 'TRL', TRL: 'TRL',
  WAY: 'WAY', WY: 'WAY',
  LOOP: 'LOOP', LP: 'LOOP',
  PLAZA: 'PLZ', PLZ: 'PLZ',
  SQUARE: 'SQ', SQ: 'SQ',
  TERRACE: 'TER', TER: 'TER',
  CROSSING: 'XING', XING: 'XING',
  PASS: 'PASS', PATH: 'PATH', RUN: 'RUN', ROW: 'ROW',
  COVE: 'CV', CV: 'CV',
  POINT: 'PT', PT: 'PT',
  BEND: 'BND', BND: 'BND',
  RIDGE: 'RDG', RDG: 'RDG',
  HOLLOW: 'HOLW', HOLW: 'HOLW',
  GLEN: 'GLN', GLN: 'GLN',
  VIEW: 'VW', VW: 'VW',
  WALK: 'WALK'
};
/** Highway prefixes that read as street names ("IH 10 W", "US HWY 281", "FM 1960"). */
const HIGHWAY_NAMES: Record<string, string> = {
  INTERSTATE: 'IH', I: 'IH', IH: 'IH',
  'U.S.': 'US', US: 'US',
  'STATE HIGHWAY': 'SH', SH: 'SH', SR: 'SH',
  FM: 'FM', 'FARM TO MARKET': 'FM', RM: 'RM', 'RANCH TO MARKET': 'RM',
  LOOP: 'LOOP', SPUR: 'SPUR'
};
const UNIT_WORDS = new Set(['UNIT', 'APT', 'APARTMENT', 'STE', 'SUITE', 'BLDG', 'BUILDING', 'NO', '#', 'RM', 'ROOM', 'FL', 'FLOOR', 'SPC', 'SPACE', 'LOT', 'TRLR']);
const SAINT = new Set(['ST', 'SAINT', 'STE']);

function words(text: string): string[] {
  return text
    .toUpperCase()
    .replace(/#\s*/g, ' # ')
    .replace(/[^A-Z0-9#/ -]+/g, ' ')
    .replace(/(\d)-(?=[A-Z])/g, '$1 ')
    .split(/[\s]+/)
    .filter(Boolean);
}

/**
 * Split an address into parts. "1000 N Main Street Ste 200, San Antonio, TX 78205"
 * → { number: '1000', pre: 'N', name: ['MAIN'], suffix: 'ST', unit: '200', city: 'SAN ANTONIO', zip: '78205' }.
 * null when there is no leading house number (a legal description, "0 Main",
 * or a blank): those can't be matched safely.
 */
export function parseAddress(text: string | null | undefined): AddressParts | null {
  const raw = String(text ?? '').trim();
  if (!raw) return null;
  const [street = '', ...rest] = raw.split(',');
  let city: string | null = null;
  let zip: string | null = raw.match(/\b(\d{5})(?:-?\d{4})?\s*$/)?.[1] ?? null;
  for (const part of rest) {
    const c = part.toUpperCase().replace(/\b(TX|TEXAS)\b/g, '').replace(/\d{5}(-?\d{4})?/g, '').replace(/[^A-Z ]+/g, ' ').trim();
    if (c && !city) city = c.replace(/\s+/g, ' ');
  }
  let w = words(street);
  // A ZIP or "TX 78205" at the end of a comma-less address.
  if (!rest.length) {
    if (w.length > 2 && /^\d{5}$/.test(w[w.length - 1]!)) w = w.slice(0, -1);
    if (w.length > 2 && (w[w.length - 1] === 'TX' || w[w.length - 1] === 'TEXAS')) w = w.slice(0, -1);
  }
  const number = w[0];
  if (!number || !/^\d+[A-Z]?$/.test(number) || /^0+$/.test(number)) return null;
  w = w.slice(1);
  // "1000-1010 Main" or "1000 1/2 Main": keep the first number, drop the half.
  if (w[0] === '1/2') w = w.slice(1);

  // Unit: from the first unit word on; a bare trailing "#4" too.
  let unit: string | null = null;
  const u = w.findIndex((x) => UNIT_WORDS.has(x) && w.indexOf(x) > 0);
  if (u > 0) {
    unit = w.slice(u + 1).filter((x) => x !== '#').join(' ') || null;
    w = w.slice(0, u);
  }

  const dir = (x: string | undefined) => (x ? DIRECTION_WORDS[x] ?? (DIRECTIONS.has(x) ? x : null) : null);
  let pre: string | null = null;
  // A direction leads only when a street name follows it ("100 West Ave" is West Avenue).
  if (dir(w[0]) && w.length > 1 && !(w.length === 2 && SUFFIXES[w[1]!])) {
    pre = dir(w[0]);
    w = w.slice(1);
  }
  let post: string | null = null;
  if (w.length > 1 && dir(w[w.length - 1])) {
    post = dir(w[w.length - 1]);
    w = w.slice(0, -1);
  }
  let suffix: string | null = null;
  const last = w[w.length - 1];
  const highway = w[0] && HIGHWAY_NAMES[w[0]];
  if (w.length > 1 && last && SUFFIXES[last] && !(highway && w.length === 2)) {
    suffix = SUFFIXES[last]!;
    w = w.slice(0, -1);
  }
  const name = w
    .map((x, i) => {
      if (i === 0 && HIGHWAY_NAMES[x]) return HIGHWAY_NAMES[x]!;
      if (i === 0 && SAINT.has(x) && w.length > 1) return 'ST';
      if (x === 'HWY' && i === 1 && w[0] && HIGHWAY_NAMES[w[0]]) return '';
      return x.replace(/^(\d+)(ST|ND|RD|TH)$/, '$1');
    })
    .filter(Boolean);
  if (!name.length) return null;
  return { number, pre, name, suffix, post, unit, city, zip };
}

/** The key an index is built on: the street name words alone ("MAIN", "ST MARYS"). */
export function streetKey(parts: Pick<AddressParts, 'name'>): string {
  return parts.name.join(' ');
}

/** "1000 N MAIN ST N UNIT 4": the parts back in one standard order, for display and dedupe. */
export function formatStreet(p: AddressParts): string {
  return [p.number, p.pre, ...p.name, p.suffix, p.post, p.unit ? `UNIT ${p.unit}` : null].filter(Boolean).join(' ');
}

export type MatchGrade = 'exact' | 'probable' | 'none';

/**
 * How well a recorded address answers a typed one.
 *   exact     number, name and every part both sides carry agree, including the unit when the typed address has one.
 *   probable  number and name agree, but a part only one side carries (a direction, a suffix, a unit) is missing,
 *             so it might be a different street ("100 Main" vs "100 N Main" when "100 S Main" also exists).
 *   none      number, name, or a part both carry disagree.
 */
export function gradeMatch(typed: AddressParts, recorded: AddressParts): MatchGrade {
  if (typed.number !== recorded.number) return 'none';
  if (streetKey(typed) !== streetKey(recorded)) return 'none';
  // Some rolls put the direction after the name, so either position counts as the street's direction.
  const td = typed.pre ?? typed.post;
  const rd = recorded.pre ?? recorded.post;
  if (td && rd && td !== rd) return 'none';
  if (typed.suffix && recorded.suffix && typed.suffix !== recorded.suffix) return 'none';
  if (typed.unit && recorded.unit && normUnit(typed.unit) !== normUnit(recorded.unit)) return 'none';
  if (typed.zip && recorded.zip && typed.zip !== recorded.zip) return 'none';
  if (typed.city && recorded.city && typed.city !== recorded.city) return 'none';
  const missing = (Boolean(td) !== Boolean(rd)) || (Boolean(typed.suffix) !== Boolean(recorded.suffix)) || (Boolean(typed.unit) && !recorded.unit);
  return missing ? 'probable' : 'exact';
}

function normUnit(u: string): string {
  return u.replace(/[^A-Z0-9]/g, '').replace(/^0+/, '');
}

export interface Candidate<T> {
  record: T;
  grade: Exclude<MatchGrade, 'none'>;
}

export type MatchResult<T> =
  /** One property at the address. Several parcels can still sit under it (a building on two lots): `records` holds them all. */
  | { status: 'match'; records: T[] }
  /** Several possible properties, or only weaker matches: the person picks. Never auto-chosen. */
  | { status: 'ambiguous'; candidates: Candidate<T>[]; reason: string }
  | { status: 'none'; reason: string };

/**
 * Match a typed address against recorded ones. `situs` reads the record's
 * address; `place` names the district (so one address in two counties is
 * ambiguous, not merged).
 *
 * A single 'match' needs every survivor to be exact and to share one
 * normalized street address (several accounts at one exact address are
 * parcels of the same site: condos, a building over two lots). Anything
 * else, including exact hits in two districts, is returned as ambiguous.
 */
export function matchAddress<T>(typedText: string, records: T[], situs: (r: T) => string, place: (r: T) => string = () => ''): MatchResult<T> {
  const typed = parseAddress(typedText);
  if (!typed) return { status: 'none', reason: 'No house number and street name to match on.' };
  const graded: Candidate<T>[] = [];
  for (const record of records) {
    const parts = parseAddress(situs(record));
    if (!parts) continue;
    const grade = gradeMatch(typed, parts);
    if (grade !== 'none') graded.push({ record, grade });
  }
  if (!graded.length) return { status: 'none', reason: 'No recorded address has this house number and street.' };
  const exact = graded.filter((c) => c.grade === 'exact');
  const keyOf = (c: Candidate<T>) => {
    const p = parseAddress(situs(c.record))!;
    return `${place(c.record)}|${p.number} ${p.pre ?? p.post ?? ''} ${streetKey(p)} ${p.suffix ?? ''}${typed.unit ? ` #${normUnit(p.unit ?? '')}` : ''}`;
  };
  if (exact.length && exact.length === graded.length) {
    const sites = new Set(exact.map(keyOf));
    const places = new Set(exact.map((c) => place(c.record)));
    if (sites.size === 1) return { status: 'match', records: exact.map((c) => c.record) };
    return {
      status: 'ambiguous',
      candidates: exact,
      reason: places.size > 1 ? 'The address is on record in more than one appraisal district.' : 'More than one property matches this address.'
    };
  }
  return {
    status: 'ambiguous',
    candidates: [...exact, ...graded.filter((c) => c.grade === 'probable')],
    reason: exact.length
      ? 'Some recorded addresses match only partly (a direction, suffix or unit differs or is missing).'
      : 'No recorded address matches every part typed; these are close.'
  };
}
