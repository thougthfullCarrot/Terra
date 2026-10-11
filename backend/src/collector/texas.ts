import { CITIES, type City } from '../types.js';

/**
 * Suburbs and metro aliases that should roll up to one of the tracked
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
  schertz: 'San Antonio',
  'live oak': 'San Antonio',
  boerne: 'San Antonio',
  satx: 'San Antonio',
  'stone oak': 'San Antonio',
  'alamo heights': 'San Antonio',
  'leon valley': 'San Antonio',
  'shavano park': 'San Antonio',
  'castle hills': 'San Antonio',
  windcrest: 'San Antonio',
  'universal city': 'San Antonio',
  converse: 'San Antonio',
  selma: 'San Antonio',
  cibolo: 'San Antonio',
  helotes: 'San Antonio',
  seguin: 'San Antonio',
  'fort sam houston': 'San Antonio',
  'joint base san antonio': 'San Antonio',

  // El Paso
  'el paso, tx': 'El Paso',

  // New Braunfels (Comal County; its own market, inside the San Antonio metro)
  'new braunfels': 'New Braunfels',
  'gruene': 'New Braunfels',

  // College Station (Brazos County, with Bryan next door)
  bryan: 'College Station',
  'bryan-college station': 'College Station',
  'brazos valley': 'College Station',

  // Galveston (the island; League City and Texas City stay with Houston)
  'galveston island': 'Galveston',

  // Midland, with Odessa next door (Permian Basin)
  odessa: 'Midland',
  'midland-odessa': 'Midland',
  'permian basin': 'Midland',

  // More suburbs, so a Cypress or Prosper posting groups with its metro.
  cypress: 'Houston',
  spring: 'Houston',
  tomball: 'Houston',
  humble: 'Houston',
  kingwood: 'Houston',
  'missouri city': 'Houston',
  'bellaire': 'Houston',
  'baytown': 'Houston',
  'friendswood': 'Houston',
  'rosenberg': 'Houston',
  'fulshear': 'Houston',
  'clear lake': 'Houston',
  'energy corridor': 'Houston',
  'texas city': 'Galveston',
  prosper: 'Dallas',
  celina: 'Dallas',
  rockwall: 'Dallas',
  rowlett: 'Dallas',
  wylie: 'Dallas',
  'little elm': 'Dallas',
  'the colony': 'Dallas',
  coppell: 'Dallas',
  mesquite: 'Dallas',
  duncanville: 'Dallas',
  desoto: 'Dallas',
  'cedar hill': 'Dallas',
  forney: 'Dallas',
  'flower mound': 'Dallas',
  'highland park': 'Dallas',
  'university park': 'Dallas',
  waxahachie: 'Dallas',
  mansfield: 'Fort Worth',
  weatherford: 'Fort Worth',
  burleson: 'Fort Worth',
  'haltom city': 'Fort Worth',
  hurst: 'Fort Worth',
  colleyville: 'Fort Worth',
  roanoke: 'Fort Worth',
  westlake: 'Fort Worth',
  'trophy club': 'Fort Worth',
  leander: 'Austin',
  'lakeway': 'Austin',
  'bee cave': 'Austin',
  'dripping springs': 'Austin',
  hutto: 'Austin',
  manor: 'Austin',
  'west lake hills': 'Austin',
  'horseshoe bay': 'Austin',

  // Aggregators and some boards give a county instead of a town.
  'dallas county': 'Dallas',
  'collin county': 'Dallas',
  'denton county': 'Dallas',
  'rockwall county': 'Dallas',
  'tarrant county': 'Fort Worth',
  'harris county': 'Houston',
  'fort bend county': 'Houston',
  'montgomery county, tx': 'Houston',
  'brazoria county': 'Houston',
  'travis county': 'Austin',
  'williamson county': 'Austin',
  'hays county': 'Austin',
  'bexar county': 'San Antonio',
  'comal county': 'New Braunfels',
  'el paso county': 'El Paso',
  'lubbock county': 'Lubbock',
  'midland county': 'Midland',
  'galveston county': 'Galveston',
  'brazos county': 'College Station'
};

/**
 * Texas places outside the tracked metros. Since PR 'jobs anywhere in Texas'
 * a posting in Corpus Christi or Tyler is kept under its own name; it just
 * has no market dashboard. Names that are common elsewhere (Paris, Athens,
 * Victoria, Palestine...) are only trusted with a TX marker, so they sit in
 * AMBIGUOUS_PLACES rather than here.
 */
