import type { City } from '../types.js';
import {
  cesSeries,
  combine,
  latest,
  monthLabel,
  unemploymentSeries,
  yearOverYear,
  type Industry,
  type Point
} from './bls.js';
import { censusKey, growth, rentalVacancy, renterShare, type AcsResult } from './census.js';
import type { ApartmentListResult } from './apartmentList.js';
import type { MonthlyReading } from './csv.js';
import type { Metro } from './metros.js';
import type { PermitResult } from './permits.js';
import type { ZillowResult } from './zillow.js';

/**
 * The market data page's file: one row per Terra city, a value per metric.
 * The page draws whatever metrics and groups are listed here, so adding a
 * metric is a change to this file only.
 */

/** count: a number of people or jobs. usd: dollars. change: percent change. rate: a percent level. */
export type Unit = 'count' | 'usd' | 'change' | 'rate';

export interface MarketMetric {
  key: string;
  label: string;
  unit: Unit;
  /** Which end ranks first when sorting "best first"; null when neither end is better. */
  better: 'high' | 'low' | null;
  source: 'BLS' | 'Census ACS' | 'Zillow' | 'Apartment List' | 'Census BPS';
  /** One line on what the figure is, shown on hover and in the method notes. */
  note: string;
}

export interface MarketGroup {
  key: string;
  label: string;
  /** Why these figures matter for this property type. */
  blurb: string;
  metrics: string[];
}

export interface MarketArea {
  city: City;
  metro: string;
  values: Record<string, number | null>;
  /** When each value is from, e.g. "Aug 2026" or "2025". */
  periods: Record<string, string | null>;
}

export interface MarketSnapshot {
  generatedAt: string;
  metrics: MarketMetric[];
  groups: MarketGroup[];
  markets: MarketArea[];
  sources: { name: string; url: string; detail: string }[];
}

