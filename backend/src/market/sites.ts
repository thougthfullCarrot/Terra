import type { City } from '../types.js';

/**
 * The site finder: vacant commercial land, commercial buildings and
 * industrial buildings in each city, from the parcel maps that cities and
 * appraisal districts publish as free ArcGIS services, with each site's
 * zoning read from the city's zoning map at the parcel's center.
 *
 *   Houston       City of Houston cadastral layer (Harris County Appraisal District values). Houston has no zoning.
 *   Fort Worth    City of Fort Worth parcels (Tarrant Appraisal District values); city zoning map.
 *   San Antonio   San Antonio River Authority's copy of the Bexar Appraisal District parcels; city zoning map.
 *   Austin        Travis Central Appraisal District parcels (a public ArcGIS copy); city zoning map.
 *
 * Dallas, El Paso and the smaller markets publish parcel maps without values,
 * so they are not in the finder yet. Values are the appraisal district's,
 * not sale prices.
 */

export type SiteUse = 'land' | 'commercial' | 'industrial';
export const SITE_USES: SiteUse[] = ['land', 'commercial', 'industrial'];

/** State property codes per use: C2/C3 vacant commercial and other land, F1 commercial, F2 industrial. */
export const USE_CODES: Record<SiteUse, string[]> = { land: ['C2', 'C3'], commercial: ['F1'], industrial: ['F2'] };

export interface Site {
  id: string;
  city: City;
  use: SiteUse;
  /** The district's state code as given (F1, C2, F2...). */
  code: string;
  address: string;
  landSqft: number;
  landValue: number | null;
  value: number | null;
  /** Land value per square foot of land. */
  landPsf: number | null;
  built: number | null;
  buildingSqft: number | null;
  zoning: string | null;
  flood: string | null;
  lat: number | null;
  lng: number | null;
  /** The appraisal district's page for the parcel, where it has one. */
  url: string | null;
}

export interface SiteSource {
  city: City;
  name: string;
  /** The ArcGIS layer (…/MapServer/0 or …/FeatureServer/0). */
  layer: string;
  /** Where the user can see the source. */
  page: string;
  /** SQL for "inside this city"; null when the layer is already one city. */
  inCity: string | null;
  code: string;
  /** State codes per use where this district differs from USE_CODES. */
  codes?: Partial<Record<SiteUse, string[]>>;
  areaField: string;
  /** Land area in square feet from a record (some layers give acres). */
  area: (a: Attributes) => number | null;
  read: (a: Attributes) => Pick<Site, 'id' | 'address' | 'landValue' | 'value' | 'built' | 'buildingSqft' | 'flood' | 'url'> & { owner: string };
  zoning: { layer: string; field: string } | null;
  zoningNote?: string;
}

export type Attributes = Record<string, string | number | null | undefined>;

const SQFT_PER_ACRE = 43_560;
const num = (v: unknown): number | null => {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
};
const str = (v: unknown): string => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim() : v == null ? '' : String(v));
const positive = (v: number | null) => (v != null && v > 0 ? v : null);