const PLACES = [
  'Corpus Christi', 'Laredo', 'McAllen', 'Edinburg', 'Mission', 'Pharr', 'Brownsville', 'Harlingen',
  'Weslaco', 'South Padre Island', 'Port Aransas', 'Rockport', 'Kingsville', 'Waco', 'Temple', 'Killeen',
  'Belton', 'Harker Heights', 'Copperas Cove', 'Tyler', 'Longview', 'Nacogdoches', 'Lufkin', 'Marshall',
  'Texarkana', 'Beaumont', 'Port Arthur', 'Orange', 'Amarillo', 'Canyon', 'Abilene', 'San Angelo',
  'Wichita Falls', 'Big Spring', 'Del Rio', 'Eagle Pass', 'Uvalde', 'Kerrville', 'Fredericksburg',
  'Marble Falls', 'Huntsville', 'Lake Jackson', 'Freeport', 'Angleton', 'Bay City', 'El Campo',
  'Wharton', 'Sealy', 'Brenham', 'Navasota', 'Stephenville', 'Granbury', 'Cleburne', 'Corsicana',
  'Ennis', 'Sherman', 'Denison', 'Gainesville', 'Greenville', 'Sulphur Springs', 'Mount Pleasant',
  'Kilgore', 'Henderson', 'Jacksonville', 'Mineral Wells', 'Brownwood', 'Pecos', 'Fort Stockton',
  'Alpine', 'Lockhart', 'Bastrop', 'Elgin', 'Taylor', 'Salado', 'Gatesville', 'Hewitt',
  'Midlothian', 'Red Oak', 'Terrell', 'Kaufman', 'Princeton', 'Anna', 'Melissa', 'Sachse', 'Royse City',
  'Aubrey', 'Krum', 'Argyle', 'Northlake', 'Justin', 'Haslet', 'Aledo', 'Azle', 'Crowley',
  'Conroe', 'Montgomery', 'Magnolia', 'Willis', 'Dayton', 'Liberty', 'Cleveland', 'Hempstead',
  'Waller', 'Brookshire', 'Needville', 'Alvin', 'Dickinson', 'La Marque', 'La Porte', 'Deer Park',
  'Seabrook', 'Kemah', 'Mont Belvieu', 'New Caney', 'Porter', 'Splendora', 'Atascocita', 'Manvel',
  'Iowa Colony', 'Rosharon', 'Floresville', 'Pleasanton', 'Castroville', 'Hondo', 'Canyon Lake',
  'Wimberley', 'Lago Vista', 'Liberty Hill', 'Jarrell', 'Florence', 'Burnet', 'Llano', 'Giddings',
  'La Grange', 'Columbus', 'Schulenburg', 'Hallettsville', 'Yoakum', 'Cuero', 'Port Lavaca', 'Beeville',
  'Alice', 'Robstown', 'Portland', 'Aransas Pass', 'Ingleside', 'Sinton', 'Rio Grande City', 'Zapata',
  'Hereford', 'Dumas', 'Pampa', 'Borger', 'Plainview', 'Levelland', 'Snyder', 'Sweetwater', 'Andrews',
  'Monahans', 'Kermit', 'Seminole', 'Lamesa', 'Vernon', 'Graham', 'Decatur', 'Bridgeport', 'Bowie',
  'Hidalgo County', 'Nueces County', 'Cameron County', 'Webb County', 'McLennan County', 'Smith County',
  'Midlothian'
] as const;

/** Real Texas places whose names also belong to well-known places elsewhere. TX marker required. */
const AMBIGUOUS_PLACES = [
  'Paris', 'Athens', 'Victoria', 'Palestine', 'Columbia', 'Lancaster', 'Lewisville', 'Odessa', 'Pasadena',
  'Richmond', 'Portland', 'Columbus', 'Jacksonville', 'Henderson', 'Marshall', 'Orange', 'Mission',
  'Cleveland', 'Liberty', 'Florence', 'Princeton', 'Taylor', 'Temple', 'Canyon', 'Alpine', 'Graham',
  'Decatur', 'Vernon', 'Anna', 'Alice', 'Porter', 'Montgomery', 'Dayton', 'Seminole', 'Midlothian'
];

const PLACE_KEYS: [string, string][] = PLACES.filter((place) => !AMBIGUOUS_PLACES.includes(place))
  .map((place) => [place.toLowerCase(), place] as [string, string])
  .sort((a, b) => b[0].length - a[0].length);

const ALL_PLACE_KEYS: [string, string][] = [...PLACES, ...AMBIGUOUS_PLACES]
  .map((place) => [place.toLowerCase(), place] as [string, string])
  .sort((a, b) => b[0].length - a[0].length);

/** The label for a Texas posting that names no city ('Texas', 'Remote - TX', 'Multiple Texas locations'). */
export const STATEWIDE = 'Texas';

