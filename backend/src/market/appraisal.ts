import type { City } from '../types.js';
import { csvNumber, parseCsvLine } from './csv.js';

/**
 * County appraisal district rolls: what the district appraised every
 * commercial, industrial and apartment property in each city at, and what it
 * valued the land under them at per square foot.
 *
 * These are appraised values, not sale prices. Texas does not require sale
 * prices to be disclosed, so districts estimate value from the sales and
 * income data owners choose to share. Read as "what the tax roll says", they
 * are still the only free, complete, property-by-property view of a market.
 *
 * Each district publishes its roll as a free bulk download in its own format.
 * The parsers here turn one line of each into a Parcel; aggregate() does the
 * rest the same way for every district.
 *
 *   Harris (Houston)       real_acct.txt, tab-separated, current and prior value per account
 *   Dallas (Dallas)        certified CSVs: ACCOUNT_INFO, ACCOUNT_APPRL_YEAR, LAND
 *   Tarrant (Fort Worth)   pipe-delimited PropertyData, this year and last year's certified file
 *   Travis (Austin)        fixed-width PACS export: PROP.TXT and LAND_DET.TXT
 *
 * Bexar (San Antonio) and El Paso refuse automated downloads, so they have
 * none of these figures.
 */

/** The property types the Texas comptroller's state codes separate. Office and retail are both "commercial". */
export type PropertyClass = 'multifamily' | 'commercial' | 'industrial';
export const PROPERTY_CLASSES: PropertyClass[] = ['multifamily', 'commercial', 'industrial'];

export interface Parcel {
  cls: PropertyClass;
  /** Appraised value this year. */
  value: number;
  /** The same property's value last year, when the roll carries it. */
  priorValue?: number | null;
  landValue?: number | null;
  landSqft?: number | null;
  /** Value added by new construction this year, when the roll carries it. */
  newConstruction?: number | null;
}

/**
 * State property tax codes: B multifamily, F1 commercial, F2 industrial. Some
 * districts add a digit or letter (Dallas F10, Tarrant F1C), so only the
 * leading two characters count.
 */
export function stateClass(code: string | undefined, apartments: (code: string) => boolean = (c) => c.startsWith('B1')): PropertyClass | null {
  const c = (code ?? '').trim().toUpperCase();
  if (c.startsWith('F1')) return 'commercial';
  if (c.startsWith('F2')) return 'industrial';
  if (apartments(c)) return 'multifamily';
  return null;
}

const SQFT_PER_ACRE = 43_560;

/* ---------------------------------------------------------------- Harris */

/** Harris's real_acct.txt: tab-separated with a header line. Houston is the site_addr_2 city. */
export function harrisParser(header: string): (line: string) => Parcel | null {
  const cols = header.replace(/\r$/, '').split('\t');
  const at = (name: string) => cols.indexOf(name);
  const city = at('site_addr_2');
  const cls = at('state_class');
  const value = at('tot_appr_val');
  const prior = at('prior_tot_appr_val');
  const land = at('land_val');
  const area = at('land_ar');
  const newValue = at('new_construction_val');
  return (line) => {
    const row = line.replace(/\r$/, '').split('\t');
    if (row[city]?.trim().toUpperCase() !== 'HOUSTON') return null;
    const type = stateClass(row[cls]);
    const appraised = csvNumber(row[value]);
    if (!type || !appraised) return null;
    return {
      cls: type,
      value: appraised,
      priorValue: csvNumber(row[prior]),
      landValue: csvNumber(row[land]),
      landSqft: csvNumber(row[area]),
      newConstruction: csvNumber(row[newValue])
    };
  };
}

/* ---------------------------------------------------------------- Dallas */

/**
 * Dallas spreads an account over three files. The city comes from
 * ACCOUNT_INFO, so it is read first into a set of Dallas accounts; LAND gives
 * area per land section (square feet or acres), summed per account; then each
 * ACCOUNT_APPRL_YEAR line becomes a parcel. Apartments are the B codes in the
 * commercial division (duplexes are B codes in the residential one).
 */
export class DallasRoll {
  readonly accounts = new Set<string>();
  readonly land = new Map<string, number>();
  private infoCols: string[] = [];
  private landCols: string[] = [];
  private yearCols: string[] = [];

