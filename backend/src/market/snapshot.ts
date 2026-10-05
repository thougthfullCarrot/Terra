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
import type { AppraisalFile, PropertyClass } from './appraisal.js';
import type { MonthlyReading } from './csv.js';
import type { DevelopmentsResult } from './developments.js';
import type { RateReading } from './fred.js';
import type { Metro } from './metros.js';
import { metroZoneCount } from './opportunityZones.js';
import { shareOf, topGrowingCounties, type PepResult } from './pep.js';
import type { PermitResult } from './permits.js';
import type { TaxRateResult } from './taxRates.js';
import type { DistrictProjects } from './txdot.js';
import type { ZillowResult } from './zillow.js';

/**
 * The market data page's file: one row per Terra city, a value per metric.
 * The page draws whatever metrics and groups are listed here, so adding a
 * metric is a change to this file only.
 */

/**
 * count: a number of people or jobs. usd: dollars. change: percent change.
 * rate: a percent level. taxRate: a property tax rate, dollars per $100 of
 * value (shown to two decimals, since a few cents matter).
 */
export type Unit = 'count' | 'usd' | 'change' | 'rate' | 'taxRate';

export interface MarketMetric {
  key: string;
  label: string;
  unit: Unit;
  /** Which end ranks first when sorting "best first"; null when neither end is better. */
  better: 'high' | 'low' | null;
  source:
    | 'BLS'
    | 'Census ACS'
    | 'Census estimates'
    | 'Zillow'
    | 'Apartment List'
    | 'Census BPS'
    | 'Appraisal districts'
    | 'Texas Comptroller'
    | 'HUD'
    | 'TxDOT';
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

/** A Texas county on the "where people are moving" list. */
export interface CountyRow {
  county: string;
  /** The Terra market the county belongs to, if any. */
  market: string | null;
  population: number;
  change: number | null;
  growth: number | null;
  migration: number | null;
}

export interface MarketSnapshot {
  generatedAt: string;
  metrics: MarketMetric[];
  groups: MarketGroup[];
  markets: MarketArea[];
  sources: { name: string; url: string; detail: string }[];
  /** National interest rates and lending conditions: the same for every city, so shown once. */
  rates?: RateReading[];
  /** The Texas counties that added the most people, with the estimate year. */
  counties?: { year: number; rows: CountyRow[] };
  /** Current development projects per city, for the map (TDLR TABS filings). */
  developments?: DevelopmentsResult;
}

/** Appraisal district figures per property type, keyed cad{Type}{Figure}. */
const CAD_TYPES: { cls: PropertyClass; key: string; label: string; what: string }[] = [
  { cls: 'multifamily', key: 'Apartment', label: 'apartments', what: 'apartment properties (state code B)' },
  { cls: 'commercial', key: 'Commercial', label: 'commercial', what: 'commercial properties: office, retail, hotel and other (state code F1)' },
  { cls: 'industrial', key: 'Industrial', label: 'industrial', what: 'industrial properties (state code F2)' }
];

const APPRAISED = 'Appraised by the county appraisal district, not a sale price: Texas does not disclose sale prices.';

function appraisalMetrics(): MarketMetric[] {
  return CAD_TYPES.flatMap(({ key, label, what }): MarketMetric[] => [
    {
      key: `cad${key}Value`,
      label: `Median appraised value, ${label}`,
      unit: 'usd',
      better: null,
      source: 'Appraisal districts',
      note: `Median appraised value of the city's ${what}. ${APPRAISED}`
    },
    {
      key: `cad${key}Growth`,
      label: `Appraised value change, ${label}`,
      unit: 'change',
      better: 'high',
      source: 'Appraisal districts',
      note: `Change in appraised value of the same ${label} properties from last year's roll.`
    },
    {
      key: `cad${key}LandPsf`,
      label: `Land value per sq ft, ${label} (average)`,
      unit: 'usd',
      better: null,
      source: 'Appraisal districts',
      note: `Average appraised land value per square foot under the city's ${what}, leaving out parcels under 500 sq ft and the top and bottom 1%. ${APPRAISED}`
    },
    {
      key: `cad${key}LandPsfMedian`,
      label: `Land value per sq ft, ${label} (median)`,
      unit: 'usd',
      better: null,
      source: 'Appraisal districts',
      note: `Median appraised land value per square foot under the city's ${label} properties. ${APPRAISED}`
    },
    {
      key: `cad${key}Total`,
      label: `Total appraised value, ${label}`,
      unit: 'usd',
      better: 'high',
      source: 'Appraisal districts',
      note: `All ${what} in the city, added up. ${APPRAISED}`
    }
  ]);
}

const TAX_NOTE = 'Dollars per $100 of taxable value, which is the same as a percent of value.';

const cad = (type: string, ...figures: string[]) => figures.map((figure) => `cad${type}${figure}`);

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
  { key: 'permitGrowth', label: 'Permit growth', unit: 'change', better: 'high', source: 'Census BPS', note: 'Homes permitted this year so far vs. the same months last year.' },
  {
    key: 'pepPopulation',
    label: 'Population (latest estimate)',
    unit: 'count',
    better: 'high',
    source: 'Census estimates',
    note: 'Residents on July 1, from the Census Bureau population estimates: a year newer than the ACS.'
  },
  { key: 'pepGrowth', label: 'Population growth (latest estimate)', unit: 'change', better: 'high', source: 'Census estimates', note: 'Residents vs. July 1 a year earlier.' },
  {
    key: 'migrationRate',
    label: 'Net migration rate',
    unit: 'rate',
    better: 'high',
    source: 'Census estimates',
    note: 'People who moved in minus people who moved out over the year, from other states and abroad, as a share of residents. The cleanest read on where people want to live.'
  },
  { key: 'netMigration', label: 'Net migration', unit: 'count', better: 'high', source: 'Census estimates', note: 'Movers in minus movers out over the year, from the rest of the U.S. and abroad.' },
  {
    key: 'domesticMigration',
    label: 'Net moves from other U.S. areas',
    unit: 'count',
    better: 'high',
    source: 'Census estimates',
    note: 'People moving in from other states and counties minus people leaving for them.'
  },
  { key: 'internationalMigration', label: 'Net moves from abroad', unit: 'count', better: 'high', source: 'Census estimates', note: 'People moving in from outside the U.S., net.' },
  { key: 'naturalChange', label: 'Births minus deaths', unit: 'count', better: 'high', source: 'Census estimates', note: 'Growth that comes from births minus deaths, not moves.' },
  {
    key: 'taxRate',
    label: 'Property tax rate (combined)',
    unit: 'taxRate',
    better: 'low',
    source: 'Texas Comptroller',
    note: `City, county, main school district and the county-wide college, hospital, flood and port districts, added up for a typical property inside the city. ${TAX_NOTE} Parts of a city in another school district or a utility district pay a different total.`
  },
  {
    key: 'taxOnMillion',
    label: 'Yearly tax on $1M of value',
    unit: 'usd',
    better: 'low',
    source: 'Texas Comptroller',
    note: 'The combined rate applied to $1 million of taxable value, before any exemptions. A quick way to compare carrying costs.'
  },
  { key: 'taxRateChange', label: 'Tax rate change', unit: 'change', better: 'low', source: 'Texas Comptroller', note: 'Combined rate vs. the year before.' },
  { key: 'taxRateCity', label: 'City tax rate', unit: 'taxRate', better: 'low', source: 'Texas Comptroller', note: `The city's own rate. ${TAX_NOTE}` },
  { key: 'taxRateCounty', label: 'County tax rate', unit: 'taxRate', better: 'low', source: 'Texas Comptroller', note: `The county's rate. ${TAX_NOTE}` },
  {
    key: 'taxRateSchool',
    label: 'School district tax rate',
    unit: 'taxRate',
    better: 'low',
    source: 'Texas Comptroller',
    note: `The main school district in the city (Houston ISD, Dallas ISD, Fort Worth ISD, Austin ISD, San Antonio ISD, El Paso ISD): usually the biggest piece. ${TAX_NOTE}`
  },
  {
    key: 'taxRateOther',
    label: 'Other district rates',
    unit: 'taxRate',
    better: 'low',
    source: 'Texas Comptroller',
    note: `Community college, hospital, flood control, port and river authority rates that cover the whole county. ${TAX_NOTE}`
  },
  {
    key: 'ozTracts',
    label: 'Opportunity Zone tracts',
    unit: 'count',
    better: 'high',
    source: 'HUD',
    note: 'Census tracts in the metro designated as Qualified Opportunity Zones, where investing capital gains earns a federal tax break.'
  },
  {
    key: 'txdotPlanned',
    label: 'Highway projects starting within 4 years',
    unit: 'usd',
    better: 'high',
    source: 'TxDOT',
    note: "Estimated construction cost of active state highway projects in the area's TxDOT district set to begin construction within four years. New and wider roads raise nearby land values."
  },
  {
    key: 'txdotUnderway',
    label: 'Highway projects underway or starting soon',
    unit: 'usd',
    better: 'high',
    source: 'TxDOT',
    note: "Estimated construction cost of state highway projects in the area's TxDOT district that are under construction or about to start."
  },
  ...appraisalMetrics(),
  {
    key: 'cadNewConstruction',
    label: 'New construction added to the roll',
    unit: 'usd',
    better: 'high',
    source: 'Appraisal districts',
    note: 'Appraised value of new commercial, industrial and apartment construction added this year. Only Harris County reports it.'
  }
];