export const SITE_SOURCES: SiteSource[] = [
  {
    city: 'Houston',
    name: 'City of Houston parcels (Harris Central Appraisal District values)',
    layer: 'https://mycity2.houstontx.gov/gisweb02/rest/services/HoustonMap/Cadastral/MapServer/0',
    page: 'https://cohgis-mycity.opendata.arcgis.com/',
    inCity: "SITE_ADDR_2='HOUSTON'",
    code: 'STATE_CLASS',
    areaField: 'TOTAL_LAND_AREA',
    area: (a) => positive(num(a.TOTAL_LAND_AREA)),
    read: (a) => ({
      id: str(a.TAX_ID),
      address: str(a.SITE_ADDR_1),
      landValue: num(a.LAND_VALUE),
      value: num(a.TOTAL_APPRAISED_VALUE),
      built: positive(num(a.YR_IMPR)),
      buildingSqft: positive(num(a.TOTAL_BUILDING_AREA)),
      flood: str(a.FLOOD_ZONE) || null,
      // HCAD's record pages sit behind a bot check, so there is no deep link; the account number is shown instead.
      url: null,
      owner: str(a.OWNER_LIST)
    }),
    zoning: null,
    zoningNote: 'Houston has no zoning; deed restrictions and city development rules apply instead.'
  },
  {
    city: 'Fort Worth',
    name: 'City of Fort Worth parcels (Tarrant Appraisal District values)',
    layer: 'https://services5.arcgis.com/3ddLCBXe1bRt7mzj/arcgis/rest/services/Parcels_Public_Vview/FeatureServer/0',
    page: 'https://data.fortworthtexas.gov/',
    inCity: "CITYNAME='FORT WORTH'",
    code: 'STATE_USE_CODE',
    areaField: 'LAND_SQFT',
    area: (a) => positive(num(a.LAND_SQFT)),
    read: (a) => ({
      id: str(a.ACCOUNT),
      address: str(a.SITUS_ADDR),
      landValue: num(a.LAND_VAL),
      value: num(a.APPRAISED_VALUE),
      built: positive(num(a.YR_BUILT)),
      buildingSqft: null,
      flood: null,
      url: a.ACCOUNT ? `https://www.tad.org/property?account=${encodeURIComponent(str(a.ACCOUNT))}` : null,
      owner: str(a.OWNER_NAME)
    }),
    zoning: { layer: 'https://mapit.fortworthtexas.gov/ags/rest/services/CIVIC/OpenData_Boundaries/MapServer/54', field: 'ZONING' }
  },
  {
    city: 'San Antonio',
    name: 'Bexar Appraisal District parcels (San Antonio River Authority copy)',
    layer: 'https://gis.sara-tx.org/ags1/rest/services/FW_Bexar/BCAD_Parcels_PROD/FeatureServer/0',
    page: 'https://www.bcad.org/',
    inCity: "Situs_Zip LIKE '782%'",
    code: 'State_cd',
    // Bexar files all vacant platted land as C1, not C2/C3.
    codes: { land: ['C1'] },
    areaField: 'Land_acres',
    area: (a) => {
      const acres = positive(num(a.Land_acres));
      return acres == null ? null : acres * SQFT_PER_ACRE;
    },
    read: (a) => ({
      id: str(a.Prop_id),
      address: str(a.Situs),
      landValue: (num(a.Land_hstd_val) ?? 0) + (num(a.Land_non_hstd_val) ?? 0) || null,
      value: num(a.Market_val),
      built: positive(num(a.Yr_blt)),
      buildingSqft: positive(num(a.Sq_ft)),
      flood: null,
      url: a.Prop_id ? `https://bexar.trueautomation.com/clientdb/Property.aspx?cid=110&prop_id=${encodeURIComponent(str(a.Prop_id))}` : null,
      owner: `${str(a.Owner_name)}${str(a.Ownership_Type) === 'Public' ? ' __PUBLIC__' : ''}`
    }),
    zoning: { layer: 'https://services.arcgis.com/g1fRTDLeMgspWrYp/arcgis/rest/services/COSA_Zoning/FeatureServer/12', field: 'Zoning' }
  },
  {
    city: 'Austin',
    name: 'Travis Central Appraisal District parcels (public ArcGIS copy)',
    layer: 'https://services1.arcgis.com/HGcSYZ5bvjRswoCb/arcgis/rest/services/TCAD_Parcels_Dec_2025/FeatureServer/0',
    page: 'https://traviscad.org/',
    inCity: "situs_city='AUSTIN'",
    code: 'land_state_cd',
    // Travis files vacant land as C1 too.
    codes: { land: ['C1'] },
    areaField: 'GIS_acres',
    area: (a) => {
      const acres = positive(num(a.GIS_acres)) ?? positive(num(a.tcad_acres));
      return acres == null ? null : acres * SQFT_PER_ACRE;
    },
    read: (a) => ({
      id: str(a.PROP_ID),
      address: str(a.situs_address).replace(/\s+AUSTIN\s+\d{5}$/i, ''),
      landValue: (num(a.land_homesite_val) ?? 0) + (num(a.land_non_homesite_val) ?? 0) || null,
      value: num(a.market_value),
      built: positive(num(a.F1year_imprv)),
      buildingSqft: null,
      flood: null,
      url: a.PROP_ID ? `https://travis.prodigycad.com/property-detail/${encodeURIComponent(str(a.PROP_ID))}` : null,
      owner: str(a.py_owner_name)
    }),
    zoning: { layer: 'https://services.arcgis.com/0L95CJ0VTaxqcmED/arcgis/rest/services/PLANNINGCADASTRE_zoning_small_map_scale/FeatureServer/0', field: 'ZONING_ZTYPE' }
  }
];