  infoLine(line: string): void {
    const row = parseCsvLine(line);
    if (!this.infoCols.length) {
      this.infoCols = row;
      return;
    }
    const city = row[this.infoCols.indexOf('PROPERTY_CITY')]?.trim().toUpperCase();
    if (city === 'DALLAS') this.accounts.add(row[this.infoCols.indexOf('ACCOUNT_NUM')]!);
  }

  landLine(line: string): void {
    const row = parseCsvLine(line);
    if (!this.landCols.length) {
      this.landCols = row;
      return;
    }
    const account = row[this.landCols.indexOf('ACCOUNT_NUM')]!;
    if (!this.accounts.has(account)) return;
    const size = csvNumber(row[this.landCols.indexOf('AREA_SIZE')]);
    const unit = row[this.landCols.indexOf('AREA_UOM_DESC')]?.trim().toUpperCase();
    const sqft = size == null ? null : unit === 'SQUARE FEET' ? size : unit === 'ACRE' ? size * SQFT_PER_ACRE : null;
    if (sqft) this.land.set(account, (this.land.get(account) ?? 0) + sqft);
  }

  yearLine(line: string): Parcel | null {
    const row = parseCsvLine(line);
    if (!this.yearCols.length) {
      this.yearCols = row;
      return null;
    }
    const col = (name: string) => row[this.yearCols.indexOf(name)];
    const account = col('ACCOUNT_NUM')!;
    if (!this.accounts.has(account)) return null;
    const commercial = col('DIVISION_CD')?.trim() === 'COM';
    const type = stateClass(col('SPTD_CODE'), (c) => commercial && c.startsWith('B'));
    const value = csvNumber(col('TOT_VAL'));
    if (!type || !value) return null;
    return {
      cls: type,
      value,
      priorValue: csvNumber(col('PREV_MKT_VAL')),
      landValue: csvNumber(col('LAND_VAL')),
      landSqft: this.land.get(account) ?? null
    };
  }
}

/* --------------------------------------------------------------- Tarrant */

/** Tarrant's city code for Fort Worth (its Appendix B). */
export const TARRANT_FORT_WORTH = '026';

/**
 * Tarrant's PropertyData files: pipe-delimited with a header. RP is the account
 * type (C commercial, R residential); City is a jurisdiction code. Apartments
 * are B codes on commercial accounts.
 */
export function tarrantParser(header: string): (line: string) => (Parcel & { account: string }) | null {
  const cols = header.replace(/\r$/, '').split('|');
  const at = (name: string) => cols.indexOf(name);
  const [rp, account, city, code, appraised, land, area] = [
    'RP',
    'Account_Num',
    'City',
    'State_Use_Code',
    'Appraised_Value',
    'Land_Value',
    'Land_SqFt'
  ].map(at) as [number, number, number, number, number, number, number];
  return (line) => {
    const row = line.replace(/\r$/, '').split('|');
    if (row[city]?.trim() !== TARRANT_FORT_WORTH) return null;
    const commercial = row[rp]?.trim() === 'C';
    const type = stateClass(row[code], (c) => commercial && c.startsWith('B'));
    const value = csvNumber(row[appraised]);
    if (!type || !value) return null;
    return {
      account: String(Number(row[account])),
      cls: type,
      value,
      landValue: csvNumber(row[land]),
      landSqft: csvNumber(row[area])
    };
  };
}

/** Last year's certified value per account, for year-over-year change. */
export function tarrantPriorValues(header: string): (line: string, into: Map<string, number>) => void {
  const parse = tarrantParser(header);
  return (line, into) => {
    const parcel = parse(line);
    if (parcel) into.set(parcel.account, parcel.value);
  };
}

/* ---------------------------------------------------------------- Travis */

/** 1-based start and length of the PROP.TXT fields read, from the published Legacy 8.0.33 layout. */
const PROP = {
  id: [1, 12],
  type: [13, 5],
  city: [1110, 30],
  zip: [1140, 10],
  landHomestead: [1796, 15],
  landOther: [1811, 15],
  appraised: [1916, 15],
  improvementCode: [2732, 10],
  landCode: [2742, 10]
} as const;
const LAND_DET = { id: [1, 12], sqft: [84, 14] } as const;

const field = (line: string, [start, length]: readonly [number, number]) => line.slice(start - 1, start - 1 + length).trim();

