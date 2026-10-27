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
import { readMarketFiles } from '../market/devFiles.js';
import { CITY_CENTERS, METRO_RADIUS_KM, distanceKm, REVALIDATE_PER_BUILD, fetchZipAreas, needsRevalidation, revalidatePoints, type Development, type Revalidation } from '../market/developments.js';
import { inferMethod } from '../market/devLocation.js';
import { auditLocations, marketReport, pickSample, verifySample, type AuditRow, type Verified } from '../market/locationAudit.js';
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
// Keyed by market and id: Galveston County filings are listed on both the Houston and Galveston maps under one id.
const keyOf = (p: Development) => `${p.city}|${p.id}`;
const merged = new Map(snapshot.map((p) => [keyOf(p), p]));
for (const p of await readMarketFiles(dir)) merged.set(keyOf(p), p);
const projects = [...merged.values()].filter((p) => !only || only.includes(p.city));
if (!projects.length) {
  console.error(`no projects found in ${dir} or ${marketJson}`);
  process.exit(1);
}
const zips = await fetchZipAreas(new Date());
console.log(`${projects.length} projects; ${zips.size} Texas ZIP areas`);
const rows = auditLocations(projects, zips);
const byKey = new Map(projects.map((p) => [keyOf(p), p]));

// --revalidate: the updated build's own revalidation (revalidatePoints) on a
// copy of every cached geocoded point, with no per-build cap, then the build's
// ZIP-area step for what it removed. These are the actual results the build gives.
const after = new Map<string, Development>();
const outcomes = new Map<string, Revalidation>();
// Run as consecutive builds: REVALIDATE_PER_BUILD points a build, the lists
// saved and read back between builds (as after a restart), until nothing is
// due. Records each build's batch and any record checked more than once.
const batches: string[] = [];
if (process.argv.includes('--revalidate')) {
  let saved = JSON.stringify(projects);
  const seen = new Map<string, number>();
  for (let build = 1; build <= 80; build++) {
    const copies = JSON.parse(saved) as Development[];
    const done = await revalidatePoints(copies, new Date(), { budget: REVALIDATE_PER_BUILD, timeMs: Number.POSITIVE_INFINITY, pauseMs: 250, log: (l) => console.log(`build ${build}: ${l}`) });
    saved = JSON.stringify(copies);
    if (!done.size) break;
    const t = new Map<Revalidation, number>();
    for (const [k, v] of done) {
      t.set(v, (t.get(v) ?? 0) + 1);
      seen.set(k, (seen.get(k) ?? 0) + 1);
      // The last outcome wins; an error that later succeeds is replaced.
      outcomes.set(k, v);
    }
    batches.push(`| ${build} | ${done.size} | ${[...t].map(([k, n]) => `${n} ${k}`).join(', ')} |`);
  }
  for (const c of JSON.parse(saved) as Development[]) after.set(keyOf(c), c);
  const again = [...seen].filter(([, n]) => n > 1);
  batches.unshift('', '## Consecutive builds', '', `${batches.length} builds of up to ${REVALIDATE_PER_BUILD}, the lists saved and read back between builds. Records checked more than once: ${again.length}${again.length ? ` (${again.map(([k, n]) => `${k} ×${n}`).join(', ')}; each retried after a failed request)` : ''}. Still due afterwards: ${(JSON.parse(saved) as Development[]).filter(needsRevalidation).length}.`, '', '| Build | Checked | Outcomes |', '|---|---|---|');
}
const afterOf = (r: AuditRow) => {
  const a = after.get(`${r.city}|${r.id}`);
  return a ? { at: a.lat != null && a.lng != null ? ([a.lat, a.lng] as [number, number]) : null, method: inferMethod(a) } : undefined;
};