export const GROUPS: MarketGroup[] = [
  {
    key: 'overview',
    label: 'Overview',
    blurb: 'The economy every property type leans on: jobs, people, and paychecks.',
    metrics: ['jobsGrowth', 'unemployment', 'pepGrowth', 'migrationRate', 'populationGrowth', 'medianIncome', 'taxRate', 'jobs', 'pepPopulation', 'population']
  },
  {
    key: 'migration',
    label: 'Population & migration',
    blurb: 'Where people are moving: the demand behind every new home, store and office.',
    metrics: ['migrationRate', 'pepGrowth', 'netMigration', 'domesticMigration', 'internationalMigration', 'naturalChange', 'pepPopulation']
  },
  {
    key: 'office',
    label: 'Office',
    blurb: 'Office demand follows the industries that work at desks.',
    metrics: ['officeJobsGrowth', 'officeJobs', 'jobsGrowth', 'unemployment', ...cad('Commercial', 'Growth', 'Value', 'LandPsf', 'LandPsfMedian', 'Total')]
  },
  {
    key: 'industrial',
    label: 'Industrial',
    blurb: 'Warehouses and plants fill as manufacturing, distribution and logistics hire.',
    metrics: [
      'industrialJobsGrowth',
      'industrialJobs',
      'populationGrowth',
      'jobsGrowth',
      ...cad('Industrial', 'Growth', 'Value', 'LandPsf', 'LandPsfMedian', 'Total')
    ]
  },
  {
    key: 'retail',
    label: 'Retail',
    blurb: 'Stores follow rooftops and spending power.',
    metrics: ['retailJobsGrowth', 'retailJobs', 'medianIncome', 'populationGrowth', ...cad('Commercial', 'Growth', 'Value', 'LandPsf')]
  },
  {
    key: 'multifamily',
    label: 'Multifamily',
    blurb: 'Apartments: how tight the rental market is and where rents are heading.',
    metrics: [
      'aptVacancy',
      'aptRent',
      'aptRentGrowth',
      'zori',
      'zoriGrowth',
      'multifamilyPermitUnits',
      ...cad('Apartment', 'Growth', 'Value', 'LandPsf', 'LandPsfMedian', 'Total'),
      'rentalVacancy',
      'medianRent',
      'rentGrowth',
      'renterShare'
    ]
  },
  {
    key: 'development',
    label: 'Development',
    blurb: 'Building activity, land and home values, and a map of the projects under way.',
    metrics: [
      'permitUnits',
      'permitGrowth',
      'multifamilyPermitUnits',
      'cadNewConstruction',
      ...cad('Commercial', 'LandPsf'),
      ...cad('Industrial', 'LandPsf'),
      ...cad('Apartment', 'LandPsf'),
      'zhvi',
      'zhviGrowth',
      'constructionJobsGrowth',
      'constructionJobs',
      'txdotPlanned',
      'txdotUnderway',
      'ozTracts',
      'medianHomeValue',
      'homeValueGrowth'
    ]
  },
  {
    key: 'taxes',
    label: 'Taxes & incentives',
    blurb: 'Property tax is the biggest operating cost after debt in Texas, which has no state income tax. Opportunity Zones cut federal tax on gains invested there.',
    metrics: ['taxRate', 'taxOnMillion', 'taxRateChange', 'taxRateSchool', 'taxRateCity', 'taxRateCounty', 'taxRateOther', 'ozTracts']
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
  },
  {
    name: 'Federal Reserve Bank of St. Louis, FRED',
    url: 'https://fred.stlouisfed.org/',
    detail: 'Treasury yields, SOFR, the fed funds and prime rates, Freddie Mac mortgage rates, and the Fed senior loan officer survey. Updated daily to quarterly.'
  },
  {
    name: 'U.S. Census Bureau, Population Estimates',
    url: 'https://www.census.gov/programs-surveys/popest.html',
    detail: 'Residents each July 1 and the sources of change: births, deaths, moves within the U.S. and from abroad, for metros and counties. Updated each spring.'
  },
  {
    name: 'Texas Comptroller, property tax rates',
    url: 'https://comptroller.texas.gov/taxes/property-tax/rates/',
    detail: 'Adopted rates for every city, county, school district and special district in Texas. Updated yearly.'
  },
  {
    name: 'HUD, Opportunity Zones',
    url: 'https://hudgis-hud.opendata.arcgis.com/datasets/opportunity-zones',
    detail: 'Census tracts designated as Qualified Opportunity Zones.'
  },
  {
    name: 'TxDOT Project Tracker',
    url: 'https://apps3.txdot.gov/apps-cq/project_tracker/',
    detail: 'Active state highway projects with estimated construction cost and phase, by TxDOT district.'
  },
  {
    name: 'TDLR Texas Architectural Barriers System (TABS)',
    url: 'https://www.tdlr.texas.gov/TABS/Search/',
    detail:
      'Every commercial and public building project in Texas over $50,000 registers here before construction, with its address, owner and cost. The map shows each city\'s biggest new buildings and additions registered in the last year, placed with the free Census geocoder.'
  },
  {
    name: 'County appraisal districts (Harris, Dallas, Tarrant, Travis)',
    url: 'https://comptroller.texas.gov/taxes/property-tax/county-directory/',
    detail:
      'Appraised values and land values from each district\'s free certified roll download. Appraised, not sale prices. Bexar and El Paso do not allow automated downloads. Updated yearly.'
  }
];