export const METRICS: MarketMetric[] = [
  { key: 'jobs', label: 'Total jobs', unit: 'count', better: 'high', source: 'BLS', note: 'Nonfarm payroll jobs, latest month.' },
  { key: 'jobsGrowth', label: 'Job growth', unit: 'change', better: 'high', source: 'BLS', note: 'Nonfarm jobs vs. the same month a year earlier.' },
  { key: 'unemployment', label: 'Unemployment', unit: 'rate', better: 'low', source: 'BLS', note: 'Unemployment rate, latest month, not seasonally adjusted.' },
  { key: 'population', label: 'Population', unit: 'count', better: 'high', source: 'Census ACS', note: 'Residents, latest 1-year estimate.' },
  { key: 'populationGrowth', label: 'Population growth', unit: 'change', better: 'high', source: 'Census ACS', note: 'Residents vs. the year before.' },
  { key: 'medianIncome', label: 'Median household income', unit: 'usd', better: 'high', source: 'Census ACS', note: 'Household spending power.' },
  {
    key: 'officeJobs',
    label: 'Office-using jobs',
    unit: 'count',
    better: 'high',
    source: 'BLS',
    note: 'Financial activities, professional and business services, and information: the industries that fill office space.'
  },
  { key: 'officeJobsGrowth', label: 'Office-using job growth', unit: 'change', better: 'high', source: 'BLS', note: 'Office-using jobs vs. a year earlier.' },
  {
    key: 'industrialJobs',
    label: 'Industrial jobs',
    unit: 'count',
    better: 'high',
    source: 'BLS',
    note: 'Manufacturing plus wholesale, transportation, warehousing and utilities: the tenants of industrial space.'
  },
  { key: 'industrialJobsGrowth', label: 'Industrial job growth', unit: 'change', better: 'high', source: 'BLS', note: 'Industrial jobs vs. a year earlier.' },
  { key: 'retailJobs', label: 'Retail jobs', unit: 'count', better: 'high', source: 'BLS', note: 'Retail trade payrolls.' },
  { key: 'retailJobsGrowth', label: 'Retail job growth', unit: 'change', better: 'high', source: 'BLS', note: 'Retail jobs vs. a year earlier.' },
  {
    key: 'constructionJobs',
    label: 'Construction jobs',
    unit: 'count',
    better: 'high',
    source: 'BLS',
    note: 'Construction payrolls (with mining and logging where BLS only publishes them together).'
  },
  { key: 'constructionJobsGrowth', label: 'Construction job growth', unit: 'change', better: 'high', source: 'BLS', note: 'Construction jobs vs. a year earlier.' },
  { key: 'medianRent', label: 'Median rent', unit: 'usd', better: null, source: 'Census ACS', note: 'Median gross rent (rent plus utilities), all rented homes.' },
  { key: 'rentGrowth', label: 'Rent growth', unit: 'change', better: 'high', source: 'Census ACS', note: 'Median gross rent vs. the year before.' },
  {
    key: 'rentalVacancy',
    label: 'Rental vacancy',
    unit: 'rate',
    better: 'low',
    source: 'Census ACS',
    note: 'Homes for rent as a share of the rental stock. Lower means a tighter apartment market.'
  },
  { key: 'renterShare', label: 'Renter households', unit: 'rate', better: 'high', source: 'Census ACS', note: 'Share of occupied homes that are rented: the apartment demand pool.' },
  { key: 'medianHomeValue', label: 'Median home value', unit: 'usd', better: null, source: 'Census ACS', note: 'Owner-estimated value of owner-occupied homes.' },
  { key: 'homeValueGrowth', label: 'Home value growth', unit: 'change', better: 'high', source: 'Census ACS', note: 'Median home value vs. the year before.' },
  {
    key: 'zhvi',
    label: 'Typical home value (Zillow)',
    unit: 'usd',
    better: null,
    source: 'Zillow',
    note: 'Zillow Home Value Index for the city itself: the typical home (middle third), latest month.'
  },
  { key: 'zhviGrowth', label: 'Home value growth (Zillow)', unit: 'change', better: 'high', source: 'Zillow', note: 'Zillow Home Value Index vs. the same month a year earlier.' },
  {
    key: 'zori',
    label: 'Typical asking rent (Zillow)',
    unit: 'usd',
    better: null,
    source: 'Zillow',
    note: 'Zillow Observed Rent Index for the city: asking rent on homes and apartments listed, latest month.'
  },
  { key: 'zoriGrowth', label: 'Asking rent growth (Zillow)', unit: 'change', better: 'high', source: 'Zillow', note: 'Zillow Observed Rent Index vs. a year earlier.' },
  {
    key: 'aptRent',
    label: 'Apartment rent (Apartment List)',
    unit: 'usd',
    better: null,
    source: 'Apartment List',
    note: 'Median rent on apartments in the city, all bedroom counts, latest month.'
  },
  { key: 'aptRentGrowth', label: 'Apartment rent growth (Apartment List)', unit: 'change', better: 'high', source: 'Apartment List', note: 'Apartment rent vs. a year earlier.' },
  {
    key: 'aptVacancy',
    label: 'Apartment vacancy (Apartment List)',
    unit: 'rate',
    better: 'low',
    source: 'Apartment List',
    note: 'Share of apartment units in the city sitting vacant, latest month. Lower means a tighter market.'
  },
  {
    key: 'permitUnits',
    label: 'New homes permitted',
    unit: 'count',
    better: 'high',
    source: 'Census BPS',
    note: 'Housing units the city authorized in new buildings this year so far, as reported to the Census Building Permits Survey.'
  },
  {
    key: 'multifamilyPermitUnits',
    label: 'Apartment units permitted',
    unit: 'count',
    better: 'high',
    source: 'Census BPS',
    note: 'Of those, units in buildings of five or more: the apartment pipeline.'
  },
  { key: 'permitGrowth', label: 'Permit growth', unit: 'change', better: 'high', source: 'Census BPS', note: 'Homes permitted this year so far vs. the same months last year.' }
];