const markets = [...new Set(rows.map((r) => r.city))].sort() as City[];
await mkdir(out, { recursive: true });
const sections: string[] = [];
const totals: string[] = [
  '| Market | Listed | Permit point | Same-site permit | Geocoded | ZIP area | None | Conflicting | Suspicious | Revalidated: kept | moved | restored | removed (conflict) | removed (no match) | error | Sample: confirmed (official) | Sample: suspected | Sample: agrees, official | Sample: agrees, Census only |',
  '|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|'
];
const allVerified: Verified[] = [];
const revalLines: string[] = [];
const sum = new Array<number>(18).fill(0);
for (const city of markets) {
  const here = rows.filter((r) => r.city === city);
  const verified = verifyN > 0 ? await verifySample(pickSample(here, verifyN, flaggedN), byKey, zips, { log: console.log, afterOf: after.size ? afterOf : undefined }) : [];
  allVerified.push(...verified);
  const report = marketReport(city, here, verified);
  sections.push(report);
  await writeFile(join(out, `${city.toLowerCase().replace(/\W+/g, '-')}.md`), `${report}\n`);
  const n = (f: (r: (typeof here)[number]) => boolean) => here.filter(f).length;
  const v = (f: (x: Verified) => boolean) => verified.filter(f).length;
  const o = (k: Revalidation) => [...outcomes].filter(([key, x]) => key.startsWith(`${city}|`) && x === k).length;
  const cells = [
    here.length,
    n((r) => r.method === 'permit-point'),
    n((r) => r.method === 'same-site-permit'),
    n((r) => r.method === 'geocoded-address'),
    n((r) => r.method === 'zip-area'),
    n((r) => r.method === 'none'),
    n((r) => r.findings.includes('conflicting')),
    n((r) => r.findings.includes('suspicious')),
    o('kept'),
    o('moved'),
    o('restored'),
    o('removed: address conflict'),
    o('removed: no longer matches'),
    o('error'),
    v((x) => x.verdict === 'confirmed error'),
    v((x) => x.verdict === 'suspected error'),
    v((x) => x.verdict === 'agrees' && x.evidence === 'official record'),
    v((x) => x.verdict === 'agrees' && x.evidence !== 'official record')
  ];
  cells.forEach((c, i) => (sum[i]! += c));
  totals.push(`| ${city} | ${cells.join(' | ')} |`);
  // Every point the revalidation moved or removed in this market, before and after.
  for (const p of projects.filter((p) => p.city === city)) {
    const k = keyOf(p);
    const r = outcomes.get(k);
    if (!r || r === 'kept' || r === 'error') continue;
    const a = after.get(k)!;
    const f = (lat: number | null | undefined, lng: number | null | undefined) => (lat != null && lng != null ? `${lat.toFixed(5)}, ${lng.toFixed(5)}` : 'none');
    revalLines.push(`| ${city} | [${p.id}](${p.url}) ${p.name.replace(/\|/g, '/')} | ${p.address ?? ''} | ${r} | ${f(p.lat, p.lng)} | ${f(a.lat, a.lng)} | ${(a.location?.source ?? '').replace(/\|/g, '/')} |`);
  }
}
totals.push(`| **All ${markets.length} markets** | ${sum.map((x) => `**${x}**`).join(' | ')} |`);
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
const reval = outcomes.size
  ? ['', '## Cached points revalidated by the updated build', '', `${outcomes.size} cached geocoded points checked again under today's rules. Moved or removed:`, '', '| Market | Project | Filed address | Outcome | Before (live) | After (updated build) | Source |', '|---|---|---|---|---|---|---|', ...revalLines]
  : [];
const summary = [`# Development Map location audit`, '', `Run ${new Date().toISOString()}; ${projects.length} market listings (${new Set(projects.map((p) => p.id)).size} distinct filings; Galveston County filings appear on both the Houston and Galveston maps).`, '', ...totals, ...batches, ...reval, ...rematch].join('\n');
await writeFile(join(out, 'summary.md'), `${summary}\n`);
await writeFile(join(out, 'rows.json'), JSON.stringify({ rows, verified: allVerified }, null, 1));
console.log(`=====FILE summary.md=====\n${summary}\n`);
for (const s of sections) console.log(`=====SECTION=====\n${s}\n`);
