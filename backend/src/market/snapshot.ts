import type { Research } from './research.js';
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
import { censusKey, growth, rentalVacancy, rentBurdened, renterShare, rentSeverelyBurdened, type AcsResult } from './census.js';
import type { ApartmentListResult } from './apartmentList.js';
import type { AppraisalFile, PropertyClass } from './appraisal.js';
import type { MonthlyReading } from './csv.js';
import type { BidsResult } from './bids.js';
import type { DevelopmentsResult } from './developments.js';
import type { SalaryFile } from './salaries.js';
import type { ZoningResult } from './zoning.js';
import type { RateReading } from './fred.js';
import type { Metro } from './metros.js';
import { metroZoneCount } from './opportunityZones.js';
import { shareOf, topGrowingCounties, type PepResult } from './pep.js';
import type { PermitResult } from './permits.js';
import type { TaxRateResult } from './taxRates.js';
import type { DistrictProjects } from './txdot.js';
import type { ZillowResult } from './zillow.js';
import type { RedfinReading } from './redfin.js';
import type { RealtorReading } from './realtor.js';
import type { HpiReading } from './fhfa.js';
import type { FmrReading } from './hudFmr.js';
import type { LihtcCount } from './lihtc.js';

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

/**
 * The area a figure actually describes. city: the municipality. metro: the
 * metro area, or for Dallas and Fort Worth their metropolitan division. msa:
 * the whole metro area even where a division exists (Realtor.com's DFW
 * figure). district: a TxDOT district. fmrArea: a HUD Fair Market Rent area.
 */
export type Geography = 'city' | 'metro' | 'msa' | 'district' | 'fmrArea';

/**
 * What kind of figure it is. economic: jobs, people and income, including the
 * employment proxies for office, industrial and retail demand (they are not
 * property performance). residential: home and apartment rents, values,
 * vacancy and listings. permits: residential building permits. appraisal:
 * appraisal district roll values (not sale prices or market rents). taxes:
 * property tax rates and tax incentives. infrastructure: public road spending.
 * commercial: direct office, industrial or retail performance; none of the
 * ranked metrics are this yet (broker lease figures live in research).
 */
export type Category = 'economic' | 'residential' | 'permits' | 'appraisal' | 'taxes' | 'infrastructure' | 'commercial';

/**
 * fresh: read on this build. retained: today's read failed or was rejected,
 * so the last good figure is kept, with its own period and fetch time.
 * expired: the kept figure passed its source's maximum age and was dropped.
 * missing: no figure has been read for this market.
 */
export type ValueStatus = 'fresh' | 'retained' | 'expired' | 'missing';

export type MetricSource = MarketMetric['source'];

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
    | 'TxDOT'
    | 'Redfin'
    | 'Realtor.com'
    | 'FHFA';
  /** One line on what the figure is, shown on hover and in the method notes. */
  note: string;
  geography: Geography;
  category: Category;
  /**
   * The plausible range for this metric from this source. A reading outside it
   * is rejected (logged, and the last good figure kept) instead of published.
   */
  valid: { min: number; max: number };
}

/** A metric as written below, before its geography, category and range are filled in. */
type MetricDraft = Omit<MarketMetric, 'geography' | 'category' | 'valid'> & Partial<Pick<MarketMetric, 'geography' | 'category'>>;

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
  /** When each value is from, e.g. "Aug 2026" or "2025": the source's reporting period. */
  periods: Record<string, string | null>;
  /** When each value was read from its source (ISO time); older than generatedAt for a retained value. */
  fetchedAt?: Record<string, string | null>;
  /** Whether each value was read on this build, kept from an earlier one, dropped as too old, or never read. */
  status?: Record<string, ValueStatus>;
  /**
   * For a metric whose figure is the same observation as an earlier market's
   * (New Braunfels repeating the San Antonio metro, Fort Worth repeating
   * Realtor.com's DFW figure), the city it repeats. Rankings count it once.
   */
  shared?: Record<string, City>;
}

/** What one source did on the build that wrote the file. */
export interface SourceOutcome {
  source: string;
  /** ok: answered. partial: answered with gaps. failed: no answer (figures kept from earlier). skipped: not run. */
  status: 'ok' | 'partial' | 'failed' | 'skipped';
  /** A short reason, with anything that looks like a key or token removed. */
  detail?: string;
}

/** A source whose newest figure is older than its publication schedule explains. */
export interface SourceLag {
  source: MetricSource;
  /** The newest period any market shows for the source, e.g. "May 2026". */
  latest: string;
  /** Days from the end of that period to the build. */
  days: number;
  maxLagDays: number;
}