/** Owners that are governments, schools or utilities: not sites anyone can buy. */
const PUBLIC_OWNER = /\b(CITY OF|COUNTY|STATE OF|UNITED STATES|USA\b|ISD\b|INDEPENDENT SCHOOL|SCHOOL DIST|UNIVERSITY|COLLEGE|HOUSING AUTH|PORT OF|AIRPORT|WATER SYSTEM|UTILITY|UTILITIES|AUTHORITY|TXDOT|DEPT OF|DEPARTMENT OF)\b|__PUBLIC__/i;
export const isPublicOwner = (owner: string) => PUBLIC_OWNER.test(owner);

/** Sites between these land areas: big enough to build on, small enough to be one deal. */
export const MIN_SQFT = 10_000;
export const MAX_SQFT = 100 * SQFT_PER_ACRE;

/** The query for one use: in the city, the use's codes, a buildable size, biggest first. */
export function siteQuery(source: SiteSource, use: SiteUse, count: number): URLSearchParams {
  const codes = (source.codes?.[use] ?? USE_CODES[use]).map((c) => `${source.code} LIKE '${c}%'`).join(' OR ');
  const area =
    source.areaField === 'Land_acres' || source.areaField === 'GIS_acres'
      ? `${source.areaField} >= ${MIN_SQFT / SQFT_PER_ACRE} AND ${source.areaField} <= ${MAX_SQFT / SQFT_PER_ACRE}`
      : `${source.areaField} >= ${MIN_SQFT} AND ${source.areaField} <= ${MAX_SQFT}`;
  const where = [source.inCity, `(${codes})`, area].filter(Boolean).join(' AND ');
  return new URLSearchParams({
    f: 'json',
    where,
    outFields: '*',
    orderByFields: `${source.areaField} DESC`,
    resultRecordCount: String(count),
    returnGeometry: 'true',
    outSR: '4326',
    maxAllowableOffset: '0.0005',
    geometryPrecision: '5'
  });
}

/** A polygon's rough center: the middle of its outer ring's bounding box. */
export function center(geometry: { rings?: number[][][] } | null | undefined): { lat: number; lng: number } | null {
  const ring = geometry?.rings?.[0];
  if (!ring?.length) return null;
  let [minX, minY, maxX, maxY] = [Infinity, Infinity, -Infinity, -Infinity];
  for (const [x, y] of ring) {
    if (x == null || y == null) continue;
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);
  }
  if (!Number.isFinite(minX)) return null;
  return { lat: round((minY + maxY) / 2, 5), lng: round((minX + maxX) / 2, 5) };
}

const round = (v: number, digits: number) => Math.round(v * 10 ** digits) / 10 ** digits;

