import { fetchBuffer, HttpError, type FetchJsonOptions } from '../lib/http.js';
import { readFirstSheet } from '../lib/xlsx.js';
import type { City } from '../types.js';

/**
 * Property tax rates from the Texas Comptroller's yearly "total rates and
 * levies" workbook: every taxing unit in the state with its adopted rate,
 * free to download, no key. Rates are dollars per $100 of taxable value,
 * which is the same number as a percent of value.
 *
 * A property pays every unit it sits in, so each city's combined rate adds
 * the units that cover a typical property inside the city: the city, the
 * county, the main school district, and the county-wide college, hospital,
 * flood and port districts. Pockets of a city sit in other school districts
 * or carry a utility district on top, so this is the typical in-city rate,
 * not every parcel's.
 */

export const taxRateUrl = (year: number) => `https://comptroller.texas.gov/taxes/property-tax/docs/${year}-total-rates-levies.xlsx`;

type Part = 'city' | 'county' | 'school' | 'other';

interface Unit {
  part: Part;
  /** Comptroller taxing unit id: county-unit-type. */
  id?: string;
  /** For a unit whose id is not stable, its name. */
  name?: RegExp;
  /**
   * With name: the Comptroller county number the unit must be in. The county
   * itself (NNN-000-00) never matches, so "Galveston" finds the city, not
   * Galveston County.
   */
  within?: string;
  label: string;
}

/** The taxing units that cover a typical property in each city, by Comptroller id. */
export const CITY_UNITS: Record<City, Unit[]> = {
  Houston: [
    { part: 'city', id: '101-124-03', label: 'City of Houston' },
    { part: 'county', id: '101-000-00', label: 'Harris County' },
    { part: 'school', id: '101-912-02', label: 'Houston ISD' },
    { part: 'other', id: '101-201-12', label: 'Harris County Flood Control' },
    { part: 'other', id: '101-202-11', label: 'Harris Health' },
    { part: 'other', id: '101-204-18', label: 'Port of Houston' },
    { part: 'other', id: '101-201-33', label: 'Harris County Dept. of Education' },
    { part: 'other', name: /^Houston Community College/i, label: 'Houston Community College' }
  ],
  Dallas: [
    { part: 'city', id: '057-117-03', label: 'City of Dallas' },
    { part: 'county', id: '057-000-00', label: 'Dallas County' },
    { part: 'school', id: '057-905-02', label: 'Dallas ISD' },
    { part: 'other', id: '057-201-15', label: 'Dallas College' },
    { part: 'other', id: '057-201-11', label: 'Parkland Hospital District' }
  ],
  'Fort Worth': [
    { part: 'city', id: '220-126-03', label: 'City of Fort Worth' },
    { part: 'county', id: '220-000-00', label: 'Tarrant County' },
    { part: 'school', id: '220-905-02', label: 'Fort Worth ISD' },
    { part: 'other', id: '220-201-15', label: 'Tarrant County College' },
    { part: 'other', id: '220-203-11', label: 'Tarrant County Hospital District' },
    { part: 'other', id: '220-201-06', label: 'Tarrant Regional Water District' }
  ],
  Austin: [
    { part: 'city', id: '227-104-03', label: 'City of Austin' },
    { part: 'county', id: '227-000-00', label: 'Travis County' },
    { part: 'school', id: '227-901-02', label: 'Austin ISD' },
    { part: 'other', id: '227-201-15', label: 'Austin Community College' },
    { part: 'other', id: '227-201-11', label: 'Central Health' }
  ],
  'San Antonio': [
    { part: 'city', id: '015-118-03', label: 'City of San Antonio' },
    { part: 'county', id: '015-000-00', label: 'Bexar County' },
    { part: 'school', id: '015-907-02', label: 'San Antonio ISD' },
    { part: 'other', id: '015-201-15', label: 'Alamo Colleges' },
    { part: 'other', id: '015-201-11', label: 'University Health' },
    { part: 'other', id: '015-201-27', label: 'San Antonio River Authority' }
  ],
  'El Paso': [
    { part: 'city', id: '071-102-03', label: 'City of El Paso' },
    { part: 'county', id: '071-000-00', label: 'El Paso County' },
    { part: 'school', id: '071-902-02', label: 'El Paso ISD' },
    { part: 'other', id: '071-201-15', label: 'El Paso Community College' },
    { part: 'other', id: '071-202-11', label: 'University Medical Center' }
  ],
  // Comal County is Comptroller county 046. The city's and school district's
  // unit ids were not at hand when the city was added, so those match by name.
  // Most of the city is in New Braunfels ISD (Comal ISD covers the rest), and
  // the part of the city in Guadalupe County is left out.
  'New Braunfels': [
    { part: 'city', name: /^(City of )?New Braunfels( City)?$/i, label: 'City of New Braunfels' },
    { part: 'county', id: '046-000-00', label: 'Comal County' },
    { part: 'school', name: /^New Braunfels ISD\b/i, label: 'New Braunfels ISD' }
  ],
  // The four below match the city and school district by name inside their
  // county (Comptroller numbers counties alphabetically: Brazos 021,
  // Galveston 084, Lubbock 152, Midland 165).
  'College Station': [
    { part: 'city', name: /^(City of )?College Station( City)?$/i, within: '021', label: 'City of College Station' },
    { part: 'county', id: '021-000-00', label: 'Brazos County' },
    { part: 'school', name: /^College Station ISD\b/i, within: '021', label: 'College Station ISD' }
  ],
  Galveston: [
    { part: 'city', name: /^(City of )?Galveston( City)?$/i, within: '084', label: 'City of Galveston' },
    { part: 'county', id: '084-000-00', label: 'Galveston County' },
    { part: 'school', name: /^Galveston ISD\b/i, within: '084', label: 'Galveston ISD' }
  ],
  Lubbock: [
    { part: 'city', name: /^(City of )?Lubbock( City)?$/i, within: '152', label: 'City of Lubbock' },
    { part: 'county', id: '152-000-00', label: 'Lubbock County' },
    { part: 'school', name: /^Lubbock ISD\b/i, within: '152', label: 'Lubbock ISD' }
  ],
  Midland: [
    { part: 'city', name: /^(City of )?Midland( City)?$/i, within: '165', label: 'City of Midland' },
    { part: 'county', id: '165-000-00', label: 'Midland County' },
    { part: 'school', name: /^Midland ISD\b/i, within: '165', label: 'Midland ISD' }
  ]
};

