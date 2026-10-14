// Fort Worth and Arlington city permits, grouped the old way (by street
// address) and the new way (Fort Worth by permit number), from the cities'
// live permit layers. Read-only: prints counts, values and every permit the
// old grouping showed more than once, with the source rows behind it.
//
//   npx tsx test/browser/permit-dedupe-report.ts
import { CITY_MAX, fetchArlington, fetchFortWorth, permitProjects, type CityPermit } from '../../src/market/cityPermits.js';
import type { Development } from '../../src/market/developments.js';

const now = new Date();
const money = (n: number) => `$${(n / 1e6).toLocaleString('en-US', { maximumFractionDigits: 1 })}M`;
const total = (ps: Development[]) => ps.reduce((sum, p) => sum + p.cost, 0);
let failed = 0;
const check = (name: string, ok: boolean, detail = '') => {
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
};

/** The grouping before this change: by street address, placeholder rows dropped, first row leads ties. */
const old = (rows: CityPermit[]) =>
  rows.map(({ site, placeholder, status, sourceId, parcel, ...p }) => ({ ...p, group: placeholder ? '' : (site ?? p.group) }));

const repeated = (ps: Development[]) => {
  const by = new Map<string, Development[]>();
  for (const p of ps) by.set(p.id, [...(by.get(p.id) ?? []), p]);
  return [...by].filter(([, g]) => g.length > 1);
};

for (const [name, fetch] of [
  ['Fort Worth', fetchFortWorth],
  ['Arlington', fetchArlington]
] as const) {
  const rows = await fetch(now, {});
  const permits = new Map<string, CityPermit[]>();
  for (const r of rows) permits.set(r.permit, [...(permits.get(r.permit) ?? []), r]);
  const multi = [...permits.values()].filter((g) => g.length > 1);
  console.log(`\n=== ${name}: ${rows.length} source rows, ${permits.size} permit numbers, ${multi.length} listed on more than one row`);

  const before = permitProjects(old(rows), now, 10_000);
  const after = permitProjects(rows, now, 10_000);
  const beforeMap = before.slice(0, CITY_MAX);
  const afterMap = after.slice(0, CITY_MAX);
  console.log(`All qualifying: before ${before.length} projects, ${money(total(before))}; after ${after.length} projects, ${money(total(after))}`);
  console.log(`On the map (top ${CITY_MAX}, before the TABS overlap check): before ${money(total(beforeMap))}, after ${money(total(afterMap))}`);

  const dups = repeated(before);
  console.log(`Ids the old grouping repeated: ${dups.length} ids on ${dups.reduce((n, [, g]) => n + g.length, 0)} projects (${dups.filter(([id]) => beforeMap.some((p) => p.id === id)).length} of them on the map)`);
  let extra = 0;
  for (const [id, copies] of dups) {
    const permit = id.replace(/^CITY-\w+?-/, '');
    const src = permits.get(permit) ?? [];
    const values = [...new Set(src.map((r) => r.value))];
    const scopes = [...new Set(src.map((r) => r.scope ?? ''))];
    const names = [...new Set(src.map((r) => r.name ?? ''))];
    const parcels = [...new Set(src.map((r) => r.parcel ?? ''))];
    const kind = values.length === 1 ? (scopes.length === 1 ? 'DUPLICATE: one permit, one value, one description' : 'DUPLICATE: one permit, one value; descriptions vary') : 'AMBIGUOUS: values differ within the permit';
    extra += copies[0]!.cost * (copies.length - 1);
    console.log(`  ${id}  ${copies.length} copies x ${money(copies[0]!.cost)}  ${kind}`);
    console.log(`    source rows ${src.length}; values ${values.map(money).join(', ')}; names ${JSON.stringify(names)}; parcels ${JSON.stringify(parcels)}`);
    console.log(`    descriptions ${JSON.stringify(scopes.map((s) => s.slice(0, 90)))}`);
    console.log(`    map copies: ${copies.map((c) => c.address ?? 'no address').join(' | ')}`);
    console.log(`    after: ${after.filter((p) => p.id === id).length} project, status "${after.find((p) => p.id === id)?.status}", addresses ${JSON.stringify(after.find((p) => p.id === id)?.addresses)}`);
  }
  console.log(`Value the repeats added before: ${money(extra)}`);

  // Safety: nothing combined, nothing lost.
  const afterIds = new Set(after.map((p) => p.id));
  check(`${name}: no id repeats after`, repeated(after).length === 0, `${repeated(after).length}`);
  const lost = [...new Set(before.map((p) => p.id))].filter((id) => !afterIds.has(id));
  check(`${name}: every project shown before is still shown (by permit)`, lost.length === 0, lost.slice(0, 10).join(', '));
  if (name === 'Fort Worth') {
    // Each project is exactly one permit number.
    const mixed = after.filter((p) => {
      const permit = p.id.replace(/^CITY-\w+?-/, '');
      return (p.sourceIds ?? []).some((sid) => !(permits.get(permit) ?? []).some((r) => r.sourceId === sid));
    });
    check(`${name}: every project's source rows belong to its one permit number`, mixed.length === 0, mixed.map((p) => p.id).join(', '));
    const unref = after.filter((p) => !p.sourceIds?.length);
    check(`${name}: every project keeps its city row ids`, unref.length === 0, `${unref.length} without`);
    const newIds = after.filter((p) => !before.some((b) => b.id === p.id));
    console.log(`Ids after that did not exist before (an area alert would call these new once): ${newIds.length}${newIds.length ? ` e.g. ${newIds.slice(0, 5).map((p) => p.id).join(', ')}` : ''}`);
    const statuses = new Map<string, number>();
    for (const p of after) statuses.set(p.status, (statuses.get(p.status) ?? 0) + 1);
    console.log(`Statuses after: ${JSON.stringify([...statuses])}`);
    const unpinned = after.filter((p) => p.lat == null);
    console.log(`Without a map point after: ${unpinned.length} of ${after.length}`);
  }
}
console.log(failed ? `\n${failed} check(s) failed` : '\nAll checks passed');
process.exit(failed ? 1 : 0);
