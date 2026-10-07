/**
 * Summarize the Labor Department's H-1B wage filings (LCA disclosure data)
 * for the salary check: what commercial real estate employers offer, by job
 * title, in each Texas market.
 *
 *   npm run export:salaries                  # writes ../salaries.json
 *   npm run export:salaries -- --out <path>
 *
 * The newest workbook is about 250 MB, so salaries.yml runs this weekly on
 * its own and caches the summary (a few hundred KB) for site.yml, the way
 * appraisal.yml does for the county rolls. Exits non-zero when the files
 * could not be read, so the workflow keeps last week's summary.
 */
import { appendFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadFirmSeed } from '../collector/firmSeed.js';
import { namesMatch } from '../collector/nameMatch.js';
import { fetchSalaries } from '../market/salaries.js';

const here = dirname(fileURLToPath(import.meta.url));
const DEFAULT_OUT = resolve(here, '../../../salaries.json');

function flag(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function main(): Promise<void> {
  const out = resolve(flag('--out') ?? DEFAULT_OUT);
  const firms = (await loadFirmSeed().catch(() => [])).map((f) => f.name);
  console.log(`Matching employers against ${firms.length} firms the job feed follows.`);
  const file = await fetchSalaries({
    isFirm: (employer) => firms.some((firm) => namesMatch(firm, employer)),
    log: (line) => console.log(line)
  });
  for (const market of file.markets) console.log(`${market.city}: ${market.filings} filings from ${market.employers} employers`);
  await writeFile(out, `${JSON.stringify(file)}\n`);
  console.log(`Wrote ${out} (${file.period}).`);
  if (process.env.GITHUB_OUTPUT) await appendFile(process.env.GITHUB_OUTPUT, `filings=${file.markets.reduce((n, m) => n + m.filings, 0)}\n`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exit(1);
});
