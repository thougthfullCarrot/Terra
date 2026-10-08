// property.js — the Property tab's rules, as plain functions with no DOM, so
// the backend's tests cover them. property-view.js draws the five tools:
//
//   owner     "Who owns this?": a parcel's owner from the county appraisal
//             district's public map, then the owner's state franchise tax
//             record and every other parcel the owner or its mailing address
//             holds.
//   leases    Lease radar: tenants building out new space (TDLR filings) and
//             office leases public companies say are ending (SEC 10-Ks).
//   distress  Tax sale auctions and the biggest tax-delinquent accounts.
//   drive     Drive-time rings: people and jobs within 10, 20 and 30 minutes.
//   deal      Deal of the week: one Texas sale, walked through step by step.

export const PROPERTY_TOOLS = [
  ['owner', 'Who owns this?'],
  ['leases', 'Lease radar'],
  ['distress', 'Distress'],
  ['drive', 'Drive time'],
  ['deal', 'Deal of the week']
];

/** #property&tool=drive&city=Houston → { open, tool, city }. */
export function readPropertyHash(hash) {
  const params = new URLSearchParams(String(hash ?? '').replace(/^#/, ''));
  const tool = params.get('tool');
  return {
    open: params.has('property'),
    tool: PROPERTY_TOOLS.some(([key]) => key === tool) ? tool : 'owner',
    city: params.get('city') ?? '',
    q: params.get('q') ?? '',
    lat: finite(params.get('lat')),
    lng: finite(params.get('lng'))
  };
}

export function writePropertyHash(state) {
  const params = new URLSearchParams();
  if (state.tool && state.tool !== 'owner') params.set('tool', state.tool);
  if (state.city) params.set('city', state.city);
  if (state.q) params.set('q', state.q);
  if (state.lat != null && state.lng != null) {
    params.set('lat', String(round(state.lat, 5)));
    params.set('lng', String(round(state.lng, 5)));
  }
  const text = params.toString();
  return `#property${text ? `&${text}` : ''}`;
}

// ---------------------------------------------------------------- who owns this

/**
 * The appraisal district parcel maps the lookup searches, straight from the
 * browser (each is a public ArcGIS layer that allows it). Fields differ per
 * district; read() turns a record into one shape.
 */
export const OWNER_SOURCES = [
  {
    county: 'Harris',
    site: 'https://hcad.org/property-search/',
    cities: ['Houston', 'Galveston'],
    name: 'Harris Central Appraisal District (City of Houston map)',
    layer: 'https://mycity2.houstontx.gov/gisweb02/rest/services/HoustonMap/Cadastral/MapServer/0',
    address: 'SITE_ADDR_1',
    owner: 'OWNER_LIST',
    mail: 'MAIL_ADDR_1',
    read: (a) => ({
      account: str(a.TAX_ID),
      address: joinParts(a.SITE_ADDR_1, a.SITE_ADDR_2),
      owner: str(a.OWNER_LIST) || str(a.OWNER_MAILTO),
      mail: joinParts(a.MAIL_ADDR_1, a.MAIL_ADDR_2, a.MAIL_CITY, a.MAIL_STATE, a.MAIL_ZIP),
      mailLine: str(a.MAIL_ADDR_1),
      value: num(a.TOTAL_APPRAISED_VALUE) ?? num(a.TOTAL_MARKET_VALUE),
      code: str(a.STATE_CLASS),
      use: str(a.LANDUSE_DSCR),
      landSqft: num(a.TOTAL_LAND_AREA),
      buildingSqft: num(a.TOTAL_BUILDING_AREA),
      built: num(a.YR_IMPR),
      acquired: epochDate(a.NEW_OWNER_DATE),
      url: null
    })
  },
  {
    county: 'Dallas',
    site: 'https://www.dallascad.org/',
    cities: ['Dallas'],
    name: 'Dallas Central Appraisal District roll (public ArcGIS copy)',
    layer: 'https://services.arcgis.com/6dxqrE38upDMg1va/arcgis/rest/services/Dallas_Co_Parcels/FeatureServer/0',
    address: 'SITUS_ADDR',
    owner: 'OWNER_NAME',
    mail: 'MAIL_LINE1',
    read: (a) => ({
      account: str(a.Prop_ID),
      address: str(a.SITUS_ADDR).replace(/\s*,\s*/g, ', ').replace(/(\d{5})\d{4}$/, '$1'),
      owner: [str(a.OWNER_NAME), str(a.NAME_CARE)].filter(Boolean).join(' '),
      mail: joinParts(a.MAIL_LINE1, a.MAIL_LINE2, a.MAIL_CITY, a.MAIL_STAT, String(a.MAIL_ZIP ?? '').slice(0, 5)),
      mailLine: str(a.MAIL_LINE1),
      value: num(a.MKT_VALUE),
      code: str(a.STAT_LAND_),
      use: str(a.LOC_LAND_U),
      landSqft: acresToSqft(num(String(a.LEGAL_AREA ?? '').replace(/[^\d.]/g, ''))),
      buildingSqft: null,
      built: num(a.YEAR_BUILT),
      acquired: yyyymmdd(a.DATE_ACQ),
      url: a.Prop_ID ? `https://www.dallascad.org/AcctDetailCom.aspx?ID=${encodeURIComponent(str(a.Prop_ID))}` : null
    })
  },
  {
    county: 'Tarrant',
    site: 'https://www.tad.org/',
    cities: ['Fort Worth'],
    name: 'Tarrant Appraisal District (City of Fort Worth map)',
    layer: 'https://services5.arcgis.com/3ddLCBXe1bRt7mzj/arcgis/rest/services/Parcels_Public_Vview/FeatureServer/0',
    address: 'SITUS_ADDR',
    owner: 'OWNER_NAME',
    mail: 'OWNER_ADDRESS',
    read: (a) => ({
      account: str(a.ACCOUNT),
      address: joinParts(a.SITUS_ADDR, a.CITYNAME),
      owner: str(a.OWNER_NAME),
      mail: joinParts(a.OWNER_ADDRESS, a.OWNER_CITY_ST, a.OWNER_ZIP_CODE),
      mailLine: str(a.OWNER_ADDRESS),
      value: num(a.APPRAISED_VALUE) ?? num(a.MARKET_VALUE),
      code: str(a.STATE_USE_CODE),
      use: str(a.BUILDING_TYPE),
      landSqft: num(a.LAND_SQFT),
      buildingSqft: num(a.LIVING_AREA),
      built: num(a.YR_BUILT),
      acquired: epochDate(a.DEED_DATE) ?? (typeof a.DEED_DATE === 'string' ? a.DEED_DATE.slice(0, 10) : null),
      url: a.ACCOUNT ? `https://www.tad.org/property?account=${encodeURIComponent(str(a.ACCOUNT))}` : null
    })
  },
  {
    county: 'Bexar',
    site: 'https://www.bcad.org/',
    cities: ['San Antonio', 'New Braunfels'],
    name: 'Bexar Appraisal District (San Antonio River Authority copy)',
    layer: 'https://gis.sara-tx.org/ags1/rest/services/FW_Bexar/BCAD_Parcels_PROD/FeatureServer/0',
    address: 'Situs',
    owner: 'Owner_name',
    mail: 'Addr_line1',
    read: (a) => ({
      account: str(a.Prop_id),
      address: str(a.Situs),
      owner: str(a.Owner_name),
      mail: joinParts(a.Addr_line1, a.Addr_line2, a.Addr_line3, a.Addr_city, a.Addr_state, a.Zip),
      mailLine: str(a.Addr_line1) || str(a.Addr_line2),
      value: num(a.Market_val),
      code: str(a.State_cd),
      use: str(a.Property_use_cd),
      landSqft: acresToSqft(num(a.Land_acres)),
      buildingSqft: num(a.Sq_ft),
      built: num(a.Yr_blt),
      acquired: epochDate(a.Last_Deed_Date),
      url: a.Prop_id ? `https://bexar.trueautomation.com/clientdb/Property.aspx?cid=110&prop_id=${encodeURIComponent(str(a.Prop_id))}` : null
    })
  },
  {
    county: 'Travis',
    site: 'https://traviscad.org/',
    cities: ['Austin'],
    name: 'Travis Central Appraisal District (public ArcGIS copy)',
    layer: 'https://services1.arcgis.com/HGcSYZ5bvjRswoCb/arcgis/rest/services/TCAD_Parcels_Dec_2025/FeatureServer/0',
    address: 'situs_address',
    owner: 'py_owner_name',
    mail: 'py_address',
    read: (a) => ({
      account: str(a.PROP_ID),
      address: str(a.situs_address),
      owner: str(a.py_owner_name),
      mail: str(a.py_address),
      mailLine: str(a.py_address).split(/,|\s{2,}/)[0] ?? '',
      value: num(a.market_value),
      code: str(a.land_state_cd),
      use: str(a.land_type_desc),
      landSqft: acresToSqft(num(a.GIS_acres) ?? num(a.tcad_acres)),
      buildingSqft: null,
      built: num(a.F1year_imprv),
      acquired: epochDate(a.deed_date) ?? (typeof a.deed_date === 'string' ? a.deed_date.slice(0, 10) : null),
      url: a.PROP_ID ? `https://travis.prodigycad.com/property-detail/${encodeURIComponent(str(a.PROP_ID))}` : null
    })
  }
];

const STREET_WORDS = {
  STREET: 'ST', AVENUE: 'AVE', BOULEVARD: 'BLVD', DRIVE: 'DR', ROAD: 'RD', LANE: 'LN', PARKWAY: 'PKWY', FREEWAY: 'FWY',
  HIGHWAY: 'HWY', COURT: 'CT', PLACE: 'PL', CIRCLE: 'CIR', TRAIL: 'TRL', EXPRESSWAY: 'EXPY', NORTH: 'N', SOUTH: 'S', EAST: 'E', WEST: 'W'
};
const DIRECTIONS = new Set(['N', 'S', 'E', 'W', 'NE', 'NW', 'SE', 'SW']);
const SUFFIXES = new Set(['ST', 'AVE', 'BLVD', 'DR', 'RD', 'LN', 'PKWY', 'FWY', 'HWY', 'CT', 'PL', 'CIR', 'TRL', 'EXPY', 'WAY']);

/** Upper-case words with street words shortened (STREET → ST) and ordinals bare (2ND → 2), so typed and recorded addresses compare. */
function addressTokens(text) {
  return String(text ?? '')
    .toUpperCase()
    .replace(/[^A-Z0-9 ]+/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => STREET_WORDS[w] ?? w.replace(/^(\d+)(ST|ND|RD|TH)$/, '$1'));
}

/**
 * "1000 N Main Street, Houston TX 77002" → { number: '1000', street: 'MAIN', dir: 'N', words: ['MAIN'] }:
 * the house number, the street's first distinctive word, every name word
 * before the suffix ("Overton Ridge"), and the direction before it, if any.
 * Every district's address field has these in the same order whatever else
 * it adds. null when there is no house number.
 */
export function parseAddress(text) {
  const words = addressTokens(String(text ?? '').split(',')[0]);
  const number = words[0];
  if (!number || !/^\d+[A-Z]?$/.test(number)) return null;
  // A direction leads only when a real street name follows it ("100 West Ave" is West Avenue).
  const dir = DIRECTIONS.has(words[1]) && words.slice(2).some((w) => !SUFFIXES.has(w)) ? words[1] : null;
  const rest = words.slice(dir ? 2 : 1);
  // "St Marys" and "Saint Marys" are written both ways, so the word after a leading ST is the one to look for.
  const named = (w) => !SUFFIXES.has(w) && w !== 'SAINT' && (w.length > 1 || /^\d+$/.test(w));
  const street = rest.find(named) ?? rest[0];
  if (!street) return null;
  const start = rest.indexOf(street);
  const end = rest.findIndex((w, i) => i > start && SUFFIXES.has(w));
  const words2 = rest.slice(start, end === -1 ? undefined : end).filter(named);
  const out = dir ? { number, street, dir } : { number, street };
  return words2.length > 1 ? { ...out, words: words2 } : out;
}

/** The city (or ZIP) typed after the street, upper case, or ''. "700 Louisiana St, Houston, TX 77002" → "HOUSTON". */
export function addressPlace(text) {
  const parts = String(text ?? '').toUpperCase().split(',').slice(1).map((p) => p.replace(/\b(TX|TEXAS)\b/g, '').replace(/[^A-Z0-9 ]+/g, ' ').trim());
  const city = parts.map((p) => p.replace(/\b\d{5}(\s?\d{4})?\b/g, '').trim()).find(Boolean);
  if (city) return city;
  return String(text ?? '').match(/\b(\d{5})(-\d{4})?\s*$/)?.[1] ?? '';
}

const sql = (text) => String(text).replace(/'/g, "''");

/**
 * The where clause for an address: the house number at the start, the street
 * word after it. Kept to one plain pattern because some district servers take
 * seconds per pattern; sameStreet() then drops 1601 Belmont from a search for
 * 1601 Elm in the browser.
 */
export function addressWhere(source, address) {
  const parsed = parseAddress(address);
  if (!parsed) return null;
  return `UPPER(${source.address}) LIKE '${sql(parsed.number)} %${sql(parsed.street)}%'`;
}

/**
 * Whether a parcel's address is the one typed: the house number first, the
 * direction (when both have one) the same, and every street name word whole,
 * so 1601 Belmont isn't 1601 Elm and 301 S 2nd isn't 301 W 2nd.
 */
export function sameStreet(parcel, address) {
  const parsed = parseAddress(address);
  if (!parsed) return false;
  const tokens = addressTokens(parcel?.address);
  if (tokens[0] !== parsed.number) return false;
  if (parsed.dir && DIRECTIONS.has(tokens[1]) && tokens[1] !== parsed.dir) return false;
  return (parsed.words ?? [parsed.street]).every((w) => tokens.includes(w));
}

/**
 * Best match first: the house number at the very start, the typed direction,
 * the typed city (or the market's) in the address, then the closest in length.
 */
export function rankAddresses(parcels, address, city = '') {
  const parsed = parseAddress(address);
  if (!parsed) return parcels;
  const place = addressPlace(address) || String(city ?? '').toUpperCase();
  const score = (p) => {
    const a = ` ${String(p.address ?? '').toUpperCase().replace(/[^A-Z0-9]+/g, ' ')} `;
    let s = 0;
    if (!a.startsWith(` ${parsed.number} `)) s += 8;
    if (!a.includes(` ${parsed.street} `)) s += 4;
    if (parsed.dir && !a.includes(` ${parsed.number} ${parsed.dir} `)) s += 2;
    if (place && !a.includes(` ${place} `)) s += 1;
    return s;
  };
  return parcels.map((p, i) => [score(p), i, p]).sort((x, y) => x[0] - y[0] || x[1] - y[1]).map((x) => x[2]);
}

/** The where clause for every parcel an owner name (or a mailing address line) holds. */
export function ownerWhere(source, { owner, mailLine } = {}) {
  if (owner) return `UPPER(${source.owner}) = '${sql(owner.toUpperCase())}'`;
  if (mailLine) return `UPPER(${source.mail}) = '${sql(mailLine.toUpperCase())}'`;
  return null;
}

// Words a company's name may or may not carry on the roll ("Lincoln Property" is "LINCOLN PROPERTY CO" in one county, "LPC ..." in another).
const NAME_FILLER = new Set(['THE', 'LLC', 'LP', 'LLP', 'LTD', 'INC', 'CO', 'CORP', 'COMPANY', 'CORPORATION', 'PROPERTY', 'PROPERTIES', 'GROUP', 'PARTNERS', 'REALTY', 'HOLDINGS', 'TRUST']);

/** The words of an owner search that must match, upper case. */
export function ownerWords(name) {
  const words = String(name ?? '').toUpperCase().replace(/[^A-Z0-9&' ]+/g, ' ').split(/\s+/).filter((w) => w.length > 1);
  const key = words.filter((w) => !NAME_FILLER.has(w));
  return key.length ? key : words;
}

/**
 * Parcels whose owner name has a word starting with each word typed (Hines
 * finds HINES REIT, not WHINES). `loose` leaves out words like Property and
 * Company, for a second try when the name as typed finds nothing.
 */
export function ownerLikeWhere(source, name, loose = false) {
  const words = loose ? ownerWords(name) : String(name ?? '').toUpperCase().replace(/[^A-Z0-9&' ]+/g, ' ').split(/\s+/).filter((w) => w.length > 1);
  if (!words.length) return null;
  const field = `UPPER(${source.owner})`;
  return words.map((w) => `(${field} LIKE '${sql(w)}%' OR ${field} LIKE '% ${sql(w)}%')`).join(' AND ');
}

/** Owner search results, companies before people, the ones carrying every typed word (fillers too) first. */
export function rankOwners(parcels, name) {
  const all = String(name ?? '').toUpperCase().replace(/[^A-Z0-9&' ]+/g, ' ').split(/\s+/).filter((w) => w.length > 1);
  const score = (p) => {
    const owner = ` ${String(p.owner ?? '').toUpperCase().replace(/[^A-Z0-9&']+/g, ' ')} `;
    // A family trust is a person's holding; LLCs, LPs and companies are what a firm owns through.
    const kind = !isEntity(p.owner) ? 4 : /\b(TRUST|ESTATE OF|FAMILY|LIVING)\b/.test(owner) ? 2 : 0;
    return kind + (owner.startsWith(` ${all[0]} `) ? 0 : 1) + all.filter((w) => !owner.includes(` ${w} `)).length;
  };
  return parcels.map((p, i) => [score(p), i, p]).sort((x, y) => x[0] - y[0] || x[1] - y[1]).map((x) => x[2]);
}

/** A layer query URL for the browser. */
export function parcelQueryUrl(source, where, count = 25) {
  const params = new URLSearchParams({ f: 'json', where, outFields: '*', returnGeometry: 'false', resultRecordCount: String(count) });
  return `${source.layer}/query?${params}`;
}

// ---------------------------------------------------------------- every Texas county

/**
 * The state's parcel map (Texas Geographic Information Office, StratMap Land
 * Parcels): every appraisal district's roll in one schema, free and open to
 * the browser. It can't be searched by text, only asked what parcel sits at a
 * point, so an address is first turned into a point (OpenStreetMap's free
 * geocoder) and then looked up there.
 */
export const STATEWIDE_PARCELS = 'https://feature.geographic.texas.gov/arcgis/rest/services/Parcels/stratmap_land_parcels_48_most_recent/MapServer';

/** The free OpenStreetMap geocoder, for a full Texas street address. */
export function geocodeUrl(address) {
  const params = new URLSearchParams({ q: address, format: 'jsonv2', countrycodes: 'us', limit: '3', addressdetails: '1' });
  return `https://nominatim.openstreetmap.org/search?${params}`;
}

/** The point inside Texas from a geocoder answer, or null. */
export function readGeocode(body) {
  for (const hit of body ?? []) {
    const lat = Number(hit.lat);
    const lng = Number(hit.lon);
    if (Number.isFinite(lat) && Number.isFinite(lng) && (hit.address?.state ?? 'Texas') === 'Texas') return { lat, lng };
  }
  return null;
}

/** Parcels within about 40 m of a point (wider: the pixels to reach, about 5 m each). */
export function identifyUrl({ lat, lng }, tolerance = 8) {
  const d = 0.002;
  const params = new URLSearchParams({
    f: 'json',
    geometry: `${lng},${lat}`,
    geometryType: 'esriGeometryPoint',
    sr: '4326',
    layers: 'all',
    tolerance: String(tolerance),
    mapExtent: `${lng - d},${lat - d},${lng + d},${lat + d}`,
    imageDisplay: '800,800,96',
    returnGeometry: 'false'
  });
  return `${STATEWIDE_PARCELS}/identify?${params}`;
}

const nul = (v) => (str(v) === 'Null' ? '' : str(v));

/** A statewide record in the same shape as a county one; its source names the county. */
export function readStatewide(a) {
  const county = titleWords(nul(a.COUNTY));
  const acquired = nul(a.DATE_ACQ);
  return {
    account: nul(a.PROP_ID),
    address: nul(a.SITUS_ADDR)
      .replace(/\s+,/g, ',')
      .replace(/,(\s*,)+/g, ',')
      .replace(/\s*0{5,}$/, '')
      .replace(/,\s*TX$/, '')
      .replace(/(\d{5})-?\d{4}$/, '$1'),
    owner: [...new Set([nul(a.OWNER_NAME), nul(a.NAME_CARE)].filter(Boolean))].join(' '),
    mail: nul(a.MAIL_ADDR).replace(/(,\s*)+/g, ', ').replace(/(\d{5})-?\d{4}$/, '$1'),
    mailLine: nul(a.MAIL_LINE1),
    value: num(nul(a.MKT_VALUE)),
    code: nul(a.STAT_LAND_USE),
    use: nul(a.LOC_LAND_USE),
    landSqft: nul(a.LEGAL_AREA) && !nul(a.LGL_AREA_UNIT).match(/SQ/i) ? acresToSqft(num(nul(a.LEGAL_AREA))) : num(nul(a.LEGAL_AREA)),
    buildingSqft: null,
    built: num(nul(a.YEAR_BUILT)),
    acquired: /^\d{5}$/.test(acquired) ? new Date(Date.UTC(1899, 11, 30) + Number(acquired) * 86_400_000).toISOString().slice(0, 10) : yyyymmdd(acquired),
    url: null,
    source: { county, name: `${titleWords(nul(a.SOURCE)) || `${county} County appraisal district`} (state parcel map)`, statewide: true }
  };
}

/**
 * The parcels an identify answer holds, the one whose house number matches the
 * address first (a geocoded point can land on the street or the next lot).
 */
export function pickStatewide(body, address) {
  const parsed = parseAddress(address);
  const parcels = (body?.results ?? []).map((r) => readStatewide(r.attributes ?? {})).filter((p) => p.owner || p.address);
  const unique = [...new Map(parcels.map((p) => [`${p.source.county}|${p.account}`, p])).values()];
  const score = (p) => (parsed && p.address.toUpperCase().startsWith(`${parsed.number} `) ? 0 : 1) + (parsed && p.address.toUpperCase().includes(parsed.street) ? 0 : 1);
  return unique.sort((a, b) => score(a) - score(b));
}

/**
 * Whether an address says where it is (a city after a comma, TX or a ZIP), so
 * the geocoder can place it anywhere in Texas: "700 Louisiana St, Houston" or
 * "700 Louisiana St Houston TX" both do; "700 Louisiana St" alone doesn't.
 */
export function isFullAddress(text) {
  const t = String(text ?? '').trim();
  return Boolean(parseAddress(t)) && (/,\s*[A-Za-z]{2,}/.test(t) || /\b(TX|Texas)\b\.?\s*(\d{5}(-\d{4})?)?$/i.test(t) || /\b\d{5}(-\d{4})?$/.test(t));
}

/** The address as the geocoder should see it: the market's city added when none was typed. */
export function geocodeText(address, city) {
  const t = String(address ?? '').trim();
  return isFullAddress(t) || !city ? t : `${t}, ${city}, TX`;
}

function titleWords(s) {
  return String(s ?? '').toLowerCase().replace(/\b([a-z])/g, (c) => c.toUpperCase());
}

/** Which districts to search for a market: its own first, then the rest. */
export function sourcesFor(city) {
  const own = OWNER_SOURCES.filter((s) => s.cities.includes(city));
  return own.length ? [...own, ...OWNER_SOURCES.filter((s) => !own.includes(s))] : OWNER_SOURCES;
}

/** An owner that is a company, trust or partnership rather than a person. */
export function isEntity(owner) {
  return /\b(LLC|L\.L\.C|LP|L\.P|LLP|LTD|INC|CORP|CORPORATION|COMPANY|CO|TRUST|PARTNERS|PARTNERSHIP|HOLDINGS|PROPERTIES|INVESTMENTS|FUND|REIT|ASSOCIATES|VENTURES|GROUP|CAPITAL|REALTY|EQUITIES)\b/i.test(
    String(owner ?? '')
  );
}

/** The entity's name without "ET AL", "%" care-of lines and trailing punctuation, for the state lookup. */
export function entityName(owner) {
  return String(owner ?? '')
    .toUpperCase()
    .split(/\s+%|\bC\/O\b|\bATTN\b|\bET AL\b/)[0]
    .replace(/[.,]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * The Texas Comptroller's list of franchise tax permit holders on the state
 * open data portal (free, no key, readable from the browser): the entity's
 * mailing address, state file number and standing.
 */
export function franchiseUrl(name) {
  // Word by word, so "ACME PROPERTIES LLC" finds "ACME PROPERTIES, L.L.C."; the suffix is left off for the same reason.
  const words = entityName(name)
    .replace(/[^A-Z0-9&' ]/g, ' ')
    .split(/\s+/)
    .filter((w) => w && !ENTITY_SUFFIX.has(w));
  const where = `upper(taxpayer_name) like '${sql(words.join('%'))}%'`;
  return `https://data.texas.gov/resource/9cir-efmm.json?${new URLSearchParams({ $where: where, $limit: '10' })}`;
}

const ENTITY_SUFFIX = new Set(['LLC', 'L', 'C', 'LP', 'P', 'LLP', 'LTD', 'INC', 'CORP', 'CO', 'THE', 'A', 'TEXAS']);

/** Two company names written the same way once punctuation and spacing are set aside. */
export function sameEntity(a, b) {
  const norm = (n) => String(n ?? '').toUpperCase().replace(/[^A-Z0-9]+/g, '');
  return norm(a) === norm(b);
}

/** The Comptroller's own page for a taxpayer: officers, directors and registered agent (its public information report). */
export const comptrollerUrl = (taxpayerNumber) => `https://comptroller.texas.gov/taxes/franchise/account-status/search/${encodeURIComponent(taxpayerNumber)}`;
export const openCorporatesUrl = (name) => `https://opencorporates.com/companies/us_tx?${new URLSearchParams({ q: entityName(name) })}`;

/** A franchise tax row as the page shows it. */
export function readFranchise(row) {
  if (!row) return null;
  return {
    name: str(row.taxpayer_name),
    number: str(row.taxpayer_number),
    address: joinParts(row.taxpayer_address, row.taxpayer_city, row.taxpayer_state, row.taxpayer_zip),
    fileNumber: str(row.secretary_of_state_sos_or_coa_file_number),
    since: typeof row.sos_charter_date === 'string' ? row.sos_charter_date.slice(0, 10) : null,
    active: row.right_to_transact_business_code === 'A'
  };
}

// ---------------------------------------------------------------- drive time

/** Drive times the rings show, in minutes. */
export const DRIVE_MINUTES = [10, 20, 30];
/** When the routing server can't answer, circles at this average speed stand in. */
export const FALLBACK_MPH = 30;

/** The public Valhalla server (FOSSGIS, OpenStreetMap roads, free, no key) as one isochrone request. */
export function isochroneUrl(lat, lng, minutes = DRIVE_MINUTES) {
  const body = {
    locations: [{ lat: round(lat, 5), lon: round(lng, 5) }],
    costing: 'auto',
    contours: minutes.map((time) => ({ time })),
    polygons: true,
    generalize: 100
  };
  return `https://valhalla1.openstreetmap.de/isochrone?json=${encodeURIComponent(JSON.stringify(body))}`;
}

/** Ray casting on one ring of [lng, lat] pairs. */
export function inRing(lng, lat, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > lat !== yj > lat && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** A GeoJSON Polygon or MultiPolygon contains the point (holes respected). */
export function inGeometry(lng, lat, geometry) {
  const polygons = geometry?.type === 'MultiPolygon' ? geometry.coordinates : geometry?.type === 'Polygon' ? [geometry.coordinates] : [];
  return polygons.some((rings) => rings.length > 0 && inRing(lng, lat, rings[0]) && !rings.slice(1).some((hole) => inRing(lng, lat, hole)));
}

/** People, jobs and tracts whose center falls inside the area. tracts are [lat, lng, people, jobs]. */
export function sumInside(tracts, geometry) {
  const box = bounds(geometry);
  let people = 0;
  let jobs = 0;
  let count = 0;
  for (const [lat, lng, pop, work] of tracts ?? []) {
    if (box && (lng < box[0] || lng > box[2] || lat < box[1] || lat > box[3])) continue;
    if (!inGeometry(lng, lat, geometry)) continue;
    people += pop;
    jobs += work;
    count++;
  }
  return { people, jobs, tracts: count };
}

function bounds(geometry) {
  const polygons = geometry?.type === 'MultiPolygon' ? geometry.coordinates : geometry?.type === 'Polygon' ? [geometry.coordinates] : [];
  let box = null;
  for (const rings of polygons) {
    for (const [x, y] of rings[0] ?? []) {
      box = box ? [Math.min(box[0], x), Math.min(box[1], y), Math.max(box[2], x), Math.max(box[3], y)] : [x, y, x, y];
    }
  }
  return box;
}

/** A circle as a GeoJSON polygon: the straight-line stand-in when routing is down. */
export function circle(lat, lng, miles, steps = 64) {
  const dLat = miles / 69.0;
  const dLng = miles / (69.0 * Math.cos((lat * Math.PI) / 180));
  const ring = [];
  for (let i = 0; i <= steps; i++) {
    const a = (i / steps) * 2 * Math.PI;
    ring.push([round(lng + dLng * Math.cos(a), 5), round(lat + dLat * Math.sin(a), 5)]);
  }
  return { type: 'Polygon', coordinates: [ring] };
}

/** Valhalla's answer as { minutes, geometry } smallest first. */
export function readIsochrones(body) {
  return (body?.features ?? [])
    .map((f) => ({ minutes: Number(f.properties?.contour), geometry: f.geometry }))
    .filter((r) => Number.isFinite(r.minutes) && r.geometry)
    .sort((a, b) => a.minutes - b.minutes);
}

// ---------------------------------------------------------------- lists

/**
 * Lease radar rows for a market (or all): upcoming move-ins soonest first, then
 * ones already finished, most recent first, then any without a date.
 */
export function filterMoves(moves, city = '', today = new Date().toISOString().slice(0, 10)) {
  const rank = (m) => (!m.end ? 2 : m.end >= today ? 0 : 1);
  return (moves ?? [])
    .filter((m) => !city || m.city === city)
    .sort((a, b) => rank(a) - rank(b) ||
      (rank(a) === 1 ? b.end.localeCompare(a.end) : (a.end ?? '').localeCompare(b.end ?? '')) ||
      (b.squareFeet ?? 0) - (a.squareFeet ?? 0));
}

/** Tax sale rows for a market (or all), soonest auction first; listings with no date after. */
export function filterSales(sales, { city = '', scheduledOnly = false } = {}) {
  return (sales ?? [])
    .filter((s) => (!city || s.city === city) && (!scheduledOnly || s.saleDate))
    .sort((a, b) => (a.saleDate ?? '9999').localeCompare(b.saleDate ?? '9999') || (b.value ?? 0) - (a.value ?? 0));
}

// ---------------------------------------------------------------- formatting

/**
 * Where a tax-sale row links: a map of the property. The auction sites'
 * listing pages expire after each sale and their home pages need an account,
 * so the row links neither.
 */
export function saleLinks(sale) {
  const where = sale.lat != null && sale.lng != null
    ? `${sale.lat},${sale.lng}`
    : [sale.address, sale.place, 'TX', sale.zip].filter(Boolean).join(', ');
  return [{ label: 'Map', url: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(where)}` }];
}

export function money(value) {
  if (value == null || !Number.isFinite(value)) return '—';
  const abs = Math.abs(value);
  if (abs >= 1e9) return `$${trim(value / 1e9)}B`;
  if (abs >= 1e6) return `$${trim(value / 1e6)}M`;
  if (abs >= 1e4) return `$${Math.round(value / 1e3).toLocaleString('en-US')}K`;
  return `$${Math.round(value).toLocaleString('en-US')}`;
}

export function count(value) {
  if (value == null || !Number.isFinite(value)) return '—';
  if (value >= 1e6) return `${trim(value / 1e6)} million`;
  return Math.round(value).toLocaleString('en-US');
}

const trim = (v) => (Math.abs(v) >= 100 ? Math.round(v).toString() : v.toFixed(1).replace(/\.0$/, ''));

function str(v) {
  return typeof v === 'string' ? v.replace(/\s+/g, ' ').trim() : v == null ? '' : String(v).trim();
}
function num(v) {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() ? Number(v) : NaN;
  return Number.isFinite(n) && n > 0 ? n : null;
}
function finite(v) {
  const n = v == null || v === '' ? NaN : Number(v);
  return Number.isFinite(n) ? n : null;
}
function joinParts(...parts) {
  return parts.map(str).filter(Boolean).join(', ');
}
function acresToSqft(acres) {
  return acres == null ? null : Math.round(acres * 43560);
}
function epochDate(v) {
  if (typeof v !== 'number' || !Number.isFinite(v) || v <= 0) return null;
  return new Date(v).toISOString().slice(0, 10);
}
function yyyymmdd(v) {
  const m = /^(\d{4})(\d{2})(\d{2})$/.exec(String(v ?? ''));
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
}
function round(v, digits) {
  return Math.round(v * 10 ** digits) / 10 ** digits;
}

// ---------------------------------------------------------------- deal of the week

/** The walk-through's loan: 60% of the price, 30-year amortization, priced at the 10-year Treasury plus this spread. */
export const DEAL_LOAN = { down: 40, closing: 1.5, years: 30, spread: 2 };

/**
 * The numbers the deal page walks through. The cap rate is the deal's own
 * when an override knows it, otherwise the assumed middle for its type
 * (assumptions from deal.json). analyze is deal.js's analyzeDeal.
 */
export function dealSteps(deal, file, analyze) {
  if (!deal) return null;
  const band = file?.assumptions?.[deal.type] ?? null;
  const cap = deal.capRate ?? band?.mid ?? null;
  const noi = deal.noi ?? (cap != null ? (deal.price * cap) / 100 : null);
  const treasury = file?.treasury?.value;
  const rate = Number.isFinite(treasury) ? Math.round((treasury + DEAL_LOAN.spread) * 20) / 20 : 6.5;
  const sqft = deal.squareFeet ?? (deal.pricePerSqft ? Math.round(deal.price / deal.pricePerSqft) : null);
  const steps = {
    price: deal.price,
    perSqft: deal.pricePerSqft ?? (sqft ? deal.price / sqft : null),
    perUnit: deal.units ? deal.price / deal.units : null,
    squareFeet: sqft,
    cap,
    capKnown: deal.capRate != null || deal.noi != null,
    band,
    noi,
    rate,
    loan: null
  };
  if (noi == null) return steps;
  const result = analyze({ price: deal.price, income: noi, vacancy: 0, expenses: 0, down: DEAL_LOAN.down, closing: DEAL_LOAN.closing, rate, years: DEAL_LOAN.years });
  // The loan constant: what the debt costs a year per dollar borrowed. Below the cap rate, borrowing raises the buyer's return.
  const constant = result.loan > 0 ? (result.debtService / result.loan) * 100 : null;
  steps.loan = {
    amount: result.loan,
    debtService: result.debtService,
    dscr: result.dscr,
    cashFlow: result.cashFlow,
    cashInvested: result.cashInvested,
    cashOnCash: result.cashOnCash,
    constant,
    leverage: constant == null || cap == null ? null : cap > constant + 0.1 ? 'positive' : cap < constant - 0.1 ? 'negative' : 'neutral'
  };
  return steps;
}

export const DEAL_TYPE_LABELS = {
  office: 'Office',
  industrial: 'Industrial',
  multifamily: 'Apartments',
  retail: 'Retail',
  hotel: 'Hotel',
  land: 'Land',
  other: 'Commercial property'
};
