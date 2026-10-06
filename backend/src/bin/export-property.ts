/**
 * Build the Property tab's files in site/property/:
 *
 *   tracts.json     people and jobs per census tract, for the drive-time rings
 *   leases.json     the lease radar: tenant build-outs and 10-K lease end dates
 *   distress.json   tax sale listings and Harris County's biggest delinquent accounts
 *   deal.json       the deal of the week
 *
 *   npm run export:property                      # every file
 *   npm run export:property -- --only deal,leases
 *   npm run export:property -- --fresh           # ignore the age limits
 *
 * site.yml restores the folder from the Actions cache, so each file is only
 * rebuilt when it is older than its limit below; a file whose sources fail
 * keeps its last copy. Optional settings: CENSUS_API_KEY (the tract
 * populations; the API refuses requests without one) and SEC_USER_AGENT
 * (the 10-K half of the lease radar; SEC asks for a contact email in it).
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDealFile, type DealFile } from '../property/dealOfWeek.js';
import { fetchHarrisDelinquent, fetchTaxSales, type DistressFile } from '../property/distress.js';
import { buildTractFile, type TractFile } from '../property/driveTime.js';
import { fetchLeaseFilings, fetchTenantMoves, type LeaseRadarFile } from '../property/leaseRadar.js';

const here = dirname(fileURLToPath(import.meta.url));
const DEFAULT_DIR = resolve(here, '../../../site/property');

const DAY = 86_400_000;
/** How old each file may get before it is rebuilt. */
const MAX_AGE: Record<string, number> = { tracts: 60 * DAY, leases: 6 * DAY, distress: 1 * DAY, deal: 1 * DAY };

function flag(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const dir = resolve(flag('--dir') ?? DEFAULT_DIR);
const only = flag('--only')?.split(',');
const fresh = process.argv.includes('--fresh');
const now = new Date();
const log = (name: string) => (line: string) => console.log(`${name}: ${line}`);

async function previous<T extends { generatedAt: string }>(name: string): Promise<T | null> {
  return readFile(resolve(dir, `${name}.json`), 'utf8')
    .then((text) => JSON.parse(text) as T)
    .catch(() => null);
}

/** Rebuild one file when it is due; keep the old one when the build fails or comes back empty. */
async function step<T extends { generatedAt: string }>(name: string, build: (old: T | null) => Promise<T>, empty: (file: T) => boolean): Promise<boolean> {
  if (only && !only.includes(name)) return true;
  const old = await previous<T>(name);
  if (old && !fresh && now.getTime() - Date.parse(old.generatedAt) < MAX_AGE[name]!) {
    console.log(`${name}: keeping the file from ${old.generatedAt.slice(0, 16)}.`);
    return true;
  }
  try {
    const file = await build(old);
    if (empty(file) && old) {
      console.log(`${name}: nothing came back; keeping the file from ${old.generatedAt.slice(0, 10)}.`);
      return false;
    }
    await writeFile(resolve(dir, `${name}.json`), `${JSON.stringify(file)}\n`);
    console.log(`${name}: wrote ${name}.json.`);
    return !empty(file);
  } catch (error) {
    console.error(`${name}: failed. ${error instanceof Error ? error.message : error}`);
    return false;
  }
}

async function main(): Promise<void> {
  await mkdir(dir, { recursive: true });
  const results = [
    await step<TractFile>(
      'tracts',
      () => buildTractFile({ apiKey: process.env.CENSUS_API_KEY || undefined, now, log: log('tracts') }),
      (f) => !f.tracts.length
    ),
    await step<LeaseRadarFile>(
      'leases',
      async (old) => {
        const moves = await fetchTenantMoves(undefined, { now, previous: old?.moves ?? [], log: log('leases') });
        const agent = process.env.SEC_USER_AGENT?.trim();
        const filings = agent ? await fetchLeaseFilings(agent, { now, log: log('leases') }) : (old?.filings ?? []);
        return {
          generatedAt: now.toISOString(),
          moves: moves.length ? moves : (old?.moves ?? []),
          filings,
          ...(agent ? {} : { filingsNote: 'SEC filings are off until the SEC_USER_AGENT setting names a contact email.' })
        };
      },
      (f) => !f.moves.length && !f.filings.length
    ),
    await step<DistressFile>(
      'distress',
      async (old) => {
        const { sales, counties } = await fetchTaxSales(undefined, { log: log('distress') });
        const delinquent = await fetchHarrisDelinquent({ log: log('distress') }).catch((error: unknown) => {
          console.log(`distress: Harris delinquent list failed. ${error instanceof Error ? error.message : error}`);
          return old?.delinquent ?? null;
        });
        return { generatedAt: now.toISOString(), sales: sales.length ? sales : (old?.sales ?? []), delinquent, counties: sales.length ? counties : (old?.counties ?? {}) };
      },
      (f) => !f.sales.length && !f.delinquent?.accounts.length
    ),
    await step<DealFile>(
      'deal',
      (old) => buildDealFile({ now, previous: old, overridePath: resolve(here, '../../data/deal-of-week.json'), log: log('deal') }),
      (f) => !f.deal
    )
  ];
  if (results.every((ok) => !ok)) process.exitCode = 1;
}

await main();
