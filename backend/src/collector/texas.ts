import { CITIES, type City } from '../types.js';

/**
 * Suburbs and metro aliases that should roll up to one of the six tracked
 * cities. Keys are lowercase; longest key wins so 'north richland hills' is not
 * shadowed by 'richland'.
 */
const ALIASES: Record<string, City> = {
  // Dallas side of the metroplex
  dfw: 'Dallas',
  'dallas-fort worth': 'Dallas',
  'dallas/fort worth': 'Dallas',
  'north texas': 'Dallas',
  plano: 'Dallas',
  frisco: 'Dallas',
  irving: 'Dallas',
  'las colinas': 'Dallas',
  richardson: 'Dallas',
  addison: 'Dallas',
  garland: 'Dallas',
  mckinney: 'Dallas',
  allen: 'Dallas',
  'grand prairie': 'Dallas',
  carrollton: 'Dallas',
  lewisville: 'Dallas',
  denton: 'Dallas',
  'farmers branch': 'Dallas',
  'uptown dallas': 'Dallas',

  // Tarrant County rolls up to Fort Worth
  'ft worth': 'Fort Worth',
  'ft. worth': 'Fort Worth',
  arlington: 'Fort Worth',
  bedford: 'Fort Worth',
  euless: 'Fort Worth',
  keller: 'Fort Worth',
  southlake: 'Fort Worth',
  grapevine: 'Fort Worth',
  'north richland hills': 'Fort Worth',
  alliance: 'Fort Worth',

  // Houston
  katy: 'Houston',
  sugar_land: 'Houston',
  'sugar land': 'Houston',
  'the woodlands': 'Houston',
  woodlands: 'Houston',
  pearland: 'Houston',
  pasadena: 'Houston',
  'league city': 'Houston',
  conroe: 'Houston',
  'greater houston': 'Houston',

  // Austin
  'round rock': 'Austin',
  pflugerville: 'Austin',
  'cedar park': 'Austin',
  georgetown: 'Austin',
  'san marcos': 'Austin',
  kyle: 'Austin',
  buda: 'Austin',
  'central texas': 'Austin',
  'the domain': 'Austin',

  // San Antonio
  'san antonio, tx': 'San Antonio',
  'new braunfels': 'San Antonio',
  schertz: 'San Antonio',
  'live oak': 'San Antonio',
  boerne: 'San Antonio',

  // El Paso
  'el paso, tx': 'El Paso'
};

/** US state markers other than Texas, used to reject out-of-state postings. */
const OTHER_STATES =
  /\b(a[klrz]|c[aot]|d[ce]|fl|ga|hi|i[adln]|k[sy]|la|m[adeinost]|n[cdehjmvy]|o[hkr]|pa|ri|s[cd]|tn|ut|v[at]|w[aivy])\b|\b(alabama|alaska|arizona|arkansas|california|colorado|connecticut|delaware|florida|georgia|hawaii|idaho|illinois|indiana|iowa|kansas|kentucky|louisiana|maine|maryland|massachusetts|michigan|minnesota|mississippi|missouri|montana|nebraska|nevada|new hampshire|new jersey|new mexico|new york|north carolina|north dakota|ohio|oklahoma|oregon|pennsylvania|rhode island|south carolina|south dakota|tennessee|utah|vermont|virginia|washington|west virginia|wisconsin|wyoming)\b/;

const TEXAS = /\b(tx|texas)\b/;

const CITY_KEYS: [string, City][] = [
  ...CITIES.map((c) => [c.toLowerCase(), c] as [string, City]),
  ...Object.entries(ALIASES)
].sort((a, b) => b[0].length - a[0].length);

/**
 * Resolve a free-text ATS location to one of the six tracked Texas cities, or
 * null when the posting is not in Texas.
 *
 * Policy, in order:
 *  1. Split the string into segments — boards routinely list several offices.
 *  2. A segment naming a tracked city wins if it carries a Texas marker, or if
 *     it names no state at all (bare 'Austin' on a Texas firm's board).
 *  3. A segment naming another state is skipped, so 'Austin, MN' is not Texas
 *     and 'New York, NY; Dallas, TX' resolves to Dallas.
 *  4. 'Remote' with no Texas city anywhere is rejected — the app is Texas only.
 */
export function resolveCity(location: string): City | null {
  if (!location) return null;
  const cleaned = location.toLowerCase().replace(/\s+/g, ' ').trim();

  for (const segment of cleaned.split(/[;|/]|(?:,?\s+(?:and|or)\s+)|•/)) {
    const seg = segment.trim();
    if (!seg) continue;

    const city = matchCity(seg);
    if (!city) continue;

    if (TEXAS.test(seg)) return city;
    // Strip the matched city name before looking for a competing state, so
    // 'Washington' inside a street name is the only thing that could trip here.
    const withoutCity = seg.replace(cityPattern(city), ' ');
    if (!OTHER_STATES.test(withoutCity)) return city;
  }

  return null;
}

function matchCity(segment: string): City | null {
  for (const [key, city] of CITY_KEYS) {
    if (new RegExp(`(^|[^a-z])${escapeRegExp(key)}([^a-z]|$)`).test(segment)) {
      return city;
    }
  }
  return null;
}

function cityPattern(city: City): RegExp {
  const keys = CITY_KEYS.filter(([, c]) => c === city).map(([k]) => escapeRegExp(k));
  return new RegExp(keys.join('|'), 'g');
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function isTexas(location: string): boolean {
  return resolveCity(location) !== null;
}
