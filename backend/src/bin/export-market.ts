/**
 * Build the website's market data file from BLS and the Census.
 *
 *   npm run export:market                     # writes ../site/market.json
 *   npm run export:market -- --out <path> --previous <path>
 *
 * Needs no key. BLS_API_KEY and CENSUS_API_KEY (both free) raise the APIs'
 * daily limits if they are set. A source that fails leaves its figures from
 * --previous (default: the --out file, if one is there) in place, so one bad
 * day does not blank the page.
 *
 * In GitHub Actions it writes complete=true|false to the step outputs: true
 * when both sources answered, which is when site.yml caches the file for the
 * day.
 */
import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fetchBls } from '../market/bls.js';
import { fetchAcs } from '../market/census.js';
import { METROS } from '../market/metros.js';
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
  if (bls) console.log(`BLS: ${bls.size} of ${blsSeriesFor(METROS).length} series answered.`);

  const acs = await fetchAcs(METROS, { apiKey: process.env.CENSUS_API_KEY || undefined, now, timeoutMs: 30_000 }).catch(
    (error: unknown) => {
      console.error(`Census: ${error instanceof Error ? error.message : String(error)}`);
      return null;
    }
  );
  if (acs) console.log(`Census: ACS ${acs.year} 1-year, ${acs.current.size} areas (${acs.previous.size} for the year before).`);

  const snapshot = fillFromPrevious(buildMarketSnapshot(METROS, bls, acs, now), previous);

  for (const market of snapshot.markets) {
    const missing = Object.entries(market.values)
      .filter(([, value]) => value == null)
      .map(([key]) => key);
    console.log(`${market.city}: ${missing.length ? `missing ${missing.join(', ')}` : 'all figures'}`);
  }

  const complete = Boolean(bls?.size && acs?.current.size);
  if (process.env.GITHUB_OUTPUT) await appendFile(process.env.GITHUB_OUTPUT, `complete=${complete}\n`);

  if (filledCount(snapshot) === 0) {
    console.error('Neither source answered and there is no earlier copy; not writing a blank market file.');
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