/** A source reading that failed its metric's range check and was not published. */
export interface Rejection {
  city: City;
  key: string;
  value: number;
  min: number;
  max: number;
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
  /** 2 adds fetchedAt, status, shared, refresh and rejected; version 1 files have none of them. */
  schemaVersion?: number;
  generatedAt: string;
  /** Per-source outcomes of the build that wrote this file. */
  refresh?: SourceOutcome[];
  /** Readings dropped by the range checks on this build. */
  rejected?: Rejection[];
  /** Sources whose newest reporting period trails today by more than SOURCE_RULES allows. */
  behind?: SourceLag[];
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
  /** Open public construction bids per market (TxDOT lettings), listed under the map. */
  bids?: BidsResult;
  /** Brokerage vacancy and asking rents, and links to their free quarterly reports. */
  research?: Research;
  /** Pay on H-1B filings at commercial real estate employers, per market (salaries.yml). */
  salaries?: SalaryFile;
  /** Rezoning requests and special use permits on city agendas. */
  zoning?: ZoningResult;
}

/** Appraisal district figures per property type, keyed cad{Type}{Figure}. */
const CAD_TYPES: { cls: PropertyClass; key: string; label: string; what: string }[] = [
  { cls: 'multifamily', key: 'Apartment', label: 'apartments', what: 'apartment properties (state code B)' },
  // State code F1 does not split office from retail or hotels, so the label says so wherever it shows.
  { cls: 'commercial', key: 'Commercial', label: 'commercial (office, retail and hotel combined)', what: 'commercial properties: office, retail, hotel and other together (state code F1), not office or retail alone' },
  { cls: 'industrial', key: 'Industrial', label: 'industrial', what: 'industrial properties (state code F2)' }
];

const APPRAISED = 'Appraised by the county appraisal district, not a sale price: Texas does not disclose sale prices.';

