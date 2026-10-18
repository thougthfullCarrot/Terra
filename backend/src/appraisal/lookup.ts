/**
 * The address index and the lookup over it.
 *
 * Records are grouped by district and by the first two characters of their
 * street name ("MA" holds Main, Market, Mason ...), one small file per group.
 * A lookup reads only the group its typed street falls in, in each district
 * it might be in, so a browser or a server never loads a whole county.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { matchAddress, parseAddress, streetKey, type MatchResult } from './address.js';
import type { AppraisalRecord } from './types.js';

/** The group a street name falls in: its first two letters or digits, '_' when it has none. */
export function shardOf(street: string): string {
  const k = street.replace(/[^A-Z0-9]/g, '').slice(0, 2);
  return k.length ? k : '_';
}

/** Index rows keep what a lookup shows; the full record stays in the cache. */
export type IndexRow = Omit<AppraisalRecord, 'dataset' | 'district'>;

export interface IndexManifest {
  built: string;
  districts: Record<string, { records: number; unmatched: number; shards: number; bytes: number; taxYear: number | null; dataset: string }>;
}

/** Write a district's index under <out>/<district>/<shard>.json. */
export async function writeIndex(out: string, district: string, records: Iterable<AppraisalRecord> | AsyncIterable<AppraisalRecord>): Promise<IndexManifest['districts'][string]> {
  const groups = new Map<string, IndexRow[]>();
  let count = 0;
  let unmatched = 0;
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
    let g = groups.get(shard);
    if (!g) groups.set(shard, (g = []));
    g.push(row);
  }
  const dir = join(out, district);
  await mkdir(dir, { recursive: true });
  let bytes = 0;
  for (const [shard, rows] of groups) {
    const body = JSON.stringify(rows);
    bytes += Buffer.byteLength(body);
    await writeFile(join(dir, `${shard}.json`), body);
  }
  return { records: count, unmatched, shards: groups.size, bytes, taxYear, dataset };
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
