/**
 * Run one collector pass from the command line. This is what the scheduler
 * invokes (Vercel Cron, GitHub Actions, or pg_cron via net.http_post against
 * POST /v1/collect — see supabase/migrations/0004_cron.sql).
 *
 *   npm run collect             # real run against Supabase
 *   npm run collect -- --dry    # fetch and normalize, write nothing
 */
import { SupabaseStore } from '../db/supabase.js';
import { MemoryStore } from '../db/store.js';
import { runCollector } from '../collector/run.js';
import { ExpoNotifier } from '../notify/expo.js';

const dry = process.argv.includes('--dry');

async function main(): Promise<void> {
  const store = dry ? dryStore() : SupabaseStore.fromEnv();

  const report = await runCollector({
    store,
    notifier: dry ? undefined : new ExpoNotifier({ accessToken: process.env.EXPO_ACCESS_TOKEN })
  });

  console.log(JSON.stringify(report, null, 2));

  if (report.firms === 0) {
    console.error('No active firms — the collector has nothing to poll.');
    process.exitCode = 1;
    return;
  }
  if (report.kept === 0) {
    // Silence here is the failure mode that matters: the run "succeeded" and
    // the feed is empty. Make it a non-zero exit so the scheduler surfaces it.
    console.error('Run kept zero postings. Check the firm slugs and the filters.');
    process.exitCode = 1;
  }
}

/** --dry still reads the real firm list, but writes go nowhere. */
function dryStore(): MemoryStore {
  const live = SupabaseStore.fromEnv();
  const memory = new MemoryStore();
  memory.listFirms = () => live.listFirms();
  memory.listProfiles = () => live.listProfiles();
  memory.markFirmPolled = async () => {};
  return memory;
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.stack : error);
  process.exitCode = 1;
});
