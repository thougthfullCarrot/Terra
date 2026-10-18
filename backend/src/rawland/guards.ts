/**
 * The local prototype's gates. A real build runs only on complete reads, never publishes, draws only accounts in
 * the values read (a polygon can't bring back an account the values source omitted or redacted), and writes no
 * owner or address field.
 */
import { publishable, PUBLICATION } from '../appraisal/publish.js';
import type { IndexManifest } from '../appraisal/lookup.js';

export class BuildRefused extends Error {}

export interface Readiness { values: { complete: boolean; note: string }; reads: Record<string, { status: string; reason: string | null }> }
/** Throws unless the values read and every geometry/zoning/limits read are complete. */
export function assertBuildable(r: Readiness): void {
  const problems: string[] = [];
  if (!r.values.complete) problems.push(`values: ${r.values.note}`);
  for (const [k, v] of Object.entries(r.reads)) if (v.status !== 'complete') problems.push(`${k}: ${v.status}${v.reason ? ` (${v.reason})` : ''}`);
  if (problems.length) throw new BuildRefused(`build refused, incomplete reads: ${problems.join('; ')}`);
}

/** Throws if Bexar could be published under the current policy. The prototype exists only while it can't. */
export function assertNotPublishable(manifest: IndexManifest, policy: { enabled: boolean; proposed: readonly string[]; held: Record<string, string> } = PUBLICATION): void {
  const d = publishable(manifest, policy).find((x) => x.district === 'bexar');
  if (d?.publish) throw new BuildRefused('publication is enabled for bexar; the private prototype refuses to build');
}

/**
 * Values lead: one output per account in the values read. Outlines for accounts outside it are dropped and only
 * counted (city-only or redacted accounts are not restored). Values accounts without an outline stay listed with
 * outline unavailable.
 */
export function joinOutlines<V, G>(values: Map<string, V>, outlines: Map<string, G>): { joined: { account: string; value: V; outline: G | null }[]; droppedOutlines: number; noOutline: number } {
  const joined: { account: string; value: V; outline: G | null }[] = []; let noOutline = 0;
  for (const [account, value] of values) { const outline = outlines.get(account) ?? null; if (!outline) noOutline++; joined.push({ account, value, outline }); }
  let droppedOutlines = 0; for (const k of outlines.keys()) if (!values.has(k)) droppedOutlines++;
  return { joined, droppedOutlines, noOutline };
}

const FORBIDDEN = /^(owner|owners|owner_name|mailing|mail_addr|situs|situs_.*|addr.*|address.*|py_owner.*)$/i;
/** Keys that must never appear in Raw Land output, anywhere in the object tree. */
export function privacyScan(x: unknown, path = '$', hits: string[] = []): string[] {
  if (Array.isArray(x)) x.forEach((v, i) => privacyScan(v, `${path}[${i}]`, hits));
  else if (x && typeof x === 'object') for (const [k, v] of Object.entries(x)) { if (FORBIDDEN.test(k)) hits.push(`${path}.${k}`); privacyScan(v, `${path}.${k}`, hits); }
  return hits;
}

export interface Manifest { built: string; pinnedAppraisalCommit: string; sourceYear: number; counts: Record<string, number>; reads: Record<string, { readAt: string; rows: number }> }
/** Counts are baselines: report every change from the previous build, never fail on a fixed number. */
export function compareBaseline(prev: Manifest | null, cur: Manifest): { key: string; before: number | null; after: number; change: number | null }[] {
  return Object.entries(cur.counts).map(([key, after]) => { const before = prev?.counts[key] ?? null; return { key, before, after, change: before == null ? null : after - before }; }).filter((d) => d.change !== 0);
}
