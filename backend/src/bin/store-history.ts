/**
 * Store today's compact market copy in market_history (migration 0016) and
 * drop days older than HISTORY_DAYS, for watchlist digests.
 *
 *   npm run store:history -- ../site/market.json
 *
 * Needs SUPABASE_URL and SERVICE_ROLE_KEY. The Website workflow runs it only
 * on the default branch with WATCHLISTS_ENABLED on. A missing table (migration
 * not applied yet) or any other problem prints a warning and exits 0: history
 * must never hold back the site.
 */
import { readFile } from 'node:fs/promises';
import { createClient } from '@supabase/supabase-js';
import { HISTORY_DAYS, digestOf, pruneBefore } from '../alerts/history.js';
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
const saved = await db.from('market_history').upsert({ day: row.day, data: row }, { onConflict: 'day' });
if (saved.error) warn(saved.error.message);
const cutoff = pruneBefore(row.day, HISTORY_DAYS);
const pruned = await db.from('market_history').delete().lt('day', cutoff);
if (pruned.error) warn(`stored ${row.day}, but couldn't remove days before ${cutoff}: ${pruned.error.message}`);
const size = Buffer.byteLength(JSON.stringify(row));
console.log(
  `Market history: stored ${row.day} (${Math.round(size / 1024)} KB, ${Object.keys(row.projects).length} projects, ${row.registrations?.items.length ?? 'no'} recent filings); keeping ${HISTORY_DAYS} days.`
);
