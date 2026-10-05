/**
 * Build the website's market data file from BLS, the Census, Zillow Research,
 * Apartment List and the Census Building Permits Survey.
 *
 *   npm run export:market                     # writes ../site/market.json
 *   npm run export:market -- --out <path> --previous <path>
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
import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fetchApartmentList } from '../market/apartmentList.js';
import { fetchBls } from '../market/bls.js';
import { fetchAcs } from '../market/census.js';
import { METROS } from '../market/metros.js';
import { fetchPermits } from '../market/permits.js';
import { fetchZillow } from '../market/zillow.js';
import { blsSeriesFor, buildMarketSnapshot, filledCount, fillFromPrevious, type MarketSnapshot } from '../market/snapshot.js';

const here = dirname(fileURLToPath(import.meta.url));
const DEFAULT_OUT = resolve(here, '../../../site/market.json');

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

  const snapshot = fillFromPrevious(buildMarketSnapshot(METROS, bls, acs, now, { zillow, apartmentList, permits }), previous);

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