function appraisalMetrics(): MetricDraft[] {
  return CAD_TYPES.flatMap(({ key, label, what }): MetricDraft[] => [
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

const DRAFTS: MetricDraft[] = [
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
    note: 'Employment proxy, not office occupancy: jobs in financial activities, professional and business services, and information, the industries that fill office space.'
  },
  { key: 'officeJobsGrowth', label: 'Office-using job growth', unit: 'change', better: 'high', source: 'BLS', note: 'Office-using jobs vs. a year earlier.' },
  {
    key: 'industrialJobs',
    label: 'Industrial jobs',
    unit: 'count',
    better: 'high',
    source: 'BLS',
    note: 'Employment proxy, not industrial occupancy: manufacturing plus wholesale, transportation, warehousing and utilities jobs, the tenants of industrial space.'
  },
  { key: 'industrialJobsGrowth', label: 'Industrial job growth', unit: 'change', better: 'high', source: 'BLS', note: 'Industrial jobs vs. a year earlier.' },
  { key: 'retailJobs', label: 'Retail jobs', unit: 'count', better: 'high', source: 'BLS', note: 'Employment proxy, not retail sales or occupancy: retail trade payrolls.' },
  { key: 'retailJobsGrowth', label: 'Retail job growth', unit: 'change', better: 'high', source: 'BLS', note: 'Retail jobs vs. a year earlier.' },
  {
    key: 'constructionJobs',
    label: 'Construction, mining and logging jobs',
    unit: 'count',
    better: 'high',
    source: 'BLS',
    note: 'Construction plus mining and logging payrolls (BLS supersector 15), the same count in every market: BLS publishes construction alone for only a few Texas metros. Mining weighs heavily in Midland.'
  },
  { key: 'constructionJobsGrowth', label: 'Construction, mining and logging job growth', unit: 'change', better: 'high', source: 'BLS', note: 'Construction, mining and logging jobs vs. a year earlier.' },
  { key: 'medianRent', label: 'Median residential rent', unit: 'usd', better: null, source: 'Census ACS', note: 'Residential: median gross rent (rent plus utilities) on all rented homes and apartments, metro-wide.' },
  { key: 'rentGrowth', label: 'Residential rent growth', unit: 'change', better: 'high', source: 'Census ACS', note: 'Residential: median gross rent vs. the year before.' },
  {
    key: 'rentalVacancy',
    label: 'Residential rental vacancy',
    unit: 'rate',
    better: 'low',
    source: 'Census ACS',
    note: 'Residential: homes and apartments for rent as a share of the rental stock, metro-wide. Lower means a tighter rental market. Not commercial vacancy.'
  },
  { key: 'renterShare', label: 'Renter households', unit: 'rate', better: 'high', source: 'Census ACS', note: 'Share of occupied homes that are rented: the apartment demand pool.' },
  {
    key: 'rentBurdened',
    label: 'Renters paying 30%+ of income',
    unit: 'rate',
    better: null,
    source: 'Census ACS',
    note: 'Share of renter households spending 30% or more of income on rent and utilities: HUD\'s "cost burdened" line, the need affordable housing serves.'
  },
  {
    key: 'rentSeverelyBurdened',
    label: 'Renters paying 50%+ of income',
    unit: 'rate',
    better: null,
    source: 'Census ACS',
    note: 'Share of renter households spending half or more of income on rent and utilities ("severely cost burdened").'
  },
  { key: 'renterHouseholds', label: 'Renter households (count)', unit: 'count', better: null, source: 'Census ACS', note: 'Occupied homes that are rented.' },
  { key: 'medianHomeValue', label: 'Median home value (residential)', unit: 'usd', better: null, source: 'Census ACS', note: 'Owner-estimated value of owner-occupied homes.' },
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
    label: 'New homes permitted (residential)',
    unit: 'count',
    better: 'high',
    source: 'Census BPS',
    note: 'Residential only: housing units the city authorized in new buildings this year so far, as reported to the Census Building Permits Survey.'
  },
  {
    key: 'multifamilyPermitUnits',
    label: 'Apartment units permitted (residential)',
    unit: 'count',
    better: 'high',
    source: 'Census BPS',
    note: 'Of those, units in buildings of five or more: the apartment pipeline.'
  },
  { key: 'permitGrowth', label: 'Residential permit growth', unit: 'change', better: 'high', source: 'Census BPS', note: 'Residential: homes permitted this year so far vs. the same months last year.' },
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
    note: `The main school district in the city (Houston ISD, Dallas ISD, Fort Worth ISD, Austin ISD, San Antonio ISD, El Paso ISD, New Braunfels ISD, College Station ISD, Galveston ISD, Lubbock ISD, Midland ISD): usually the biggest piece. ${TAX_NOTE}`
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
  { key: 'redfinPrice', label: 'Median sale price (Redfin)', unit: 'usd', better: null, source: 'Redfin', note: 'Median price of homes sold in the city (all residential), latest month in Redfin\'s public file.' },
  { key: 'redfinPriceGrowth', label: 'Sale price growth (Redfin)', unit: 'change', better: 'high', source: 'Redfin', note: 'Median sale price vs. a year earlier.' },
  { key: 'redfinInventory', label: 'Homes for sale (Redfin)', unit: 'count', better: null, source: 'Redfin', note: 'Active listings in the city at the end of the period.' },
  { key: 'redfinDom', label: 'Days on market (Redfin)', unit: 'count', better: 'low', source: 'Redfin', note: 'Median days from listing to contract for homes sold.' },
  { key: 'redfinSaleToList', label: 'Sale-to-list price (Redfin)', unit: 'rate', better: 'high', source: 'Redfin', note: 'Average sale price as a share of the last list price. Over 100% means bidding above asking.' },
  { key: 'rdcListPrice', label: 'Median listing price (Realtor.com)', unit: 'usd', better: null, source: 'Realtor.com', note: 'Median asking price of homes listed in the metro, latest month. Dallas and Fort Worth share the Dallas-Fort Worth metro figure.' },
  { key: 'rdcListings', label: 'Active listings (Realtor.com)', unit: 'count', better: null, source: 'Realtor.com', note: 'Homes listed for sale in the metro, latest month.' },
  { key: 'rdcDom', label: 'Days on market (Realtor.com)', unit: 'count', better: 'low', source: 'Realtor.com', note: 'Median days listings in the metro have been on the market.' },
  { key: 'rdcPriceReduced', label: 'Listings with a price cut (Realtor.com)', unit: 'rate', better: 'low', source: 'Realtor.com', note: 'Share of metro listings that cut their asking price. Higher means a softer market.' },
  { key: 'hpi', label: 'House price index (FHFA)', unit: 'count', better: null, source: 'FHFA', note: 'FHFA all-transactions house price index for the metro or metro division (1995 Q1 = 100), from repeat sales and refinance appraisals.' },
  { key: 'hpiGrowth', label: 'House prices, 1-year change (FHFA)', unit: 'change', better: 'high', source: 'FHFA', note: 'FHFA index vs. the same quarter a year earlier.' },
  { key: 'hpiGrowth5y', label: 'House prices, 5-year change (FHFA)', unit: 'change', better: 'high', source: 'FHFA', note: 'FHFA index vs. the same quarter five years earlier.' },
  ...['Efficiency', 'One-bedroom', 'Two-bedroom', 'Three-bedroom', 'Four-bedroom'].map(
    (label, beds): MetricDraft => ({
      key: `fmr${beds}`,
      label: `Fair Market Rent, ${label.toLowerCase()}`,
      unit: 'usd',
      better: null,
      source: 'HUD',
      note: `HUD Fair Market Rent for a ${label.toLowerCase()} unit in the metro FMR area: the rent ceiling Housing Choice Vouchers are set from (rent plus utilities, 40th percentile).`
    })
  ),
  {
    key: 'cadNewConstruction',
    label: 'New construction added to the roll',
    unit: 'usd',
    better: 'high',
    source: 'Appraisal districts',
    note: 'Appraised value of new commercial, industrial and apartment construction added this year. Only Harris County reports it.'
  }
];

/**
 * Where each source's figures come from, what kind of figure they are, and how
 * long a figure may be kept after its source stops answering. The age runs
 * from the last successful read, not the reporting period, so a yearly survey
 * is not dropped just for being a year old: it is dropped only after its
 * source has failed for longer than one release cycle plus slack.
 */
/**
 * maxAgeDays: how long a figure may be kept after its source stops answering.
 * maxLagDays: how far the newest reporting period may trail today before the
 * source is flagged as behind (a source can answer every day with an old
 * file, as Redfin's public download has since June 2026); null where the
 * period is not a date (TxDOT's live list, the 2018 Opportunity Zone map).
 */
export const SOURCE_RULES: Record<MetricSource, { geography: Geography; category: Category; maxAgeDays: number; maxLagDays: number | null }> = {
  BLS: { geography: 'metro', category: 'economic', maxAgeDays: 120, maxLagDays: 150 },
  'Census ACS': { geography: 'metro', category: 'residential', maxAgeDays: 800, maxLagDays: 700 },
  'Census estimates': { geography: 'metro', category: 'economic', maxAgeDays: 800, maxLagDays: 550 },
  Zillow: { geography: 'city', category: 'residential', maxAgeDays: 120, maxLagDays: 90 },
  'Apartment List': { geography: 'city', category: 'residential', maxAgeDays: 120, maxLagDays: 90 },
  'Census BPS': { geography: 'city', category: 'permits', maxAgeDays: 150, maxLagDays: 120 },
  'Appraisal districts': { geography: 'city', category: 'appraisal', maxAgeDays: 800, maxLagDays: 550 },
  'Texas Comptroller': { geography: 'city', category: 'taxes', maxAgeDays: 800, maxLagDays: 550 },
  HUD: { geography: 'fmrArea', category: 'residential', maxAgeDays: 800, maxLagDays: null },
  TxDOT: { geography: 'district', category: 'infrastructure', maxAgeDays: 30, maxLagDays: null },
  Redfin: { geography: 'city', category: 'residential', maxAgeDays: 150, maxLagDays: 90 },
  'Realtor.com': { geography: 'msa', category: 'residential', maxAgeDays: 120, maxLagDays: 90 },
  FHFA: { geography: 'metro', category: 'residential', maxAgeDays: 270, maxLagDays: 200 }
};

/** Metrics whose geography or category differs from their source's default. */
const OVERRIDES: Record<string, Partial<Pick<MarketMetric, 'geography' | 'category'>>> = {
  population: { category: 'economic' },
  populationGrowth: { category: 'economic' },
  medianIncome: { category: 'economic' },
  ozTracts: { geography: 'metro', category: 'taxes' }
};

const growthRange = (limit: number) => ({ min: -limit, max: limit });
const share = { min: 0, max: 100 };
const homePrice = { min: 20_000, max: 5_000_000 };
const jobCount = { min: 100, max: 10_000_000 };

/**
 * Plausible ranges, metric by metric. Wide enough for any real Texas market,
 * narrow enough to catch a unit change (a fraction read as a percent), a
 * shifted CSV column or a zero standing in for "no data".
 */
const VALID: Record<string, { min: number; max: number }> = {
  jobs: { min: 1_000, max: 10_000_000 },
  jobsGrowth: growthRange(30),
  unemployment: { min: 0, max: 40 },
  population: { min: 10_000, max: 50_000_000 },
  populationGrowth: growthRange(15),
  medianIncome: { min: 15_000, max: 300_000 },
  officeJobs: jobCount,
  officeJobsGrowth: growthRange(50),
  industrialJobs: jobCount,
  industrialJobsGrowth: growthRange(50),
  retailJobs: jobCount,
  retailJobsGrowth: growthRange(50),
  constructionJobs: jobCount,
  constructionJobsGrowth: growthRange(50),
  medianRent: { min: 200, max: 6_000 },
  rentGrowth: growthRange(30),
  rentalVacancy: { min: 0, max: 50 },
  renterShare: { min: 5, max: 95 },
  rentBurdened: share,
  rentSeverelyBurdened: share,
  renterHouseholds: { min: 1_000, max: 10_000_000 },
  medianHomeValue: homePrice,
  homeValueGrowth: growthRange(40),
  zhvi: homePrice,
  zhviGrowth: growthRange(40),
  zori: { min: 300, max: 10_000 },
  zoriGrowth: growthRange(40),
  aptRent: { min: 300, max: 10_000 },
  aptRentGrowth: growthRange(40),
  aptVacancy: { min: 0, max: 40 },
  permitUnits: { min: 0, max: 200_000 },
  multifamilyPermitUnits: { min: 0, max: 200_000 },
  // Year-to-date counts swing hard in small cities: one big complex can multiply a year's total.
  permitGrowth: { min: -100, max: 2_000 },
  pepPopulation: { min: 10_000, max: 50_000_000 },
  pepGrowth: growthRange(15),
  migrationRate: growthRange(15),
  netMigration: growthRange(1_000_000),
  domesticMigration: growthRange(1_000_000),
  internationalMigration: growthRange(1_000_000),
  naturalChange: growthRange(1_000_000),
  taxRate: { min: 0.5, max: 5 },
  taxOnMillion: { min: 5_000, max: 50_000 },
  taxRateChange: growthRange(50),
  taxRateCity: { min: 0, max: 3 },
  taxRateCounty: { min: 0, max: 2 },
  taxRateSchool: { min: 0, max: 3 },
  taxRateOther: { min: 0, max: 2 },
  ozTracts: { min: 0, max: 2_000 },
  txdotPlanned: { min: 0, max: 1e12 },
  txdotUnderway: { min: 0, max: 1e12 },
  cadNewConstruction: { min: 0, max: 1e12 },
  redfinPrice: homePrice,
  redfinPriceGrowth: growthRange(50),
  redfinInventory: { min: 0, max: 1_000_000 },
  redfinDom: { min: 0, max: 365 },
  redfinSaleToList: { min: 70, max: 130 },
  rdcListPrice: homePrice,
  rdcListings: { min: 0, max: 1_000_000 },
  rdcDom: { min: 0, max: 365 },
  rdcPriceReduced: share,
  hpi: { min: 50, max: 2_000 },
  hpiGrowth: growthRange(40),
  hpiGrowth5y: { min: -60, max: 300 },
  ...Object.fromEntries([0, 1, 2, 3, 4].map((beds) => [`fmr${beds}`, { min: 200, max: 8_000 }])),
  ...Object.fromEntries(
    CAD_TYPES.flatMap(({ key }) => [
      [`cad${key}Value`, { min: 1_000, max: 1e10 }],
      [`cad${key}Growth`, { min: -80, max: 300 }],
      [`cad${key}LandPsf`, { min: 0, max: 2_000 }],
      [`cad${key}LandPsfMedian`, { min: 0, max: 2_000 }],
      [`cad${key}Total`, { min: 0, max: 1e13 }]
    ])
  )
};

// LIHTC (lihtcProjects, lihtcUnits, lihtcRecent) is left out on purpose: HUD's
// download sits behind a bot check for automated clients (export-market.ts),
// so the figures were always blank. Add them back here once a source answers.
export const METRICS: MarketMetric[] = DRAFTS.map((draft) => {
  const rule = SOURCE_RULES[draft.source];
  const valid = VALID[draft.key];
  if (!valid) throw new Error(`No valid range for market metric ${draft.key}`);
  return { geography: rule.geography, category: rule.category, ...OVERRIDES[draft.key], ...draft, valid };
});

const METRIC_BY_KEY = new Map(METRICS.map((m) => [m.key, m]));

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
      'fmr1',
      'fmr2',
      'rentalVacancy',
      'medianRent',
      'rentGrowth',
      'renterShare'
    ]
  },
  {
    key: 'affordable',
    label: 'Affordable housing',
    blurb: 'How many renters are stretched by housing costs: the demand behind LIHTC, workforce and public housing.',
    metrics: [
      'rentBurdened',
      'rentSeverelyBurdened',
      'fmr0',
      'fmr1',
      'fmr2',
      'fmr3',
      'fmr4',
      'medianRent',
      'rentGrowth',
      'medianIncome',
      'renterHouseholds',
      'renterShare',
      'rentalVacancy'
    ]
  },
  {
    key: 'housing',
    label: 'For-sale housing',
    blurb: 'Home prices, listings and how fast homes sell: the pulse of homebuilding, land and build-to-rent.',
    metrics: [
      'redfinPrice',
      'redfinPriceGrowth',
      'redfinSaleToList',
      'redfinDom',
      'redfinInventory',
      'rdcListPrice',
      'rdcListings',
      'rdcDom',
      'rdcPriceReduced',
      'hpiGrowth',
      'hpiGrowth5y',
      'hpi',
      'zhvi',
      'zhviGrowth',
      'medianHomeValue',
      'homeValueGrowth'
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
      'constructionJobsGrowth',
      'constructionJobs',
      'txdotPlanned',
      'txdotUnderway',
      'ozTracts'
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
    name: 'Partners Real Estate and Cushman & Wakefield',
    url: 'https://partnersrealestate.com/research/',
    detail: 'Office, industrial and retail vacancy and average asking rent from each firm\'s free quarterly market reports, credited and linked on the Lease rates view. Updated quarterly.'
  },
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
    name: 'Redfin Data Center',
    url: 'https://www.redfin.com/news/data-center/',
    detail: 'City market tracker: median sale price, homes for sale, days on market and sale-to-list ratio, monthly. Redfin\'s public download has not been updated since June 2, 2026, so its latest month is May 2026; the page marks it as behind.'
  },
  {
    name: 'Realtor.com Economic Research',
    url: 'https://www.realtor.com/research/data/',
    detail: 'Monthly inventory core metrics by metro: median listing price, active listings, days on market and price cuts.'
  },
  {
    name: 'FHFA House Price Index',
    url: 'https://www.fhfa.gov/data/hpi',
    detail: 'All-transactions house price index by metro and metropolitan division. Updated quarterly.'
  },
  {
    name: 'HUD Fair Market Rents',
    url: 'https://www.huduser.gov/portal/datasets/fmr.html',
    detail: 'Fair Market Rents by bedroom count for each metro FMR area, from the HUD User API. Updated each fiscal year.'
  },
  {
    name: 'Federal Reserve Bank of Dallas, Texas Business Outlook Surveys (via FRED)',
    url: 'https://www.dallasfed.org/research/surveys/tmos',
    detail: 'Texas Manufacturing Outlook Survey general business activity index. Updated monthly.'
  },
  {
    name: 'County appraisal districts (Harris, Dallas, Tarrant, Travis)',
    url: 'https://comptroller.texas.gov/taxes/property-tax/county-directory/',
    detail:
      'Appraised values and land values from each district\'s free certified roll download. Appraised, not sale prices. Bexar and El Paso do not allow automated downloads; Comal (New Braunfels), Brazos, Galveston, Lubbock and Midland are not read yet. Updated yearly.'
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
  redfin?: Map<City, RedfinReading> | null;
  /** Realtor.com readings per CBSA code. */
  realtor?: Map<string, RealtorReading> | null;
  /** FHFA index per metro or division code. */
  fhfa?: Map<string, HpiReading> | null;
  fmr?: Map<City, FmrReading> | null;
  /** LIHTC counts per metro area code. */
  lihtc?: Map<string, LihtcCount> | null;
}

