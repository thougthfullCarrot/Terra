/**
 * Store today's compact market copy in market_history (migration 0017) and
 * drop days older than HISTORY_DAYS, for watchlist digests.
 *
 *   npm run store:history -- ../site/market.json
 *
 * Needs SUPABASE_URL and SERVICE_ROLE_KEY. The Website workflow runs it only
 * on the default branch with WATCHLISTS_ENABLED on. A missing table (migration
 * not applied yet) or any other problem prints a warning and exits 0: history
 * must never hold back the site.
 *
 * It also checks every followed TABS project on its own (followed.ts), so a
 * watch keeps working when the project is no longer on the map. Only project
 * numbers are read from watchlist_items, never who follows them.
 */
import { readFile } from 'node:fs/promises';
import { createClient } from '@supabase/supabase-js';
import { refreshFollowed, tabsFetchers, type FollowedProject } from '../alerts/followed.js';
import { HISTORY_DAYS, digestOf, pruneBefore, type HistoryDay } from '../alerts/history.js';
import type { MarketSnapshot } from '../market/snapshot.js';

const file = process.argv[2] ?? '../site/market.json';
const url = process.env.SUPABASE_URL?.replace(/\/+$/, '');
const serviceKey = process.env.SERVICE_ROLE_KEY;

function warn(message: string): never {
  console.log(`::warning::Market history not stored: ${message}`);
  process.exit(0);
}

if (!url || !serviceKey) warn('SUPABASE_URL and SERVICE_ROLE_KEY are not set.');
const snapshot = await readFile(file, 'utf8')
  .then((text) => JSON.parse(text) as MarketSnapshot)
  .catch((error: unknown) => warn(`couldn't read ${file} (${error instanceof Error ? error.message : error}).`));

const row = digestOf(snapshot);
const db = createClient(url!, serviceKey!, { auth: { persistSession: false, autoRefreshToken: false } });
// Followed projects: the newest stored record of each is the starting point.
let followedNote = 'followed projects not checked';
const last = await db.from('market_history').select('day, data').lte('day', row.day).order('day', { ascending: false }).limit(1);
if (last.error) console.log(`::warning::Couldn't read the last followed records, so every project starts fresh: ${last.error.message}`);
const previous: Record<string, FollowedProject> = (last.data?.[0]?.data as HistoryDay | undefined)?.followed ?? {};
try {
  const refs = await db.from('watchlist_items').select('ref').eq('kind', 'project');
  if (refs.error) throw new Error(refs.error.message);
  const { followed, summary: s } = await refreshFollowed(
    (refs.data ?? []).map((r: { ref: string }) => r.ref),
    previous,
    { fetchers: tabsFetchers(), today: row.day }
  );
  row.followed = followed;
  followedNote = `${Object.keys(followed).length} followed projects (${s.ok} read, ${s.reused} already read today, ${s.notFound} not listed, ${s.errors} unreachable; ${s.pages} pages, ${s.pageErrors} failed; ${s.requests} TABS requests in ${(s.ms / 1000).toFixed(1)}s)`;
} catch (error) {
  // Keep the last values, marked unchecked, so a digest reads this as missing data, never as a change.
  const why = error instanceof Error ? error.message : String(error);
  const at = new Date().toISOString();
  row.followed = Object.fromEntries(Object.entries(previous).map(([id, p]) => [id, { ...p, state: 'error' as const, failedAt: at, error: why.slice(0, 200) }]));
  console.log(`::warning::Followed projects not checked: ${why}`);
}

const saved = await db.from('market_history').upsert({ day: row.day, data: row }, { onConflict: 'day' });
if (saved.error) warn(saved.error.message);
const cutoff = pruneBefore(row.day, HISTORY_DAYS);
const pruned = await db.from('market_history').delete().lt('day', cutoff);
if (pruned.error) warn(`stored ${row.day}, but couldn't remove days before ${cutoff}: ${pruned.error.message}`);
const size = Buffer.byteLength(JSON.stringify(row));
console.log(
  `Market history: stored ${row.day} (${Math.round(size / 1024)} KB, ${Object.keys(row.projects).length} projects, ${row.registrations?.items.length ?? 'no'} recent filings, ${followedNote}); keeping ${HISTORY_DAYS} days.`
);