/** One feature as a site, or null when it is publicly owned or missing what the finder needs. */
export function toSite(source: SiteSource, use: SiteUse, feature: { attributes: Attributes; geometry?: { rings?: number[][][] } }): Site | null {
  const a = feature.attributes;
  const landSqft = source.area(a);
  const fields = source.read(a);
  if (!landSqft || !fields.id || isPublicOwner(fields.owner)) return null;
  // A nominal value ($100 and the like) marks a common area or drainage tract, not a site.
  if (fields.value != null && fields.value < 1000) return null;
  const point = center(feature.geometry);
  const landValue = positive(fields.landValue);
  return {
    id: fields.id,
    city: source.city,
    use,
    code: str(a[source.code]).toUpperCase(),
    address: fields.address || 'No street address',
    landSqft: Math.round(landSqft),
    landValue,
    value: positive(fields.value),
    landPsf: landValue ? round(landValue / landSqft, 2) : null,
    built: use === 'land' ? null : fields.built,
    buildingSqft: fields.buildingSqft,
    zoning: null,
    flood: fields.flood,
    lat: point?.lat ?? null,
    lng: point?.lng ?? null,
    url: fields.url
  };
}

export interface SitesFile {
  generatedAt: string;
  sources: { city: City; name: string; page: string; zoning: boolean; note?: string }[];
  sites: Site[];
}

type Fetch = (url: string) => Promise<unknown>;

async function getJson(url: string): Promise<unknown> {
  const response = await fetch(url, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(90_000) });
  if (!response.ok) throw new Error(`${response.status} for ${url.slice(0, 120)}`);
  return response.json();
}

/** The zoning district at a point, from a city zoning layer. */
export async function zoningAt(layer: { layer: string; field: string }, lat: number, lng: number, get: Fetch = getJson): Promise<string | null> {
  const params = new URLSearchParams({
    f: 'json',
    geometry: `${lng},${lat}`,
    geometryType: 'esriGeometryPoint',
    inSR: '4326',
    spatialRel: 'esriSpatialRelIntersects',
    outFields: layer.field,
    returnGeometry: 'false'
  });
  const body = (await get(`${layer.layer}/query?${params}`)) as { features?: { attributes: Attributes }[] };
  const value = body.features?.[0]?.attributes?.[layer.field];
  return value == null || value === '' ? null : str(value);
}

/** Run fn over items with at most `limit` at once. */
async function pool<T>(items: T[], limit: number, fn: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) await fn(items[next++]!);
    })
  );
}

export interface FetchSitesOptions {
  /** Sites kept per city and use. */
  perUse?: number;
  get?: Fetch;
  log?: (line: string) => void;
}

/** Every source's sites with zoning filled in. A city whose layer fails is logged and left out. */
export async function fetchSites(sources: SiteSource[] = SITE_SOURCES, options: FetchSitesOptions = {}): Promise<Site[]> {
  const perUse = options.perUse ?? 150;
  const get = options.get ?? getJson;
  const log = options.log ?? (() => {});
  const out: Site[] = [];
  for (const source of sources) {
    const found: Site[] = [];
    for (const use of SITE_USES) {
      try {
        // Ask for extra: public owners are dropped after the fact.
        const body = (await get(`${source.layer}/query?${siteQuery(source, use, Math.round(perUse * 1.6))}`)) as {
          features?: { attributes: Attributes; geometry?: { rings?: number[][][] } }[];
          error?: { message?: string };
        };
        if (body.error) throw new Error(body.error.message ?? 'query error');
        const seen = new Set<string>();
        const sites = (body.features ?? [])
          .map((f) => toSite(source, use, f))
          .filter((s): s is Site => Boolean(s) && !seen.has(s!.id) && Boolean(seen.add(s!.id)))
          .slice(0, perUse);
        found.push(...sites);
      } catch (error) {
        log(`${source.city} ${use}: ${error instanceof Error ? error.message : error}`);
      }
    }
    if (source.zoning) {
      let missed = 0;
      await pool(
        found.filter((s) => s.lat != null),
        6,
        async (site) => {
          try {
            site.zoning = await zoningAt(source.zoning!, site.lat!, site.lng!, get);
          } catch {
            missed++;
          }
        }
      );
      if (missed) log(`${source.city}: zoning lookup failed for ${missed} sites.`);
    }
    log(`${source.city}: ${found.length} sites (${SITE_USES.map((u) => `${found.filter((s) => s.use === u).length} ${u}`).join(', ')}).`);
    out.push(...found);
  }
  return out;
}