export const GROUPS: MarketGroup[] = [
  {
    key: 'overview',
    label: 'Overview',
    blurb: 'The economy every property type leans on: jobs, people, and paychecks.',
    metrics: ['jobsGrowth', 'unemployment', 'populationGrowth', 'medianIncome', 'jobs', 'population']
  },
  {
    key: 'office',
    label: 'Office',
    blurb: 'Office demand follows the industries that work at desks.',
    metrics: ['officeJobsGrowth', 'officeJobs', 'jobsGrowth', 'unemployment']
  },
  {
    key: 'industrial',
    label: 'Industrial',
    blurb: 'Warehouses and plants fill as manufacturing, distribution and logistics hire.',
    metrics: ['industrialJobsGrowth', 'industrialJobs', 'populationGrowth', 'jobsGrowth']
  },
  {
    key: 'retail',
    label: 'Retail',
    blurb: 'Stores follow rooftops and spending power.',
    metrics: ['retailJobsGrowth', 'retailJobs', 'medianIncome', 'populationGrowth']
  },
  {
    key: 'multifamily',
    label: 'Multifamily',
    blurb: 'Apartments: how tight the rental market is and where rents are heading.',
    metrics: ['aptVacancy', 'aptRent', 'aptRentGrowth', 'zori', 'zoriGrowth', 'multifamilyPermitUnits', 'rentalVacancy', 'medianRent', 'rentGrowth', 'renterShare']
  },
  {
    key: 'development',
    label: 'Development',
    blurb: 'Building activity and land and home values.',
    metrics: ['permitUnits', 'permitGrowth', 'multifamilyPermitUnits', 'zhvi', 'zhviGrowth', 'constructionJobsGrowth', 'constructionJobs', 'medianHomeValue', 'homeValueGrowth']
  }
];

export const SOURCES: MarketSnapshot['sources'] = [
  {
    name: 'U.S. Bureau of Labor Statistics',
    url: 'https://www.bls.gov/sae/',
    detail: 'Jobs by industry (Current Employment Statistics, state and metro) and unemployment (Local Area Unemployment Statistics). Updated monthly.'
  },
  {
    name: 'U.S. Census Bureau, American Community Survey',
    url: 'https://www.census.gov/programs-surveys/acs',
    detail: 'Population, income, rent, home value and rental vacancy, 1-year estimates. Updated each September.'
  },
  {
    name: 'Zillow Research',
    url: 'https://www.zillow.com/research/data/',
    detail: 'Zillow Home Value Index and Zillow Observed Rent Index, city level. Updated monthly.'
  },
  {
    name: 'Apartment List',
    url: 'https://www.apartmentlist.com/research/category/data-rent-estimates',
    detail: 'Apartment rent estimates and vacancy index, city level. Updated monthly.'
  },
  {
    name: 'U.S. Census Bureau, Building Permits Survey',
    url: 'https://www.census.gov/construction/bps/',
    detail: 'New housing units each city authorized, by building size, year to date. Updated monthly.'
  }
];

/** The property-market sources, each null when it did not answer. */
export interface PropertyData {
  zillow?: ZillowResult | null;
  apartmentList?: ApartmentListResult | null;
  permits?: PermitResult | null;
}

/** Every BLS series the snapshot reads, for one request batch. */
export function blsSeriesFor(metros: Metro[]): string[] {
  const industries: Industry[] = [
    'total',
    'construction',
    'miningConstruction',
    'manufacturing',
    'tradeTransportUtilities',
    'retail',
    'information',
    'financial',
    'professional'
  ];
  return metros.flatMap((metro) => [...industries.map((industry) => cesSeries(metro, industry)), unemploymentSeries(metro)]);
}

/** CES values are thousands of jobs. */
const THOUSANDS = 1000;