export interface TaxingUnit {
  id: string;
  name: string;
  rate: number;
}

/** Rows of the Statewide sheet: unit id, name and total rate, found by the header row naming them. */
export function parseTaxRates(rows: string[][]): TaxingUnit[] {
  const headerAt = rows.findIndex((row) => row.some((cell) => /taxing unit id/i.test(cell)));
  if (headerAt < 0) return [];
  const header = rows[headerAt]!.map((cell) => cell.trim().toLowerCase());
  const id = header.indexOf('taxing unit id');
  const name = header.indexOf('taxing unit name');
  const rate = header.findIndex((cell) => cell === 'total tax rate');
  if (id < 0 || name < 0 || rate < 0) return [];
  const out = new Map<string, TaxingUnit>();
  for (const row of rows.slice(headerAt + 1)) {
    const value = Number(row[rate]);
    // Older files suffix the id with the appraisal district and county
    // (001-000-00-001-001) and repeat a unit once per county it spans.
    const unit = /^(\d{3}-\d{3}-\d{2})(?:-\d{3}-\d{3})?$/.exec(row[id]?.trim() ?? '')?.[1];
    if (!unit || !Number.isFinite(value) || out.has(unit)) continue;
    out.set(unit, { id: unit, name: (row[name] ?? '').replace(/\*+/g, '').trim(), rate: value });
  }
  return [...out.values()];
}

export interface CityTaxRate {
  total: number;
  city: number | null;
  county: number | null;
  school: number | null;
  /** College, hospital, flood, port and similar county-wide districts. */
  other: number;
  /** Units listed for the city that the year's file did not have. */
  missing: string[];
}

export function cityTaxRate(units: TaxingUnit[], city: City): CityTaxRate | null {
  const byId = new Map(units.map((u) => [u.id, u]));
  const parts: Record<Part, number | null> = { city: null, county: null, school: null, other: 0 };
  const missing: string[] = [];
  for (const unit of CITY_UNITS[city]) {
    const found = unit.id ? byId.get(unit.id) : units.find((u) => unit.name!.test(u.name) && (!unit.within || (u.id.startsWith(`${unit.within}-`) && !u.id.endsWith('-000-00'))));
    if (!found) {
      missing.push(unit.label);
      continue;
    }
    parts[unit.part] = (parts[unit.part] ?? 0) + found.rate;
  }
  // Without the three main units the total would mislead.
  if (parts.city == null || parts.county == null || parts.school == null) return null;
  return {
    total: parts.city + parts.county + parts.school + (parts.other ?? 0),
    city: parts.city,
    county: parts.county,
    school: parts.school,
    other: parts.other ?? 0,
    missing
  };
}

export interface TaxRateResult {
  /** The tax year: rates adopted that fall, billed that winter. */
  year: number;
  current: Map<City, CityTaxRate>;
  previous: Map<City, CityTaxRate>;
}

async function readYear(year: number, cities: readonly City[], options: FetchJsonOptions): Promise<Map<City, CityTaxRate>> {
  const data = await fetchBuffer(taxRateUrl(year), { timeoutMs: 120_000, ...options });
  const units = parseTaxRates(readFirstSheet(data));
  const out = new Map<City, CityTaxRate>();
  for (const city of cities) {
    const rate = cityTaxRate(units, city);
    if (rate) out.set(city, rate);
  }
  return out;
}

/**
 * The newest year with a file. Units adopt rates in August and September and
 * the Comptroller publishes the workbook the next winter, so the search
 * starts at this year and walks back.
 */
export async function fetchTaxRates(
  cities: readonly City[],
  options: FetchJsonOptions & { now?: Date } = {}
): Promise<TaxRateResult> {
  const { now = new Date(), ...http } = options;
  for (let year = now.getUTCFullYear(); year >= now.getUTCFullYear() - 3; year--) {
    let current: Map<City, CityTaxRate>;
    try {
      current = await readYear(year, cities, http);
    } catch (error) {
      // A year not out yet is a 404, or an HTML page in place of the workbook.
      if ((error instanceof HttpError && error.status === 404) || (error instanceof Error && /zip/i.test(error.message))) continue;
      throw error;
    }
    if (!current.size) continue;
    const previous = await readYear(year - 1, cities, http).catch(() => new Map<City, CityTaxRate>());
    return { year, current, previous };
  }
  throw new Error('No Comptroller tax rate workbook in the last four years');
}
