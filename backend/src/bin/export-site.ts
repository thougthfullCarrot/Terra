/**
 * Build the website's data file from a live collector pass.
 *
 *   npm run export:site                       # writes ../site/postings.json
 *   npm run export:site -- --out <path>
 *   npm run export:site -- --history <path>   # how long each job has been up (site/history.ts)
 *   npm run export:site -- --retain <path>    # keep jobs of a board that failed this build (site/retain.ts)
 *   npm run export:site -- --coverage <path>  # per-board status and counts, as JSON
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
import { entryLevelEvident, experienceRequirement } from '../collector/experience.js';
import { loadFirmSeed } from '../collector/firmSeed.js';
import { runCollector, type RunReport } from '../collector/run.js';
import { adzunaAggregators } from '../collector/sources/adzuna.js';
import { usajobsAggregators } from '../collector/sources/usajobs.js';
import { buildSnapshot } from '../site/snapshot.js';
import { updateHistory, type JobHistory } from '../site/history.js';
import { retainUnverified, type RetainFile, type RetainResult } from '../site/retain.js';
import { publishAs, resolveIdentity } from '../site/identity.js';
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
  const fresh = [...store.postings.values()];
  const retainPath = flag('--retain');
  const previousRetain = retainPath ? await readFile(retainPath, 'utf8').then((text) => JSON.parse(text) as RetainFile, () => null) : null;
  let retained: RetainResult | undefined;
  if (retainPath) {
    retained = retainUnverified(previousRetain, report.boards, fresh, report.ranAt);
    const kept = Object.entries(retained.retainedByFirm).map(([firm, n]) => `${firm} ${n}`).join(', ');
    console.log(`Retained: ${retained.postings.length - fresh.length} jobs from boards not read in full${kept ? ` (${kept})` : ''}; ${retained.closed} closed since the last build; ${retained.expired} dropped as unverified for over a week${previousRetain ? '' : ' (new file)'}.`);
  }
  // Official-board postings are keyed by opening; the site publishes each
  // under the id saved jobs and the history already know, where that is
  // unambiguous (site/identity.ts).
  const identity = resolveIdentity(previousRetain?.identity ?? null, retained?.postings ?? fresh, report.ranAt);
  console.log(`Identity: ${identity.bound} old ids bound to an opening, ${identity.ambiguous} shared by several openings and retired, ${identity.retiredClosed} retired with a closed opening; ${Object.keys(identity.next.aliases).length} bound in all.`);
  if (retainPath && retained && report.firms > 0 && report.firmsFailed < report.firms) {
    // A pass where every board failed is not published, so it must not touch the kept jobs either.
    await writeFile(retainPath, `${JSON.stringify({ ...retained.next, identity: identity.next })}\n`);
  }
  const verification = retained
    ? new Map([...retained.verification].map(([id, checked]) => [identity.published.get(id) ?? id, checked]))
    : undefined;
  const postings = (retained?.postings ?? fresh).map((posting) => publishAs(posting, identity.published));
  const freshIds = new Set(fresh.map((posting) => identity.published.get(posting.id) ?? posting.id));
  const historyFlag = process.argv.indexOf('--history');
  const historyPath = historyFlag >= 0 ? process.argv[historyFlag + 1] : undefined;
  let seen;
  if (historyPath) {
    const previous = await readFile(historyPath, 'utf8').then((text) => JSON.parse(text) as JobHistory, () => null);
    // Only jobs seen this build count as seen; a retained job was not.
    const next = updateHistory(previous, postings.filter((posting) => freshIds.has(posting.id)));
    seen = next.seen;
    // A pass where every board failed is not published, so it must not age the history either.
    if (report.firms > 0 && report.firmsFailed < report.firms) await writeFile(historyPath, `${JSON.stringify(next.history)}\n`);
    console.log(`History: ${Object.keys(next.history.seats).length} seats${previous ? '' : ' (new file)'}.`);
  }
  const snapshot = buildSnapshot(postings, report, seen, verification);

  const coveragePath = flag('--coverage');
  if (coveragePath) {
    const coverage = {
      ranAt: report.ranAt.toISOString(),
      boards: report.boards.map(({ ids, ...board }) => ({ ...board, published: ids.length, retained: retained?.retainedByFirm[board.firm] ?? 0 })),
      aggregators: report.aggregators,
      closedSinceLastBuild: retained?.closed ?? null,
      distinctOpenings: report.distinctOpenings
    };
    await writeFile(resolve(coveragePath), `${JSON.stringify(coverage, null, 2)}\n`);
    console.log(`Coverage: ${report.boards.length} boards written to ${coveragePath}.`);
  }

  await mkdir(dirname(out), { recursive: true });
  await writeFile(out, `${JSON.stringify(snapshot)}\n`);

  // The held postings are listed in full in the review file, not in the log,
  // and the per-board ids in the coverage file.
  const { review, boards: _boards, ...summary } = report;
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

  if (process.argv.includes('--samples')) {
    console.log('\n--- Published ---');
    for (const p of postings) {
      const need = experienceRequirement(p.description);
      const stated = need.figures.map((figure) => `${figure.required ? 'req' : 'pref'} ${figure.text}`).join(', ') || 'no years stated';
      const basis = entryLevelEvident(p.role, p.description) ? 'entry signal' : 'board level';
      console.log(`PUB  ${p.kind.padEnd(11)} ${p.role} | ${p.firm} | ${p.city} | ${p.sector} | ${stated}${need.figures.length ? '' : ` (${basis})`}`);
    }
    console.log('\n--- Held for review ---');
    for (const { posting: p, source } of review) console.log(`REV  ${source.padEnd(10)} ${p.role} | ${p.firm} | ${p.city}`);
    for (const [reason, rows] of Object.entries(report.rejectedSamples)) {
      console.log(`\n--- Rejected: ${reason} (first ${rows!.length}) ---`);
      for (const r of rows!) console.log(`REJ  ${r.role} | ${r.firm} | ${r.location}`);
    }
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

function flag(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

/** The feed's counts by source and reason, as a Markdown table for the run summary. */
function metricsTable(report: RunReport, firmsListed: number): string {
  const reasons = ['not-texas', 'not-entry-level', 'over-experience', 'off-topic', 'missing-fields'] as const;
  const lines = [
    '### Job feed',
    '',
    `Employers monitored: ${report.firms} of ${firmsListed} listed · with openings: ${report.firmsWithOpenings} · failed: ${report.firmsFailed} · read in part: ${report.firmsIncomplete}`,
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
  for (const board of report.boards) {
    if (board.status !== 'ok') lines.push(`\nBoard ${board.status === 'failed' ? 'failed' : 'read in part'}: ${board.firm}: ${board.error ?? ''}`);
  }
  lines.push('', '| Board | ATS | Status | Listed / total | Fetched | Published | Review | Not TX | Not entry | Over exp. | Off-topic |', '|---|---|---|---|---|---|---|---|---|---|---|');
  for (const board of report.boards) {
    const r = board.rejected;
    lines.push(`| ${board.firm} | ${board.ats} | ${board.status} | ${board.listed ?? '?'} / ${board.total ?? '?'} | ${board.fetched} | ${board.kept} | ${board.review} | ${r['not-texas']} | ${r['not-entry-level']} | ${r['over-experience']} | ${r['off-topic']} |`);
  }
  return lines.join('\n');
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.stack : error);
  process.exitCode = 1;
});
