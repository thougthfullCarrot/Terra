/**
 * The address index and the lookup over it.
 *
 * Records are grouped by district and by the first three characters of their
 * street name ("MAI" holds Main, Maize ...), one small file per group.
 * A lookup reads only the group its typed street falls in, in each district
 * it might be in, so a browser or a server never loads a whole county.
 */
import { appendFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { matchAddress, parseAddress, streetKey, type MatchResult } from './address.js';
import type { AppraisalRecord } from './types.js';

/** The group a street name falls in: its first three letters or digits, '_' when it has none. */
export function shardOf(street: string): string {
  const k = street.replace(/[^A-Z0-9]/g, '').slice(0, 3);
  return k.length ? k : '_';
}

/** Index rows keep what a lookup shows; the full record stays in the cache. */
export type IndexRow = Omit<AppraisalRecord, 'dataset' | 'district'>;

export interface IndexManifest {
  built: string;
  districts: Record<string, { records: number; unmatched: number; shards: number; bytes: number; taxYear: number | null; dataset: string }>;
}

/** Write a district's index under <out>/<district>/<shard>.json. */
export async function writeIndex(out: string, district: string, records: Iterable<AppraisalRecord> | AsyncIterable<AppraisalRecord>): Promise<IndexManifest['districts'][string] & { largest: number }> {
  const dir = join(out, district);
  await rm(dir, { recursive: true, force: true });
  await mkdir(dir, { recursive: true });
  // Rows are appended to one file per group as they stream past, then each group is turned into a JSON array,
  // so a county never has to fit in memory.
  const pending = new Map<string, string[]>();
  const shards = new Set<string>();
  const flush = async (shard: string) => {
    const lines = pending.get(shard);
    if (!lines?.length) return;
    await appendFile(join(dir, `${shard}.ndjson`), `${lines.join('\n')}\n`);
    pending.set(shard, []);
  };
  let count = 0;
  let unmatched = 0;
  let buffered = 0;
  let taxYear: number | null = null;
  let dataset = '';
  for await (const r of records as AsyncIterable<AppraisalRecord>) {
    count++;
    taxYear ??= r.taxYear;
    dataset ||= r.dataset;
    const parts = parseAddress(r.situs);
    if (!parts) {
      unmatched++;
      continue;
    }
    const shard = shardOf(streetKey(parts));
    const { dataset: _d, district: _x, ...row } = r;
    shards.add(shard);
    (pending.get(shard) ?? pending.set(shard, []).get(shard)!).push(JSON.stringify(row));
    if (++buffered >= 50_000) {
      for (const k of pending.keys()) await flush(k);
      buffered = 0;
    }
  }
  for (const k of pending.keys()) await flush(k);
  let bytes = 0;
  let largest = 0;
  for (const shard of shards) {
    const src = join(dir, `${shard}.ndjson`);
    const body = `[${(await readFile(src, 'utf8')).trim().split('\n').join(',')}]`;
    const size = Buffer.byteLength(body);
    bytes += size;
    largest = Math.max(largest, size);
    await writeFile(join(dir, `${shard}.json`), body);
    await rm(src);
  }
  return { records: count, unmatched, shards: shards.size, bytes, taxYear, dataset, largest };
}

export type Loader = (district: string, shard: string) => Promise<IndexRow[] | null>;

export interface LookupHit extends IndexRow {
  district: string;
}

/**
 * Look an address up in the given districts. Each district's group is read
 * once; a district that can't be read is reported, not silently skipped.
 */
export async function lookup(address: string, districts: string[], load: Loader): Promise<{ result: MatchResult<LookupHit>; unavailable: string[] }> {
  const parts = parseAddress(address);
  if (!parts) return { result: { status: 'none', reason: 'No house number and street name to match on.' }, unavailable: [] };
  const shard = shardOf(streetKey(parts));
  const unavailable: string[] = [];
  const rows: LookupHit[] = [];
  await Promise.all(
    districts.map(async (d) => {
      try {
        const got = await load(d, shard);
        if (!got) unavailable.push(d);
        else for (const r of got) rows.push({ ...r, district: d });
      } catch {
        unavailable.push(d);
      }
    })
  );
  const result = matchAddress(address, rows, (r) => [r.situs, r.situsCity, r.situsZip].filter(Boolean).join(', '), (r) => r.district);
  return { result, unavailable };
}
