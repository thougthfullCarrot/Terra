/**
 * Build the site finder's list (site/sites.json): land and buildings from
 * each city's public parcel map, with zoning.
 *
 *   npm run export:sites                       # writes ../site/sites.json
 *   npm run export:sites -- --max-age-days 7   # keeps a file younger than that
 *
 * Parcel values change once a year, so site.yml restores the last file from
 * the Actions cache and only rebuilds it once a week. A city whose map fails
 * keeps its sites from the previous file.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fetchSites, SITE_SOURCES, type SitesFile } from '../market/sites.js';

const here = dirname(fileURLToPath(import.meta.url));
const DEFAULT_OUT = resolve(here, '../../../site/sites.json');

function flag(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function main(): Promise<void> {
  const out = resolve(flag('--out') ?? DEFAULT_OUT);
  const previous = await readFile(out, 'utf8')
    .then((text) => JSON.parse(text) as SitesFile)
    .catch(() => null);
  const maxAge = Number(flag('--max-age-days') ?? 0);
  if (previous && maxAge > 0 && Date.now() - Date.parse(previous.generatedAt) < maxAge * 86_400_000) {
    console.log(`Sites: keeping the file from ${previous.generatedAt.slice(0, 10)} (${previous.sites.length} sites).`);
    return;
  }

  const sites = await fetchSites(SITE_SOURCES, { log: (line) => console.log(`Sites: ${line}`) });
  const fresh = new Set(sites.map((s) => s.city));
  const kept = (previous?.sites ?? []).filter((s) => !fresh.has(s.city));
  if (kept.length) console.log(`Sites: kept ${kept.length} from the last file for ${[...new Set(kept.map((s) => s.city))].join(', ')}.`);
  const all = [...sites, ...kept];
  if (!all.length) {
    console.error('Sites: no parcel map answered and there is no earlier file; not writing one.');
    process.exitCode = 1;
    return;
  }
  const file: SitesFile = {
    generatedAt: new Date().toISOString(),
    sources: SITE_SOURCES.map((s) => ({ city: s.city, name: s.name, page: s.page, zoning: Boolean(s.zoning), ...(s.zoningNote ? { note: s.zoningNote } : {}) })),
    sites: all
  };
  await mkdir(dirname(out), { recursive: true });
  await writeFile(out, `${JSON.stringify(file)}\n`);
  console.log(`Wrote ${out}: ${all.length} sites.`);
}

await main();
