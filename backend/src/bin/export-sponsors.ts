/**
 * Write site/career/sponsors.json: the brokerages licensing the most new
 * sales agents in each market (src/career/sponsors.ts).
 *
 *   npm run export:sponsors
 *   npm run export:sponsors -- --max-age-days 7   # keeps a file younger than that
 *
 * Sponsorships move slowly, so site.yml restores the last file from the
 * Actions cache and rebuilds it once a week.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fetchSponsors, type SponsorsFile } from '../career/sponsors.js';

const here = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(here, '../../../site/career/sponsors.json');

const flag = (name: string) => {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
};

const previous = await readFile(OUT, 'utf8').then((text) => JSON.parse(text) as SponsorsFile, () => null);
const maxAge = Number(flag('--max-age-days') ?? 0);
if (previous && maxAge > 0 && Date.now() - Date.parse(previous.generatedAt) < maxAge * 86_400_000) {
  console.log(`Sponsors: keeping the file from ${previous.generatedAt.slice(0, 10)} (${previous.brokers.length} brokerages).`);
} else {
  const file = await fetchSponsors();
  if (!file.brokers.length) {
    console.error('Sponsors: the data set returned no brokerages; not writing the file.');
    process.exitCode = 1;
  } else {
    await mkdir(dirname(OUT), { recursive: true });
    await writeFile(OUT, `${JSON.stringify(file)}\n`);
    const byCity = new Map<string, number>();
    for (const b of file.brokers) byCity.set(b.city, (byCity.get(b.city) ?? 0) + 1);
    console.log(`Sponsors: ${file.brokers.length} brokerages (${[...byCity].map(([c, n]) => `${c} ${n}`).join(', ')}), data as of ${file.asOf}.`);
    console.log(`Top 5: ${file.brokers.slice(0, 5).map((b) => `${b.name} (${b.city}, ${b.newAgents})`).join('; ')}`);
  }
}