/** US state markers other than Texas, used to reject out-of-state postings. */
const OTHER_STATES =
  /\b(a[klrz]|c[aot]|d[ce]|fl|ga|hi|i[adln]|k[sy]|la|m[adeinost]|n[cdehjmvy]|o[hkr]|pa|ri|s[cd]|tn|ut|v[at]|w[aivy])\b|\b(alabama|alaska|arizona|arkansas|california|colorado|connecticut|delaware|florida|georgia|hawaii|idaho|illinois|indiana|iowa|kansas|kentucky|louisiana|maine|maryland|massachusetts|michigan|minnesota|mississippi|missouri|montana|nebraska|nevada|new hampshire|new jersey|new mexico|new york|north carolina|north dakota|ohio|oklahoma|oregon|pennsylvania|rhode island|south carolina|south dakota|tennessee|utah|vermont|virginia|washington|west virginia|wisconsin|wyoming)\b/;

const TEXAS = /\b(tx|texas)\b/;

const CITY_KEYS: [string, City][] = [
  ...CITIES.map((c) => [c.toLowerCase(), c] as [string, City]),
  ...Object.entries(ALIASES)
].sort((a, b) => b[0].length - a[0].length);

/**
 * Resolve a free-text ATS location to a Texas place, or null when the posting
 * is not in Texas.
 *
 * Policy, in order, per segment (boards routinely list several offices):
 *  1. A tracked city or one of its suburbs wins if the segment carries a Texas
 *     marker or names no other state. Suburbs roll up to their metro, as they
 *     always have, so posting ids and history stay stable.
 *  2. A known Texas place outside the metros (Corpus Christi, Tyler) is kept
 *     under its own name, on the same terms.
 *  3. A segment with an explicit Texas marker and an unknown town keeps that
 *     town's name; one with no usable town ('Texas', 'Remote - TX',
 *     'Multiple Locations, TX') becomes STATEWIDE.
 *  4. A segment naming another state is skipped, so 'Austin, MN' is not Texas
 *     and 'New York, NY; Dallas, TX' resolves to Dallas. Bare 'Remote' is not
 *     Texas.
 */
export function resolveCity(location: string): string | null {
  if (!location) return null;
  const cleaned = location.toLowerCase().replace(/\s+/g, ' ').trim();
  let statewide = false;

  for (const segment of cleaned.split(/[;|/]|(?:,?\s+(?:and|or)\s+)|•/)) {
    const seg = segment.trim();
    if (!seg) continue;
    const marked = TEXAS.test(seg);

    const cityHit = matchKey(seg, CITY_KEYS);
    const placeHit = matchKey(seg, marked ? ALL_PLACE_KEYS : PLACE_KEYS);
    // 'Big Spring' is a place, not the Houston suburb Spring: the longer name wins.
    const city = cityHit && (!placeHit || cityHit[0].length >= placeHit[0].length) ? cityHit[1] : null;
    if (city) {
      if (marked) return city;
      const withoutCity = seg.replace(cityPattern(city), ' ');
      if (!OTHER_STATES.test(withoutCity)) return city;
      continue;
    }

    const place = placeHit?.[1];
    if (place) {
      if (marked) return place;
      const withoutPlace = seg.replace(new RegExp(escapeRegExp(place.toLowerCase()), 'g'), ' ');
      if (!OTHER_STATES.test(withoutPlace)) return place;
      continue;
    }

    if (marked) {
      const town = unknownTown(seg);
      if (town) return town;
      statewide = true;
    }
  }

  return statewide ? STATEWIDE : null;
}

function matchKey<T extends string>(segment: string, keys: [string, T][]): [string, T] | null {
  for (const entry of keys) {
    if (new RegExp(`(^|[^a-z])${escapeRegExp(entry[0])}([^a-z]|$)`).test(segment)) return entry;
  }
  return null;
}

const FILLER = /\b(tx|texas|usa|us|united states( of america)?|remote|hybrid|on-?site|in-?office|office|field|based|multiple|various|locations?|statewide|any|area|region|metro|greater|city of|us-tx)\b/g;

/**
 * The town in a TX-marked segment Terra has no list entry for ('Seguin, TX'
 * is listed; 'Kountze, TX' is not). Only a short, letters-only remainder is
 * trusted as a name; anything else is a statewide posting.
 */
function unknownTown(segment: string): string | null {
  // 'Broadstone Baybrook - Webster, TX': the town is the last piece before the marker.
  const pieces = segment.split(/\b(?:tx|texas)\b/)[0]!.split(/[,–—]| - /).map((piece) => piece.trim()).filter(Boolean);
  const rest = (pieces.at(-1) ?? '')
    .replace(FILLER, ' ')
    .replace(/[^a-z' .-]/g, ' ')
    .replace(/[-.]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!rest || rest.length < 3) return null;
  const words = rest.split(' ');
  if (words.length > 3) return null;
  if (OTHER_STATES.test(rest)) return null;
  return words.map((word) => word.charAt(0).toUpperCase() + word.slice(1)).join(' ');
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