/** Land area per property, summed over its land segments. */
export function travisLandLine(line: string, into: Map<string, number>): void {
  const sqft = Number(field(line, LAND_DET.sqft));
  if (!sqft) return;
  const id = String(Number(field(line, LAND_DET.id)));
  into.set(id, (into.get(id) ?? 0) + sqft);
}

/**
 * A real property in Austin: the situs city when the roll has one, otherwise
 * an Austin (787xx) ZIP code.
 */
export function travisPropLine(line: string, land: Map<string, number>): Parcel | null {
  if (field(line, PROP.type) !== 'R') return null;
  const city = field(line, PROP.city).toUpperCase();
  if (city ? city !== 'AUSTIN' : !field(line, PROP.zip).startsWith('787')) return null;
  const type = stateClass(field(line, PROP.improvementCode) || field(line, PROP.landCode));
  const value = Number(field(line, PROP.appraised));
  if (!type || !value) return null;
  return {
    cls: type,
    value,
    landValue: Number(field(line, PROP.landHomestead)) + Number(field(line, PROP.landOther)),
    landSqft: land.get(String(Number(field(line, PROP.id)))) ?? null
  };
}

/* ------------------------------------------------------------- Aggregate */

export interface ClassSummary {
  parcels: number;
  /** Sum of appraised values. */
  totalValue: number;
  medianValue: number | null;
  /** Change in value of the properties appraised both years, in percent. */
  valueGrowth: number | null;
  /** Average land value per square foot, after trimming the top and bottom 1%. */
  landPsf: number | null;
  medianLandPsf: number | null;
  /** How many parcels the land figures rest on. */
  landParcels: number;
  newConstruction: number | null;
}

export interface CitySummary {
  city: City;
  district: string;
  /** e.g. "2026 roll". */
  period: string;
  classes: Partial<Record<PropertyClass, ClassSummary>>;
}

/** Parcels smaller than this, or with no land value, say nothing about land prices. */
const MIN_LAND_SQFT = 500;

export class Aggregator {
  private readonly values = new Map<PropertyClass, number[]>();
  private readonly psf = new Map<PropertyClass, number[]>();
  private readonly growth = new Map<PropertyClass, { now: number; before: number }>();
  private readonly built = new Map<PropertyClass, number | null>();

  add(parcel: Parcel): void {
    const { cls } = parcel;
    list(this.values, cls).push(parcel.value);
    if (parcel.priorValue && parcel.priorValue > 0) {
      const g = this.growth.get(cls) ?? { now: 0, before: 0 };
      g.now += parcel.value;
      g.before += parcel.priorValue;
      this.growth.set(cls, g);
    }
    if (parcel.landValue && parcel.landValue > 0 && parcel.landSqft && parcel.landSqft >= MIN_LAND_SQFT) {
      list(this.psf, cls).push(parcel.landValue / parcel.landSqft);
    }
    if (parcel.newConstruction != null) this.built.set(cls, (this.built.get(cls) ?? 0) + parcel.newConstruction);
  }

  summary(city: City, district: string, period: string): CitySummary {
    const classes: CitySummary['classes'] = {};
    for (const cls of PROPERTY_CLASSES) {
      const values = this.values.get(cls);
      if (!values?.length) continue;
      const psf = trimmed(this.psf.get(cls) ?? []);
      const g = this.growth.get(cls);
      classes[cls] = {
        parcels: values.length,
        totalValue: values.reduce((a, b) => a + b, 0),
        medianValue: median(values),
        valueGrowth: g && g.before > 0 ? ((g.now - g.before) / g.before) * 100 : null,
        landPsf: psf.length ? psf.reduce((a, b) => a + b, 0) / psf.length : null,
        medianLandPsf: median(psf),
        landParcels: psf.length,
        newConstruction: this.built.has(cls) ? this.built.get(cls)! : null
      };
    }
    return { city, district, period, classes };
  }
}

function list<K>(map: Map<K, number[]>, key: K): number[] {
  let out = map.get(key);
  if (!out) map.set(key, (out = []));
  return out;
}

export function median(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/** Drop the lowest and highest 1% (data-entry slips and odd remnant parcels), sorted ascending. */
export function trimmed(values: number[]): number[] {
  const sorted = [...values].sort((a, b) => a - b);
  const cut = Math.floor(sorted.length * 0.01);
  return cut ? sorted.slice(cut, sorted.length - cut) : sorted;
}

export interface AppraisalFile {
  generatedAt: string;
  cities: CitySummary[];
}
