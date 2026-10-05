/**
 * Build the website's news file: commercial real estate headlines for each
 * city, from Google News search RSS and Yahoo Finance headline RSS (free,
 * no key).
 *
 *   npm run export:news                          # writes ../site/news.json
 *   npm run export:news -- --out <path> --previous <path>
 *
 * A city whose feed fails keeps its headlines from --previous (default: the
 * --out file, if one is there).
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildNewsFile, type NewsFile } from '../news/googleNews.js';

const here = dirname(fileURLToPath(import.meta.url));
const DEFAULT_OUT = resolve(here, '../../../site/news.json');

function flag(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function main(): Promise<void> {
  const out = resolve(flag('--out') ?? DEFAULT_OUT);
  const previous = await readFile(resolve(flag('--previous') ?? out), 'utf8')
    .then((text) => JSON.parse(text) as NewsFile)
    .catch(() => null);
  const file = await buildNewsFile(new Date(), previous);
  // Every headline in the log, so a run's summary shows what the filter kept.
  for (const city of file.cities) {
    console.log(`\n${city.city}:`);
    for (const h of city.headlines) console.log(`  ${h.publishedAt?.slice(0, 10) ?? '----------'}  ${h.title} (${h.source})${h.topics.length ? ` [${h.topics.join(', ')}]` : ''}`);
  }
  const total = file.cities.reduce((sum, c) => sum + c.headlines.length, 0);
  if (total === 0) {
    console.error('No headlines for any city and no earlier copy; not writing a blank news file.');
    process.exitCode = 1;
    return;
  }
  await mkdir(dirname(out), { recursive: true });
  await writeFile(out, `${JSON.stringify(file)}\n`);
  console.log(`Wrote ${total} headlines to ${out}`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.stack : error);
  process.exitCode = 1;
});
