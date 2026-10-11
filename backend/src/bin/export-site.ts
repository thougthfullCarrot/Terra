/**
 * Build the website's data file from a live collector pass.
 *
 *   npm run export:site                       # writes ../site/postings.json
 *   npm run export:site -- --out <path>
 *   npm run export:site -- --history <path>   # how long each job has been up (site/history.ts)
 *
 * Needs no database: the firm list is read from the seed migration, as
 * verify-firms does, and the pass runs against an in-memory store. What lands
 * in the file is what the boards list right now, which is exactly what a public
 * job feed should show.
 *
 * With ADZUNA_APP_ID and ADZUNA_APP_KEY set, Adzuna search results are added
 * too, minus any seat a firm board already listed. Without them it is boards
 * only, as before.
 *
 * With GOOGLE_SERVICE_ACCOUNT_JSON and TERRA_SHEET_ID set, the firm list comes
 * from the sheet's "Firms" tab instead, falling back to the seed list when the
 * sheet cannot be read (src/sheets/firms.ts). SHEETS_WRITE=true also fills an
 * empty tab from the seed and writes each firm's result to "Last check".
 */
import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MemoryStore } from '../db/store.js';
import { loadFirmSeed } from '../collector/firmSeed.js';
import { runCollector, type RunReport } from '../collector/run.js';
import { adzunaAggregators } from '../collector/sources/adzuna.js';
import { usajobsAggregators } from '../collector/sources/usajobs.js';
import { buildSnapshot } from '../site/snapshot.js';
import { updateHistory, type JobHistory } from '../site/history.js';
import { sheetsClientFromEnv } from '../sheets/env.js';
import { firmStatuses, loadFirms } from '../sheets/firms.js';

const here = dirname(fileURLToPath(import.meta.url));
const DEFAULT_OUT = resolve(here, '../../../site/postings.json');

async function main(): Promise<void> {
  const outFlag = process.argv.indexOf('--out');
  const out = outFlag >= 0 && process.argv[outFlag + 1] ? resolve(process.argv[outFlag + 1]!) : DEFAULT_OUT;

  const sheets = sheetsClientFromEnv();
  const write = process.env.SHEETS_WRITE === 'true';
  const firms = await loadFirms(sheets, await loadFirmSeed(), { write });
  console.log(`Firm list: ${firms.note}`);

  const store = new MemoryStore(firms.firms);
  const aggregators = [...adzunaAggregators(), ...usajobsAggregators()];
  if (!aggregators.some((a) => a.name === 'adzuna')) console.warn('ADZUNA_APP_ID / ADZUNA_APP_KEY not set; no Adzuna results.');
  if (!aggregators.some((a) => a.name === 'usajobs')) console.warn('USAJOBS_API_KEY / USAJOBS_EMAIL not set; no USAJOBS results.');
  const report = await runCollector({ store, aggregators });

  if (sheets && write && firms.sheet) {
    const jobsByFirm = new Map<string, number>();
    for (const posting of store.postings.values()) jobsByFirm.set(posting.firm, (jobsByFirm.get(posting.firm) ?? 0) + 1);
    const statuses = firmStatuses(firms.sheet, report, jobsByFirm);
    if (statuses) {
      await sheets.write(statuses.range, statuses.rows).then(
        () => console.log('Wrote each firm\'s result to the Last check column.'),
        (error: unknown) => console.warn(`Could not write firm results to the sheet: ${error instanceof Error ? error.message : String(error)}`)
      );
    }
  }
  const postings = [...store.postings.values()];
  const historyFlag = process.argv.indexOf('--history');
  const historyPath = historyFlag >= 0 ? process.argv[historyFlag + 1] : undefined;
  let seen;
  if (historyPath) {
    const previous = await readFile(historyPath, 'utf8').then((text) => JSON.parse(text) as JobHistory, () => null);
    const next = updateHistory(previous, postings);
    seen = next.seen;
    // A pass where every board failed is not published, so it must not age the history either.
    if (report.firms > 0 && report.firmsFailed < report.firms) await writeFile(historyPath, `${JSON.stringify(next.history)}\n`);
    console.log(`History: ${Object.keys(next.history.seats).length} seats${previous ? '' : ' (new file)'}.`);
  }
  const snapshot = buildSnapshot(postings, report, seen);

  await mkdir(dirname(out), { recursive: true });
  await writeFile(out, `${JSON.stringify(snapshot)}\n`);

  // The held postings are listed in full in the review file, not in the log.
  const { review, ...summary } = report;
  console.log(JSON.stringify({ ...summary, out }, null, 2));

  const reviewFlag = process.argv.indexOf('--review');
  const reviewPath = reviewFlag >= 0 ? process.argv[reviewFlag + 1] : undefined;
  if (reviewPath) {
    const rows = review.map(({ posting, reason, source }) => ({
      reason,
      source,
      role: posting.role,
      firm: posting.firm,
      city: posting.city,
      applyUrl: posting.applyUrl,
      desc: posting.description.slice(0, 400)
    }));
    await writeFile(resolve(reviewPath), `${JSON.stringify(rows, null, 2)}\n`);
    console.log(`Review: ${rows.length} postings held, written to ${reviewPath}.`);
  }

  const table = metricsTable(report, firms.firms.length);
  console.log(`\n${table}`);
  if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, `${table}\n`).catch(() => undefined);

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

/** The feed's counts by source and reason, as a Markdown table for the run summary. */
function metricsTable(report: RunReport, firmsListed: number): string {
  const reasons = ['not-texas', 'not-entry-level', 'over-experience', 'off-topic', 'missing-fields'] as const;
  const lines = [
    '### Job feed',
    '',
    `Employers monitored: ${report.firms} of ${firmsListed} listed · with openings: ${report.firmsWithOpenings} · failed: ${report.firmsFailed}`,
    `Published: ${report.kept} (${report.kinds.Internship} internships, ${report.kinds['Entry-level']} entry-level) · held for review: ${report.reviewed}`,
    '',
    `| Source | Fetched | Published | Review | ${reasons.join(' | ')} |`,
    `|---|---|---|---|${reasons.map(() => '---').join('|')}|`
  ];
  for (const [source, counts] of Object.entries(report.bySource).sort()) {
    lines.push(`| ${source} | ${counts.fetched} | ${counts.kept} | ${counts.review} | ${reasons.map((r) => counts.rejected[r]).join(' | ')} |`);
  }
  for (const aggregator of report.aggregators) {
    if (aggregator.error) lines.push(`\n${aggregator.name} failed: ${aggregator.error}`);
  }
  for (const error of report.errors) lines.push(`\nBoard failed: ${error.firm}: ${error.message}`);
  return lines.join('\n');
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.stack : error);
  process.exitCode = 1;
});
