/**
 * Employer leads from TERRA's own development filings: the private owners and
 * general contractors that file the most Texas projects, with a sample project
 * so a person can resolve a project LLC to the operating company behind it.
 *
 *   npm run employer:leads -- <site/developments dir> [--top 40]
 *
 * Reads the per-market development lists the Website build writes. Public
 * owners (schools, cities, universities) are left out. A lead is a name to
 * check, not a firm: it goes into a discovery list only once an operating
 * company and its official careers page are confirmed.
 */
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { DEVELOPERS } from '../market/developers.js';

interface Row {
  owner?: string | null;
  contractor?: string | null;
  isPublic?: boolean;
  name?: string;
  city?: string;
  place?: string | null;
  cost?: number;
}

const LLC = /\b(llc|l\.l\.c\.|lp|l\.p\.|ltd|inc|owner|propco|holdings|venture|partners)\b\.?/gi;

function key(name: string): string {
  return name.toLowerCase().replace(LLC, ' ').replace(/[^a-z0-9& ]+/g, ' ').replace(/\s+/g, ' ').trim();
}

function* rows(value: unknown): Generator<Row> {
  if (Array.isArray(value)) {
    for (const item of value) yield* rows(item);
  } else if (value && typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    if ('owner' in obj || 'contractor' in obj) yield obj as Row;
    else for (const child of Object.values(obj)) yield* rows(child);
  }
}

async function main(): Promise<void> {
  const dir = process.argv[2];
  if (!dir) throw new Error('usage: employer:leads <developments dir>');
  const topIndex = process.argv.indexOf('--top');
  const top = topIndex > 0 ? Number(process.argv[topIndex + 1]) : 40;

  const owners = new Map<string, { name: string; n: number; cost: number; sample: string; known?: string }>();
  const contractors = new Map<string, { name: string; n: number; cost: number; sample: string }>();
  let projects = 0;
  for (const file of (await readdir(dir)).filter((f) => f.endsWith('.json'))) {
    const data = JSON.parse(await readFile(join(dir, file), 'utf8')) as unknown;
    for (const row of rows(data)) {
      projects++;
      if (row.isPublic) continue;
      const where = `${row.name ?? '?'} (${row.place ?? row.city ?? file.replace('.json', '')})`;
      if (row.owner) {
        const k = key(row.owner);
        if (k.length > 2) {
          const entry = owners.get(k) ?? { name: row.owner, n: 0, cost: 0, sample: where, known: DEVELOPERS.find((d) => d.match.test(row.owner!))?.name };
          entry.n++;
          entry.cost += row.cost ?? 0;
          owners.set(k, entry);
        }
      }
      if (row.contractor) {
        const k = key(row.contractor);
        if (k.length > 2) {
          const entry = contractors.get(k) ?? { name: row.contractor, n: 0, cost: 0, sample: where };
          entry.n++;
          entry.cost += row.cost ?? 0;
          contractors.set(k, entry);
        }
      }
    }
  }
  const money = (n: number) => `$${(n / 1e6).toFixed(0)}M`;
  console.log(`Employer leads from ${projects} development filings (private owners ${owners.size}, contractors ${contractors.size}).`);
  console.log('\nLEADS owners (by filings):');
  for (const o of [...owners.values()].sort((a, b) => b.n - a.n).slice(0, top)) {
    console.log(`LEAD owner ${o.n} | ${money(o.cost)} | ${o.name}${o.known ? ` [= ${o.known}]` : ''} | e.g. ${o.sample}`);
  }
  console.log('\nLEADS contractors (by filings):');
  for (const c of [...contractors.values()].sort((a, b) => b.n - a.n).slice(0, top)) {
    console.log(`LEAD gc ${c.n} | ${money(c.cost)} | ${c.name} | e.g. ${c.sample}`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
