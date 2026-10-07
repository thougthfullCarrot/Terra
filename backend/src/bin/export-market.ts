/**
 * Build the website's market data file from BLS, the Census, Zillow Research,
 * Apartment List, the Census Building Permits Survey, FRED interest rates,
 * Census population estimates, Texas Comptroller tax rates, HUD Opportunity
 * Zones, TxDOT highway projects and TDLR's register of current development
 * projects, plus Redfin, Realtor.com, FHFA and HUD (Fair Market Rents and
 * LIHTC). All free; the Census API needs a (free) key, and HUD Fair Market
 * Rents need HUD_API_TOKEN (free) or are skipped.
 *
 *   npm run export:market                     # writes ../site/market.json
 *   npm run export:market -- --out <path> --previous <path> --appraisal <path>
 *
 * BLS needs no key; BLS_API_KEY (free) raises its daily limit. The Census API
 * now refuses requests without CENSUS_API_KEY (free, instant at
 * https://api.census.gov/data/key_signup.html). A source that fails leaves its figures from
 * --previous (default: the --out file, if one is there) in place, so one bad
 * day does not blank the page.
 *
 * In GitHub Actions it writes complete=true|false to the step outputs: true
 * when every source answered, which is when site.yml caches the file for the
 * day.
 */
import type { LihtcCount } from '../market/lihtc.js';
import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fetchApartmentList } from '../market/apartmentList.js';
import type { AppraisalFile } from '../market/appraisal.js';
import { fetchBls } from '../market/bls.js';
import { fetchDevelopments } from '../market/developments.js';
import { fetchRates } from '../market/fred.js';
import { fetchOpportunityZones } from '../market/opportunityZones.js';
import { fetchPep } from '../market/pep.js';
import { fetchTaxRates } from '../market/taxRates.js';
import { fetchTxdot } from '../market/txdot.js';
import { fetchAcs } from '../market/census.js';
import { METROS } from '../market/metros.js';
import { fetchPermits } from '../market/permits.js';
import { fetchZillow } from '../market/zillow.js';
import { fetchRedfin } from '../market/redfin.js';
import { fetchRealtor } from '../market/realtor.js';
import { fetchFhfa } from '../market/fhfa.js';
import { fetchHudFmr } from '../market/hudFmr.js';
import { fetchResearch, keepResearch } from '../market/research.js';
import type { SalaryFile } from '../market/salaries.js';
import { fetchZoning, keepZoning } from '../market/zoning.js';
import { blsSeriesFor, buildMarketSnapshot, filledCount, fillFromPrevious, type MarketSnapshot } from '../market/snapshot.js';

const here = dirname(fileURLToPath(import.meta.url));
const DEFAULT_OUT = resolve(here, '../../../site/market.json');
/** Written by export-appraisal (appraisal.yml), outside site/ so it is never published on its own. */
const DEFAULT_APPRAISAL = resolve(here, '../../../appraisal.json');
/** Written by export-salaries (salaries.yml), likewise. */
const DEFAULT_SALARIES = resolve(here, '../../../salaries.json');