export function buildMarketSnapshot(
  metros: Metro[],
  bls: Map<string, Point[]> | null,
  acs: AcsResult | null,
  now: Date = new Date(),
  property: PropertyData = {}
): MarketSnapshot {
  const markets = metros.map((metro): MarketArea => {
    const values: Record<string, number | null> = {};
    const periods: Record<string, string | null> = {};
    const set = (key: string, value: number | null | undefined, period: string | null) => {
      const ok = value != null && Number.isFinite(value);
      values[key] = ok ? value : null;
      periods[key] = ok ? period : null;
    };

    // Jobs: levels and year-over-year change, per industry group.
    const series = (industry: Industry) => bls?.get(cesSeries(metro, industry));
    const jobs = (key: string, points: Point[] | undefined) => {
      const last = latest(points);
      set(key, last ? Math.round(last.value * THOUSANDS) : null, monthLabel(last));
      set(`${key}Growth`, yearOverYear(points), monthLabel(last));
    };
    jobs('jobs', series('total'));
    jobs(
      'officeJobs',
      combine([
        { points: series('financial'), weight: 1 },
        { points: series('professional'), weight: 1 },
        { points: series('information'), weight: 1 }
      ])
    );
    // Trade, transportation and utilities minus retail is wholesale plus
    // transportation, warehousing and utilities, which BLS publishes for more
    // metros than either part on its own.
    jobs(
      'industrialJobs',
      combine([
        { points: series('manufacturing'), weight: 1 },
        { points: series('tradeTransportUtilities'), weight: 1 },
        { points: series('retail'), weight: -1 }
      ])
    );
    jobs('retailJobs', series('retail'));
    jobs('constructionJobs', series('construction') ?? series('miningConstruction'));

    const unemployment = bls?.get(unemploymentSeries(metro));
    set('unemployment', latest(unemployment)?.value, monthLabel(latest(unemployment)));

    // Census: levels for the latest year, growth against the year before.
    const row = acs?.current.get(censusKey(metro));
    const before = acs?.previous.get(censusKey(metro));
    const year = acs ? String(acs.year) : null;
    const span = acs ? `${acs.year - 1}–${String(acs.year).slice(2)}` : null;
    set('population', row?.population, year);
    set('populationGrowth', growth(row?.population, before?.population), span);
    set('medianIncome', row?.medianIncome, year);
    set('medianRent', row?.medianRent, year);
    set('rentGrowth', growth(row?.medianRent, before?.medianRent), span);
    set('rentalVacancy', rentalVacancy(row), year);
    set('renterShare', renterShare(row), year);
    set('medianHomeValue', row?.medianHomeValue, year);
    set('homeValueGrowth', growth(row?.medianHomeValue, before?.medianHomeValue), span);

    // Monthly city figures: a level and its change from a year earlier.
    const monthly = (key: string, reading: MonthlyReading | undefined, growthKey?: string) => {
      set(key, reading?.value, reading?.period ?? null);
      if (growthKey) set(growthKey, growth(reading?.value, reading?.yearAgo), reading?.period ?? null);
    };
    monthly('zhvi', property.zillow?.homeValue.get(metro.city), 'zhviGrowth');
    monthly('zori', property.zillow?.rent.get(metro.city), 'zoriGrowth');
    monthly('aptRent', property.apartmentList?.rent.get(metro.city), 'aptRentGrowth');
    monthly('aptVacancy', property.apartmentList?.vacancy.get(metro.city));

    const permits = property.permits;
    const issued = permits?.current.get(metro.city);
    const lastYear = permits?.previous.get(metro.city);
    set('permitUnits', issued?.units, permits?.period ?? null);
    set('multifamilyPermitUnits', issued?.multifamilyUnits, permits?.period ?? null);
    set('permitGrowth', growth(issued?.units, lastYear?.units), permits?.period ?? null);

    for (const metric of METRICS) {
      values[metric.key] ??= null;
      periods[metric.key] ??= null;
    }
    return { city: metro.city, metro: metro.name, values, periods };
  });

  return { generatedAt: now.toISOString(), metrics: METRICS, groups: GROUPS, markets, sources: SOURCES };
}

/**
 * Fill each figure today's pass could not read from the last published copy,
 * so a BLS quota or a Census outage leaves last month's figure (with its own
 * date) rather than a blank.
 */
export function fillFromPrevious(next: MarketSnapshot, previous: MarketSnapshot | null | undefined): MarketSnapshot {
  if (!previous?.markets) return next;
  return {
    ...next,
    markets: next.markets.map((market) => {
      const old = previous.markets.find((m) => m.city === market.city);
      if (!old) return market;
      const values = { ...market.values };
      const periods = { ...market.periods };
      for (const key of Object.keys(values)) {
        if (values[key] == null && old.values?.[key] != null) {
          values[key] = old.values[key]!;
          periods[key] = old.periods?.[key] ?? null;
        }
      }
      return { ...market, values, periods };
    })
  };
}

/** How many figures have a value, to tell a usable snapshot from an empty one. */
export function filledCount(snapshot: MarketSnapshot): number {
  return snapshot.markets.reduce((sum, market) => sum + Object.values(market.values).filter((v) => v != null).length, 0);
}
