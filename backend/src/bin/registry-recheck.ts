/**
 * Recheck the verified quiet employers in data/employer-registry.json, so an
 * opening that appears later is found without adding every quiet board to the
 * every-build firm list.
 *
 *   npm run registry:recheck -- --state ../registry-state.json [--limit 12] [--all]
 *
 * Schedule, bounded both ways:
 *   - an employer is due when its last recheck (or its verification, if never
 *     rechecked) is recheckDays (7) old; nothing is read more often than that;
 *   - at most --limit due employers are read per run (most overdue first), but
 *     one past maxDays (14) is always read, so no employer goes unchecked longer
 *     than maxDays as long as builds run.
 * The state file (Actions cache in site.yml) holds each employer's last check.
 * Read only: an employer with a Texas entry-level opening is printed as
 * PROMOTE for the owner to add through a firm batch; nothing is published.
 */
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { fetchBoard } from '../collector/run.js';
import { evenIfIncomplete } from '../collector/sources/incomplete.js';
import { forFirm, normalize } from '../collector/normalize.js';
import type { FirmRow } from '../db/store.js';

export interface RegistryEmployer {
  name: string;
  ats: string;
  slug?: string;
  host?: string | null;
  careersUrl?: string | null;
  sector?: string;
  verifiedAt: string;
  status: 'quiet' | 'unsupported' | 'polled';
  creOnly?: boolean;
  note?: string;
}
export interface Registry {
  recheckDays: number;
  maxDays: number;
  employers: RegistryEmployer[];
}
export interface CheckState {
  lastChecked: string;
  fetched: number;
  published: number;
  error?: string;
  examples?: string[];
}

const DAY = 86_400_000;
const READERS = new Set(['greenhouse', 'lever', 'workday', 'icims', 'workable', 'ashby', 'smartrecruiters']);

/** Which quiet employers to read this run, most overdue first. */
export function dueEmployers(registry: Registry, state: Record<string, CheckState>, now: Date, limit: number): RegistryEmployer[] {
  const age = (e: RegistryEmployer) => {
    // Measured from the last recheck, or from verification for one never rechecked.
    const last = state[e.name]?.lastChecked ?? e.verifiedAt;
    return (now.getTime() - Date.parse(last)) / DAY;
  };
  const due = registry.employers
    .filter((e) => e.status === 'quiet' && READERS.has(e.ats) && e.slug && age(e) >= registry.recheckDays)
    .sort((a, b) => age(b) - age(a));
  const overdue = due.filter((e) => age(e) >= registry.maxDays);
  return [...overdue, ...due.filter((e) => !overdue.includes(e)).slice(0, Math.max(0, limit - overdue.length))];
}

async function main(): Promise<void> {
  const arg = (name: string) => {
    const at = process.argv.indexOf(name);
    return at > 0 ? process.argv[at + 1] : undefined;
  };
  const here = dirname(fileURLToPath(import.meta.url));
  const registry = JSON.parse(await readFile(resolve(here, '../../data/employer-registry.json'), 'utf8')) as Registry;
  const statePath = arg('--state');
  let state: Record<string, CheckState> = {};
  if (statePath) state = JSON.parse(await readFile(statePath, 'utf8').catch(() => '{}')) as Record<string, CheckState>;
  const now = new Date();
  const limit = process.argv.includes('--all') ? Infinity : Number(arg('--limit') ?? 12);
  const due = process.argv.includes('--all') ? dueEmployers(registry, {}, now, Infinity) : dueEmployers(registry, state, now, limit);
  const quiet = registry.employers.filter((e) => e.status === 'quiet').length;
  console.log(`Registry: ${registry.employers.length} employers (${quiet} quiet, ${registry.employers.filter((e) => e.status === 'unsupported').length} unsupported); ${due.length} due (every ${registry.recheckDays} days, at most ${registry.maxDays}).`);

  for (const e of due) {
    const firm: FirmRow = { id: 0, name: e.name, ats: e.ats as FirmRow['ats'], atsSlug: e.slug!, atsHost: e.host ?? null, active: true, slugVerified: true, ...(e.creOnly ? { creOnly: true } : {}) };
    const result: CheckState = { lastChecked: now.toISOString(), fetched: 0, published: 0 };
    try {
      const jobs = forFirm(firm, await evenIfIncomplete(fetchBoard(firm)));
      result.fetched = jobs.length;
      const kept = jobs.map((job) => normalize(job)).filter((r) => r.ok);
      result.published = kept.length;
      result.examples = kept.slice(0, 3).map((r) => (r.ok ? `${r.posting.role} (${r.posting.city})` : ''));
    } catch (error) {
      result.error = error instanceof Error ? error.message.slice(0, 160) : String(error);
    }
    state[e.name] = result;
    const tag = result.error ? 'FAILED' : result.published ? 'PROMOTE' : 'quiet';
    console.log(`REGISTRY ${tag} ${e.name} | ${e.ats} ${e.slug} | fetched ${result.fetched} | Texas entry-level ${result.published}${result.examples?.length ? ` | ${result.examples.join('; ')}` : ''}${result.error ? ` | ${result.error}` : ''}`);
  }
  if (statePath) await writeFile(statePath, JSON.stringify(state, null, 1));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