/** The property-market sources, each null when it did not answer. */
export interface PropertyData {
  zillow?: ZillowResult | null;
  apartmentList?: ApartmentListResult | null;
  permits?: PermitResult | null;
  appraisal?: AppraisalFile | null;
  rates?: RateReading[] | null;
  population?: PepResult | null;
  taxes?: TaxRateResult | null;
  /** Opportunity Zone tracts per three-digit Texas county code. */
  zones?: Map<string, number> | null;
  /** TxDOT projects per district name. */
  txdot?: Map<string, DistrictProjects> | null;
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

    // Appraisal district roll summaries, for the cities whose district publishes one.
    const roll = property.appraisal?.cities.find((c) => c.city === metro.city);
    for (const { cls, key } of CAD_TYPES) {
      const summary = roll?.classes[cls];
      const period = roll?.period ?? null;
      set(`cad${key}Value`, summary?.medianValue, period);
      set(`cad${key}Growth`, summary?.valueGrowth, period);
      set(`cad${key}LandPsf`, summary?.landPsf, period);
      set(`cad${key}LandPsfMedian`, summary?.medianLandPsf, period);
      set(`cad${key}Total`, summary?.totalValue, period);
    }
    const built = roll ? Object.values(roll.classes).map((c) => c.newConstruction) : [];
    set('cadNewConstruction', built.some((v) => v != null) ? built.reduce<number>((a, b) => a + (b ?? 0), 0) : null, roll?.period ?? null);