function flag(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function readPrevious(path: string): Promise<MarketSnapshot | null> {
  try {
    return JSON.parse(await readFile(path, 'utf8')) as MarketSnapshot;
  } catch {
    return null;
  }
}

async function main(): Promise<void> {
  const out = resolve(flag('--out') ?? DEFAULT_OUT);
  const previous = await readPrevious(resolve(flag('--previous') ?? out));
  const now = new Date();

  const bls = await fetchBls(blsSeriesFor(METROS), { apiKey: process.env.BLS_API_KEY || undefined, now, timeoutMs: 30_000 }).catch(
    (error: unknown) => {
      console.error(`BLS: ${error instanceof Error ? error.message : String(error)}`);
      return null;
    }
  );
  if (bls) {
    const missing = blsSeriesFor(METROS).filter((id) => !bls.has(id));
    console.log(`BLS: ${bls.size} of ${blsSeriesFor(METROS).length} series answered.${missing.length ? ` Not published: ${missing.join(', ')}` : ''}`);
  }

  const acs = await fetchAcs(METROS, { apiKey: process.env.CENSUS_API_KEY || undefined, now, timeoutMs: 30_000 }).catch(
    (error: unknown) => {
      console.error(`Census: ${error instanceof Error ? error.message : String(error)}`);
      return null;
    }
  );
  if (acs) console.log(`Census: ACS ${acs.year} 1-year, ${acs.current.size} areas (${acs.previous.size} for the year before).`);

  // Each property-market source on its own: one that is down keeps its last figures.
  const cities = METROS.map((metro) => metro.city);
  const attempt = <T>(name: string, run: () => Promise<T>): Promise<T | null> =>
    run().catch((error: unknown) => {
      console.error(`${name}: ${error instanceof Error ? error.message : String(error)}`);
      return null;
    });
  const [zillow, apartmentList, permits] = await Promise.all([
    attempt('Zillow', () => fetchZillow(cities)),
    attempt('Apartment List', () => fetchApartmentList(cities)),
    attempt('Census BPS', () => fetchPermits(cities, { now }))
  ]);
  if (zillow) console.log(`Zillow: home values for ${zillow.homeValue.size} cities, rents for ${zillow.rent.size}.`);
  if (apartmentList) console.log(`Apartment List: rents for ${apartmentList.rent.size} cities, vacancy for ${apartmentList.vacancy.size}.`);
  if (permits) console.log(`Census BPS: ${permits.period}, ${permits.current.size} cities (${permits.previous.size} for the year before).`);

  const [rateResult, population, taxes, zones, txdot] = await Promise.all([
    attempt('FRED', () => fetchRates()),
    attempt('Census population estimates', () => fetchPep(METROS, { now })),
    attempt('Texas Comptroller', () => fetchTaxRates(cities, { now })),
    attempt('Opportunity Zones', () => fetchOpportunityZones()),
    attempt('TxDOT', () => fetchTxdot())
  ]);
  if (rateResult) {
    console.log(`FRED: ${rateResult.rates.map((r) => `${r.key} ${r.value} (${r.period})`).join(', ')}`);
    if (rateResult.failed.length) console.error(`FRED: not read: ${rateResult.failed.join(', ')}`);
  }
  if (population) console.log(`Census population estimates: July ${population.year}, ${population.metros.size} areas, ${population.counties.length} Texas counties.`);
  if (taxes) {
    for (const [city, rate] of taxes.current) {
      console.log(`Tax rates ${taxes.year}: ${city} ${rate.total.toFixed(4)}${rate.missing.length ? ` (not in the file: ${rate.missing.join(', ')})` : ''}`);
    }
  }
  if (zones) console.log(`Opportunity Zones: ${[...zones.values()].reduce((a, b) => a + b, 0)} Texas tracts in ${zones.size} counties.`);
  if (txdot) {
    console.log(`TxDOT phases seen: ${txdot.phases.join('; ')}`);
    for (const metro of METROS) {
      const d = txdot.districts.get(metro.txdotDistrict);
      console.log(`TxDOT ${metro.txdotDistrict}: ${d ? `${d.plannedCount} planned ($${Math.round(d.planned / 1e6)}M), ${d.underwayCount} underway ($${Math.round(d.underway / 1e6)}M)` : 'no projects'}`);
    }
  }

  const hudToken = process.env.HUD_API_TOKEN?.trim();
  if (!hudToken) console.log('HUD Fair Market Rents: HUD_API_TOKEN not set; skipped.');
  const [redfin, realtor, fhfa, fmrResult, lihtc] = await Promise.all([
    attempt('Redfin', () => fetchRedfin(cities)),
    attempt('Realtor.com', () => fetchRealtor(METROS)),
    attempt('FHFA', () => fetchFhfa(METROS.map((m) => m.area))),
    hudToken ? attempt('HUD Fair Market Rents', () => fetchHudFmr(METROS, hudToken)) : Promise.resolve(null),
    // HUD's LIHTC download sits behind a bot check (HTTP 202, empty body) for
    // automated clients, so it stays off.
    Promise.resolve(null as Map<string, LihtcCount> | null)
  ]);
  if (redfin) console.log(`Redfin: ${[...redfin].map(([city, r]) => `${city} ${r.period} $${r.medianSalePrice ?? '?'}`).join(', ') || 'no cities'}`);
  if (realtor) console.log(`Realtor.com: ${[...realtor].map(([cbsa, r]) => `${cbsa} ${r.period} $${r.medianListingPrice ?? '?'}`).join(', ') || 'no metros'}`);
  if (fhfa) console.log(`FHFA: ${[...fhfa].map(([code, r]) => `${code} ${r.period} ${r.index}`).join(', ') || 'no metros'}`);
  if (fmrResult) {
    console.log(`HUD Fair Market Rents: ${[...fmrResult.readings].map(([city, r]) => `${city} ${r.period} 2BR $${r.rents[2] ?? '?'}`).join(', ') || 'no areas'}`);
    if (fmrResult.failed.length) console.error(`HUD Fair Market Rents: not read: ${fmrResult.failed.join(', ')}`);
  }

  // Last so a slow TDLR day cannot hold up the other sources; projects read on
  // an earlier build keep their page and map point.
  const developments = await attempt('TDLR TABS', () =>
    fetchDevelopments(cities, { now, previous: previous?.developments?.projects, log: (line) => console.log(`TDLR TABS: ${line}`) })
  );

  const research = await attempt('Broker research', () =>
    fetchResearch({ cities, log: (line) => console.log(`Broker research: ${line}`) })
  );

  const zoning = await attempt('Zoning agendas', () => fetchZoning({ now, log: (line) => console.log(`Zoning: ${line}`) }));

  const salaries = await readFile(resolve(flag('--salaries') ?? DEFAULT_SALARIES), 'utf8')
    .then((text) => JSON.parse(text) as SalaryFile)
    .catch(() => null);
  console.log(
    salaries
      ? `Salary filings: ${salaries.markets.map((m) => `${m.city} ${m.filings}`).join(', ')} (${salaries.period}, summarized ${salaries.generatedAt.slice(0, 10)}).`
      : 'Salary filings: no summary file yet (salaries.yml writes it).'
  );

  const appraisal = await readFile(resolve(flag('--appraisal') ?? DEFAULT_APPRAISAL), 'utf8')
    .then((text) => JSON.parse(text) as AppraisalFile)
    .catch(() => null);
  console.log(
    appraisal
      ? `Appraisal districts: ${appraisal.cities.map((c) => `${c.city} ${c.period}`).join(', ')} (summarized ${appraisal.generatedAt.slice(0, 10)}).`
      : 'Appraisal districts: no summary file yet (appraisal.yml writes it).'
  );

  const snapshot = fillFromPrevious(
    buildMarketSnapshot(METROS, bls, acs, now, {
      zillow,
      apartmentList,
      permits,
      appraisal,
      rates: rateResult?.rates ?? null,
      population,
      taxes,
      zones,
      txdot: txdot?.districts ?? null,
      redfin,
      realtor,
      fhfa,
      fmr: fmrResult?.readings ?? null,
      lihtc
    }),
    previous
  );
  if (developments?.projects.length) snapshot.developments = developments;
  const keptResearch = research ? keepResearch(research, previous?.research) : previous?.research;
  if (keptResearch) snapshot.research = keptResearch;
  if (salaries) snapshot.salaries = salaries;
  const keptZoning = zoning ? keepZoning(zoning, previous?.zoning) : previous?.zoning;
  if (keptZoning) snapshot.zoning = keptZoning;

  for (const market of snapshot.markets) {
    const missing = Object.entries(market.values)
      .filter(([, value]) => value == null)
      .map(([key]) => key);
    console.log(`${market.city}: ${missing.length ? `missing ${missing.join(', ')}` : 'all figures'}`);
  }

  const complete = Boolean(
    bls?.size && acs?.current.size && zillow?.homeValue.size && zillow.rent.size && apartmentList?.rent.size && permits?.current.size
  );
  if (process.env.GITHUB_OUTPUT) await appendFile(process.env.GITHUB_OUTPUT, `complete=${complete}\n`);

  if (filledCount(snapshot) === 0) {
    console.error('No source answered and there is no earlier copy; not writing a blank market file.');
    process.exitCode = 1;
    return;
  }
  await mkdir(dirname(out), { recursive: true });
  await writeFile(out, `${JSON.stringify(snapshot)}\n`);
  console.log(`Wrote ${out}`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.stack : error);
  process.exitCode = 1;
});
