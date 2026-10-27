// Revalidates the next share of cached development pins on builds that reuse
// the day's market data, so the queue moves every build instead of once a day
// without asking any other source again. Reads and rewrites only the
// per-market development files (site/developments/); with nothing due it makes
// no request.
//
//   npm run revalidate:pins [-- --dir ../site/developments]
import { appendFile, readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { needsRevalidation, revalidatePoints } from '../market/developments.js';
import { DEV_DIR, type MarketDevFile } from '../market/devFiles.js';

const here = dirname(fileURLToPath(import.meta.url));

function flag(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function main(): Promise<void> {
  const dir = resolve(flag('--dir') ?? resolve(here, '../../../site', DEV_DIR));
  const names = (await readdir(dir).catch(() => [] as string[])).filter((n) => n.endsWith('.json') && !n.startsWith('_'));
  const files: { name: string; file: MarketDevFile }[] = [];
  for (const name of names) {
    try {
      const file = JSON.parse(await readFile(join(dir, name), 'utf8')) as MarketDevFile;
      if (Array.isArray(file.projects)) files.push({ name, file });
    } catch {
      console.error(`${name}: unreadable, left as it is`);
    }
  }
  const projects = files.flatMap((f) => f.file.projects);
  const before = projects.filter(needsRevalidation).length;
  const done = before ? await revalidatePoints(projects, new Date(), { log: (line) => console.log(`TDLR TABS: ${line}`) }) : new Map();
  if (!before) console.log('TDLR TABS: no points due for revalidation');
  // Points are updated in place, so writing each file back saves the batch.
  if (done.size) for (const { name, file } of files) await writeFile(join(dir, name), `${JSON.stringify(file)}\n`);
  const due = projects.filter(needsRevalidation).length;
  if (process.env.GITHUB_OUTPUT) await appendFile(process.env.GITHUB_OUTPUT, `checked=${done.size}\nrevalidation_due=${due}\n`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
