/**
 * Build the website's data file from a live collector pass.
 *
 *   npm run export:site                       # writes ../site/postings.json
 *   npm run export:site -- --out <path>
 *
 * Needs no database: the firm list is read from the seed migration, as
 * verify-firms does, and the pass runs against an in-memory store. What lands
 * in the file is what the boards list right now, which is exactly what a public
 * job feed should show.
 *
 * With ADZUNA_APP_ID and ADZUNA_APP_KEY set, Adzuna search results are added
 * too, minus any seat a firm board already listed. Without them it is boards
 * only, as before.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MemoryStore } from '../db/store.js';
import { loadFirmSeed } from '../collector/firmSeed.js';
import { runCollector } from '../collector/run.js';
import { adzunaAggregators } from '../collector/sources/adzuna.js';
import { buildSnapshot } from '../site/snapshot.js';

const here = dirname(fileURLToPath(import.meta.url));
const SEED_PATH = resolve(here, '../../supabase/migrations/0002_seed_firms.sql');
const DEFAULT_OUT = resolve(here, '../../../site/postings.json');

async function main(): Promise<void> {
  const outFlag = process.argv.indexOf('--out');
  const out = outFlag >= 0 && process.argv[outFlag + 1] ? resolve(process.argv[outFlag + 1]!) : DEFAULT_OUT;

  const store = new MemoryStore(await loadFirmSeed(SEED_PATH));
  const aggregators = adzunaAggregators();
  if (!aggregators.length) console.warn('ADZUNA_APP_ID / ADZUNA_APP_KEY not set; boards only.');
  const report = await runCollector({ store, aggregators });
  const snapshot = buildSnapshot([...store.postings.values()], report);

  await mkdir(dirname(out), { recursive: true });
  await writeFile(out, `${JSON.stringify(snapshot)}\n`);

  console.log(JSON.stringify({ ...report, out }, null, 2));

  // Every board failing is an outage, not an empty market, and publishing it
  // would replace a working site with a blank one. Zero postings from boards
  // that answered is a real answer, and the site says so on its own.
  if (report.firms === 0 || report.firmsFailed === report.firms) {
    console.error('No board answered; not publishing this snapshot.');
    process.exitCode = 1;
  } else if (report.kept === 0) {
    console.warn('Boards answered but none listed a Texas entry-level role.');
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.stack : error);
  process.exitCode = 1;
});
