/**
 * Development Map location audit: reads a build's development lists and
 * writes a report. Read-only: it never changes the data, Supabase or the site.
 *
 *   npm run audit:locations -- [--dir ../site/developments] [--market-json ../site/market.json]
 *     [--out dir] [--verify 12] [--flagged 8] [--markets "San Antonio,Austin"]
 *
 * --verify N checks N points per market (plus up to --flagged flagged ones)
 * against the Census geocoder and the city's own permit records, a few
 * hundred requests in all, paced well inside the geocoder's free use.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fetchCityPermitProjects } from '../market/cityPermits.js';
import { readMarketFiles, previousProjects } from '../market/devFiles.js';
import { CITY_CENTERS, METRO_RADIUS_KM, distanceKm, fetchZipAreas, type Development } from '../market/developments.js';
import { auditLocations, marketReport, pickSample, verifySample, type Verified } from '../market/locationAudit.js';
import type { City } from '../types.js';

const flag = (name: string) => {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
};

const dir = resolve(flag('--dir') ?? '../site/developments');
const marketJson = resolve(flag('--market-json') ?? '../site/market.json');
const out = resolve(flag('--out') ?? 'location-audit');
const verifyN = Number(flag('--verify') ?? 0);
const flaggedN = Number(flag('--flagged') ?? 8);
const only = flag('--markets')?.split(',').map((m) => m.trim()).filter(Boolean);

const snapshot = await readFile(marketJson, 'utf8')
  .then((t) => (JSON.parse(t) as { developments?: { projects?: Development[] } }).developments?.projects ?? [])
  .catch(() => [] as Development[]);
const projects = previousProjects(await readMarketFiles(dir), snapshot).filter((p) => !only || only.includes(p.city));
if (!projects.length) {
  console.error(`no projects found in ${dir} or ${marketJson}`);
  process.exit(1);
}
const zips = await fetchZipAreas(new Date());
console.log(`${projects.length} projects; ${zips.size} Texas ZIP areas`);
const rows = auditLocations(projects, zips);
const byId = new Map(projects.map((p) => [p.id, p]));
const markets = [...new Set(rows.map((r) => r.city))].sort() as City[];
await mkdir(out, { recursive: true });
const sections: string[] = [];
const totals: string[] = ['| Market | Listed | Permit point | Same-site permit | Geocoded | ZIP area | None | Missing | Conflicting | Suspicious | Sample: confirmed | Sample: suspected | Sample: agrees |', '|---|---|---|---|---|---|---|---|---|---|---|---|---|'];
const allVerified: Verified[] = [];
for (const city of markets) {
  const here = rows.filter((r) => r.city === city);
  const verified = verifyN > 0 ? await verifySample(pickSample(here, verifyN, flaggedN), byId, zips, { log: console.log }) : [];
  allVerified.push(...verified);
  const report = marketReport(city, here, verified);
  sections.push(report);
  await writeFile(join(out, `${city.toLowerCase().replace(/\W+/g, '-')}.md`), `${report}\n`);
  const n = (f: (r: (typeof here)[number]) => boolean) => here.filter(f).length;
  const v = (k: Verified['verdict']) => verified.filter((x) => x.verdict === k).length;
  totals.push(
    `| ${city} | ${here.length} | ${n((r) => r.method === 'permit-point')} | ${n((r) => r.method === 'same-site-permit')} | ${n((r) => r.method === 'geocoded-address')} | ${n((r) => r.method === 'zip-area')} | ${n((r) => r.method === 'none')} | ${n((r) => r.findings.includes('missing'))} | ${n((r) => r.findings.includes('conflicting'))} | ${n((r) => r.findings.includes('suspicious'))} | ${v('confirmed error')} | ${v('suspected error')} | ${v('agrees')} |`
  );
}
// --rematch: every point a city permit lent to a TABS filing, matched again
// under the same-site rules with today's city data, to show what the new
// rules keep, move and drop.
const rematch: string[] = [];
if (process.argv.includes('--rematch')) {
  const tabs = projects.filter((p) => (p.source ?? 'tabs') === 'tabs');
  const lent = tabs.filter((p) => p.locatedFrom && p.lat != null);
  const copies = tabs.map((p) => ({ ...p, ...(p.locatedFrom ? { lat: null, lng: null, locatedFrom: undefined, location: undefined } : {}), aliases: [...(p.aliases ?? [])] }) as Development);
  const cities = [...new Set(lent.map((p) => p.city))];
  await fetchCityPermitProjects(cities, new Date(), copies, { log: (l) => console.log(`rematch: ${l}`), minValue: 50_000, max: Number.POSITIVE_INFINITY, inMetro: (c, at) => distanceKm(at, CITY_CENTERS[c]) <= METRO_RADIUS_KM[c] });
  const after = new Map(copies.map((p) => [p.id, p]));
  const fmt = (lat: number | null | undefined, lng: number | null | undefined) => (lat != null && lng != null ? `${lat.toFixed(5)}, ${lng.toFixed(5)}` : 'none');
  let kept = 0;
  const changed: string[] = [];
  for (const p of lent) {
    const a = after.get(p.id)!;
    if (a.lat != null && a.lng != null && distanceKm([a.lat, a.lng], [p.lat!, p.lng!]) < 0.01) {
      kept++;
      continue;
    }
    changed.push(`| [${p.id}](${p.url}) ${p.name.replace(/\|/g, '/')} | ${p.place ?? ''} | ${p.address ?? ''} | ${fmt(p.lat, p.lng)} (${p.locatedFrom}) | ${fmt(a.lat, a.lng)}${a.locatedFrom ? ` (${a.location?.source ?? a.locatedFrom})` : ' (Location not verified: geocode or ZIP area next build)'} |`);
  }
  rematch.push('', '## Points lent by city permits, matched again under the same-site rules', '', `${lent.length} TABS filings carried a point lent by a city permit: ${kept} keep the same point, ${changed.length} change or lose it.`, '');
  if (changed.length) rematch.push('| Project | Town | Filed address | Before | After |', '|---|---|---|---|---|', ...changed);
}
const summary = [`# Development Map location audit`, '', `Run ${new Date().toISOString()}; ${projects.length} projects.`, '', ...totals, ...rematch].join('\n');
await writeFile(join(out, 'summary.md'), `${summary}\n`);
await writeFile(join(out, 'rows.json'), JSON.stringify({ rows, verified: allVerified }, null, 1));
console.log(`=====FILE summary.md=====\n${summary}\n`);
for (const s of sections) console.log(`=====SECTION=====\n${s}\n`);