/** Every BLS series the snapshot reads, for one request batch. */
export function blsSeriesFor(metros: Metro[]): string[] {
  const industries: Industry[] = [
    'total',
    'miningConstruction',
    'manufacturing',
    'tradeTransportUtilities',
    'retail',
    'information',
    'financial',
    'professional'
  ];
  // A city sharing its metro (New Braunfels in San Antonio's, Galveston in Houston's) asks for the same series once.
  return [...new Set(metros.flatMap((metro) => [...industries.map((industry) => cesSeries(metro, industry)), unemploymentSeries(metro)]))];
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
  const fetchedAt = now.toISOString();
  const rejected: Rejection[] = [];
  const markets = metros.map((metro): MarketArea => {
    const values: Record<string, number | null> = {};
    const periods: Record<string, string | null> = {};
    const set = (key: string, value: number | null | undefined, period: string | null) => {
      let ok = value != null && Number.isFinite(value);
      const valid = METRIC_BY_KEY.get(key)?.valid;
      if (ok && valid && (value! < valid.min || value! > valid.max)) {
        // Out of range: drop it, so fillFromPrevious keeps the last good figure.
        rejected.push({ city: metro.city, key, value: value!, min: valid.min, max: valid.max });
        ok = false;
      }
      values[key] = ok ? value! : null;
      periods[key] = ok ? period : null;
    };
    // Metro-wide figures for a city that shares its metro say whose they are.
    const metroWide = (period: string | null | undefined): string | null =>
      period && metro.sharedMetro ? `${period}, ${metro.sharedMetro}` : (period ?? null);

    // Jobs: levels and year-over-year change, per industry group.
    const series = (industry: Industry) => bls?.get(cesSeries(metro, industry));
    const jobs = (key: string, points: Point[] | undefined) => {
      const last = latest(points);
      set(key, last ? Math.round(last.value * THOUSANDS) : null, metroWide(monthLabel(last)));
      set(`${key}Growth`, yearOverYear(points), metroWide(monthLabel(last)));
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
    // Mining, logging and construction (CES 15) for every market: BLS publishes
    // construction alone (CES 20) for only a few Texas metros, and ranking one
    // against the other compared different industries.
    jobs('constructionJobs', series('miningConstruction'));

    const unemployment = bls?.get(unemploymentSeries(metro));
    set('unemployment', latest(unemployment)?.value, metroWide(monthLabel(latest(unemployment))));

    // Census: levels for the latest year, growth against the year before.
    const row = acs?.current.get(censusKey(metro));
    const before = acs?.previous.get(censusKey(metro));
    const year = metroWide(acs ? String(acs.year) : null);
    const span = metroWide(acs ? `${acs.year - 1}–${String(acs.year).slice(2)}` : null);
    set('population', row?.population, year);
    set('populationGrowth', growth(row?.population, before?.population), span);
    set('medianIncome', row?.medianIncome, year);
    set('medianRent', row?.medianRent, year);
    set('rentGrowth', growth(row?.medianRent, before?.medianRent), span);
    set('rentalVacancy', rentalVacancy(row), year);
    set('renterShare', renterShare(row), year);
    set('renterHouseholds', row?.renterOccupied, year);
    set('rentBurdened', rentBurdened(row), year);
    set('rentSeverelyBurdened', rentSeverelyBurdened(row), year);
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
    // A class the roll did not report is unknown, not zero: the total covers the
    // classes reported, and its period names any left out.
    const built = CAD_TYPES.map(({ cls, label }) => ({ label, value: roll?.classes[cls]?.newConstruction ?? null }));
    const reported = built.filter((b) => b.value != null);
    const left = built.filter((b) => b.value == null).map((b) => b.label.split(' ')[0]);
    set(
      'cadNewConstruction',
      reported.length ? reported.reduce((sum, b) => sum + b.value!, 0) : null,
      roll && reported.length ? `${roll.period}${left.length ? `, excl. ${left.join(' and ')} (not reported)` : ''}` : null
    );

    // Population estimates: the latest July 1 and where the change came from.
    const pep = property.population;
    const people = pep?.metros.get(metro.area);
    const pepYear = metroWide(pep ? `July ${pep.year}` : null);
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
    set('ozTracts', zones ? metroZoneCount(metro, zones) : null, metroWide(zones ? 'Designated 2018' : null));

    const roads = property.txdot?.get(metro.txdotDistrict);
    const asOfToday = `${metro.txdotDistrict} district, ${now.toISOString().slice(0, 10)}`;
    set('txdotPlanned', roads ? roads.planned : null, roads ? asOfToday : null);
    set('txdotUnderway', roads ? roads.underway : null, roads ? asOfToday : null);

    const sale = property.redfin?.get(metro.city);
    const salePeriod = sale?.period ?? null;
    set('redfinPrice', sale?.medianSalePrice, salePeriod);
    set('redfinPriceGrowth', sale?.medianSalePriceYoy, salePeriod);
    set('redfinInventory', sale?.inventory, salePeriod);
    set('redfinDom', sale?.medianDom, salePeriod);
    set('redfinSaleToList', sale?.saleToList, salePeriod);

    const listing = property.realtor?.get(metro.census.msa);
    const listPeriod = listing ? (metro.census.division ? `${listing.period}, DFW metro` : metroWide(listing.period)) : null;
    set('rdcListPrice', listing?.medianListingPrice, listPeriod);
    set('rdcListings', listing?.activeListings, listPeriod);
    set('rdcDom', listing?.medianDom, listPeriod);
    set('rdcPriceReduced', listing?.priceReducedShare, listPeriod);

    const hpi = property.fhfa?.get(metro.area);
    set('hpi', hpi?.index, metroWide(hpi?.period));
    set('hpiGrowth', hpi?.change1y, metroWide(hpi?.period));
    set('hpiGrowth5y', hpi?.change5y, metroWide(hpi?.period));

    const fmr = property.fmr?.get(metro.city);
    fmr?.rents.forEach((rent, beds) => set(`fmr${beds}`, rent, metroWide(fmr.period)));

    // LIHTC counts (property.lihtc) are not published until HUD's download answers; see METRICS.

    const fetched: Record<string, string | null> = {};
    const status: Record<string, ValueStatus> = {};
    for (const metric of METRICS) {
      values[metric.key] ??= null;
      periods[metric.key] ??= null;
      fetched[metric.key] = values[metric.key] != null ? fetchedAt : null;
      status[metric.key] = values[metric.key] != null ? 'fresh' : 'missing';
    }
    return { city: metro.city, metro: metro.name, values, periods, fetchedAt: fetched, status, shared: sharedFor(metros, metro) };
  });

  const snapshot: MarketSnapshot = {
    schemaVersion: 2,
    generatedAt: fetchedAt,
    metrics: METRICS,
    groups: GROUPS,
    markets,
    sources: SOURCES,
    rejected
  };
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

const DAY_MS = 86_400_000;

const MONTH_NAMES = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

/**
 * The last day of a reporting period as the snapshot writes it: "Aug 2026",
 * "Jan–Aug 2026", "July 2025", "Q2 2026", "2024", "2024–25", "FY 2027",
 * "2025 rates", "2026 certified". Anything after a comma (", San Antonio
 * metro") is ignored. Null when there is no date in it.
 */
export function periodEnd(period: string | null | undefined): Date | null {
  const text = (period ?? '').split(',')[0]!.trim();
  const quarter = /Q([1-4]) (\d{4})/.exec(text);
  if (quarter) return new Date(Date.UTC(Number(quarter[2]), Number(quarter[1]) * 3, 0));
  const months = [...text.matchAll(/\b([A-Z][a-z]+) (\d{4})\b/g)].filter((m) => MONTH_NAMES.includes(m[1]!.slice(0, 3).toLowerCase()));
  const month = months.at(-1) ?? /([A-Z][a-z]{2})–[A-Z][a-z]{2} (\d{4})/.exec(text);
  if (month) {
    const index = MONTH_NAMES.indexOf(month[1]!.slice(0, 3).toLowerCase());
    if (index >= 0) return new Date(Date.UTC(Number(month[2]), index + 1, 0));
  }
  const fiscal = /FY (\d{4})/.exec(text);
  if (fiscal) return new Date(Date.UTC(Number(fiscal[1]), 8, 30));
  const span = /(\d{4})–(\d{2})\b/.exec(text);
  if (span) return new Date(Date.UTC(2000 + Number(span[2]), 11, 31));
  const year = /\b(\d{4})\b/.exec(text);
  if (year) return new Date(Date.UTC(Number(year[1]), 11, 31));
  return null;
}

/**
 * Sources whose newest period across the markets is older than their rule
 * allows: the source answered, but with an old file. Figures stay published
 * with their own period; this only flags them.
 */
export function laggingSources(snapshot: MarketSnapshot): SourceLag[] {
  const built = Date.parse(snapshot.generatedAt);
  const newest = new Map<MetricSource, { end: number; period: string }>();
  for (const metric of snapshot.metrics) {
    if (SOURCE_RULES[metric.source]?.maxLagDays == null) continue;
    for (const market of snapshot.markets) {
      if (market.values[metric.key] == null) continue;
      const period = market.periods[metric.key];
      const end = periodEnd(period)?.getTime();
      if (end == null || !period) continue;
      const have = newest.get(metric.source);
      if (!have || end > have.end) newest.set(metric.source, { end, period: period.split(',')[0]!.trim() });
    }
  }
  const out: SourceLag[] = [];
  for (const [source, { end, period }] of newest) {
    const maxLagDays = SOURCE_RULES[source].maxLagDays!;
    const days = Math.floor((built - end) / DAY_MS);
    if (days > maxLagDays) out.push({ source, latest: period, days, maxLagDays });
  }
  return out;
}

/** The id of the area a metric's figure describes for one market: two markets with the same id show one observation. */
export function observationId(metro: Metro, geography: Geography): string {
  switch (geography) {
    case 'city':
      return `city:${metro.city}`;
    case 'metro':
      return `metro:${metro.area}`;
    case 'msa':
      return `msa:${metro.census.msa}`;
    case 'district':
      return `district:${metro.txdotDistrict}`;
    case 'fmrArea':
      return `fmr:${metro.hudFmr}`;
  }
}

/** For each metric, the earlier market whose observation this market repeats (in METROS order, the namesake city first). */
function sharedFor(metros: Metro[], metro: Metro): Record<string, City> {
  const out: Record<string, City> = {};
  for (const metric of METRICS) {
    const id = observationId(metro, metric.geography);
    const first = metros.find((m) => observationId(m, metric.geography) === id);
    if (first && first.city !== metro.city) out[metric.key] = first.city;
  }
  return out;
}


/**
 * Fill each figure today's pass could not read (or rejected) from the last
 * published copy, so a BLS quota or a Census outage leaves last month's
 * figure, with its own period and the time it was originally read, rather
 * than a blank. A kept figure is marked retained; once its source has gone
 * unread for longer than SOURCE_RULES allows it is dropped and marked expired,
 * so a dead source cannot show its last figure forever.
 *
 * Works with version 1 files too: a figure with no fetchedAt is taken as read
 * when that file was generated.
 */
export function fillFromPrevious(next: MarketSnapshot, previous: MarketSnapshot | null | undefined): MarketSnapshot {
  if (!previous?.markets) return next;
  const now = Date.parse(next.generatedAt);
  const maxAge = (key: string) => {
    const metric = METRIC_BY_KEY.get(key);
    return metric ? SOURCE_RULES[metric.source].maxAgeDays * DAY_MS : Infinity;
  };
  return {
    ...next,
    rates: next.rates ?? previous.rates,
    counties: next.counties ?? previous.counties,
    developments: next.developments ?? previous.developments,
    bids: next.bids ?? previous.bids,
    salaries: next.salaries ?? previous.salaries,
    zoning: next.zoning ?? previous.zoning,
    markets: next.markets.map((market) => {
      const old = previous.markets.find((m) => m.city === market.city);
      if (!old) return market;
      const values = { ...market.values };
      const periods = { ...market.periods };
      const fetchedAt = { ...market.fetchedAt };
      const status = { ...market.status };
      for (const key of Object.keys(values)) {
        if (values[key] != null) continue;
        if (old.values?.[key] == null) {
          // Still gone: an expired figure stays marked expired, with when it was last read.
          if (old.status?.[key] === 'expired') {
            status[key] = 'expired';
            fetchedAt[key] = old.fetchedAt?.[key] ?? null;
          }
          continue;
        }
        const readAt = old.fetchedAt?.[key] ?? previous.generatedAt ?? null;
        const age = readAt ? now - Date.parse(readAt) : NaN;
        if (Number.isFinite(age) && age > maxAge(key)) {
          // Too old to keep: blank, but say why, and when it was last read.
          status[key] = 'expired';
          fetchedAt[key] = readAt;
          continue;
        }
        values[key] = old.values[key]!;
        periods[key] = old.periods?.[key] ?? null;
        fetchedAt[key] = readAt;
        status[key] = 'retained';
      }
      return { ...market, values, periods, fetchedAt, status };
    })
  };
}

/** How many figures have a value, to tell a usable snapshot from an empty one. */
export function filledCount(snapshot: MarketSnapshot): number {
  return snapshot.markets.reduce((sum, market) => sum + Object.values(market.values).filter((v) => v != null).length, 0);
}