    // Population estimates: the latest July 1 and where the change came from.
    const pep = property.population;
    const people = pep?.metros.get(metro.area);
    const pepYear = pep ? `July ${pep.year}` : null;
    set('pepPopulation', people?.population, pepYear);
    set('pepGrowth', people?.change != null ? growth(people.population, people.population - people.change) : null, pepYear);
    set('migrationRate', shareOf(people?.migration, people?.population), pepYear);
    set('netMigration', people?.migration, pepYear);
    set('domesticMigration', people?.domestic, pepYear);
    set('internationalMigration', people?.international, pepYear);
    set('naturalChange', people?.natural, pepYear);

    // Property tax: the combined rate on a typical property in the city.
    const taxes = property.taxes;
    const tax = taxes?.current.get(metro.city);
    const taxBefore = taxes?.previous.get(metro.city);
    const taxYear = taxes ? `${taxes.year} rates` : null;
    set('taxRate', tax?.total, taxYear);
    set('taxOnMillion', tax ? Math.round(tax.total * 10_000) : null, taxYear);
    set('taxRateChange', growth(tax?.total, taxBefore?.total), taxes ? `${taxes.year - 1}–${String(taxes.year).slice(2)}` : null);
    set('taxRateCity', tax?.city, taxYear);
    set('taxRateCounty', tax?.county, taxYear);
    set('taxRateSchool', tax?.school, taxYear);
    set('taxRateOther', tax?.other, taxYear);

