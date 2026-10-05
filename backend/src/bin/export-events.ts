/**
 * Build the website's events file: real estate networking and industry
 * events per city, from chapter calendars (see src/events/events.ts).
 *
 *   npm run export:events                          # writes ../site/events.json
 *   npm run export:events -- --out <path> --previous <path>
 *
 * A source that fails keeps its events from --previous (default: the --out file).
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildEventsFile, type EventsFile } from '../events/events.js';

const here = dirname(fileURLToPath(import.meta.url));
const DEFAULT_OUT = resolve(here, '../../../site/events.json');

function flag(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function main(): Promise<void> {
  const out = resolve(flag('--out') ?? DEFAULT_OUT);
  const previous = await readFile(resolve(flag('--previous') ?? out), 'utf8')
    .then((text) => JSON.parse(text) as EventsFile)
    .catch(() => null);
  const file = await buildEventsFile(new Date(), previous);
  for (const city of file.cities) {
    if (!city.events.length) continue;
    console.log(`\n${city.city}:`);
    for (const e of city.events) console.log(`  ${e.start.slice(0, 16)}  ${e.title} (${e.organizer})${e.venue ? ` @ ${e.venue}` : ''}`);
  }
  const total = file.cities.reduce((sum, c) => sum + c.events.length, 0);
  if (total === 0 && !file.sources.length) {
    console.error('Every source failed and there is no earlier copy; not writing an events file.');
    process.exitCode = 1;
    return;
  }
  await mkdir(dirname(out), { recursive: true });
  await writeFile(out, `${JSON.stringify(file)}\n`);
  console.log(`Wrote ${total} events to ${out}`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.stack : error);
  process.exitCode = 1;
});