    const zones = property.zones;
    set('ozTracts', zones ? metroZoneCount(metro, zones) : null, zones ? 'Designated 2018' : null);

    const roads = property.txdot?.get(metro.txdotDistrict);
    const asOfToday = `${metro.txdotDistrict} district, ${now.toISOString().slice(0, 10)}`;
    set('txdotPlanned', roads ? roads.planned : null, roads ? asOfToday : null);
    set('txdotUnderway', roads ? roads.underway : null, roads ? asOfToday : null);

    for (const metric of METRICS) {
      values[metric.key] ??= null;
      periods[metric.key] ??= null;
    }
    return { city: metro.city, metro: metro.name, values, periods };
  });

  const snapshot: MarketSnapshot = { generatedAt: now.toISOString(), metrics: METRICS, groups: GROUPS, markets, sources: SOURCES };
  if (property.rates?.length) snapshot.rates = property.rates;
  if (property.population?.counties.length) {
    const marketFor = (code: string) => metros.find((m) => m.counties.includes(code))?.city ?? null;
    snapshot.counties = {
      year: property.population.year,
      rows: topGrowingCounties(property.population.counties, 15).map((c) => ({
        county: c.county,
        market: marketFor(c.code),
        population: c.population,
        change: c.change,
        growth: c.growth,
        migration: c.migration
      }))
    };
  }
  return snapshot;
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
    rates: next.rates ?? previous.rates,
    counties: next.counties ?? previous.counties,
    developments: next.developments ?? previous.developments,
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
