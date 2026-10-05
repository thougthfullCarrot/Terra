/**
 * Copy the website's data into the owner's Google Sheet.
 *
 *   npm run sync:sheets                      # reads ../site/postings.json and ../site/market.json
 *
 * Needs GOOGLE_SERVICE_ACCOUNT_JSON and TERRA_SHEET_ID; without them it says so
 * and exits cleanly. Writes three tabs, each replaced whole:
 *
 *   Jobs      every posting on the site
 *   Market    the market data table
 *   Sign-ups  one row per account: join date, email, access, school, grad
 *             year, major. Needs SUPABASE_URL and SERVICE_ROLE_KEY. Resumes,
 *             pictures and profile text never leave Supabase.
 *
 * Each tab is independent: one failing is reported and the others still go.
 */
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { SiteSnapshot } from '../site/snapshot.js';
import type { MarketSnapshot } from '../market/snapshot.js';
import { sheetsClientFromEnv } from '../sheets/env.js';
import {
  JOBS_TAB,
  MARKET_TAB,
  SIGNUPS_TAB,
  jobRows,
  marketRows,
  signupRows,
  type SignupProfile,
  type SignupSubscription,
  type SignupUser
} from '../sheets/tables.js';
import type { Cell } from '../sheets/google.js';

const here = dirname(fileURLToPath(import.meta.url));
const SITE = resolve(here, '../../../site');

async function readJson<T>(path: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(path, 'utf8')) as T;
  } catch {
    return null;
  }
}

async function supabaseGet<T>(base: string, key: string, path: string): Promise<T> {
  const response = await fetch(`${base}${path}`, {
    headers: { apikey: key, authorization: `Bearer ${key}` },
    signal: AbortSignal.timeout(30_000)
  });
  if (!response.ok) throw new Error(`Supabase ${path.split('?')[0]} returned ${response.status}`);
  return (await response.json()) as T;
}

async function signups(): Promise<Cell[][] | null> {
  const base = process.env.SUPABASE_URL?.replace(/\/+$/, '');
  const key = process.env.SERVICE_ROLE_KEY;
  if (!base || !key) return null;

  const users: SignupUser[] = [];
  for (let page = 1; ; page++) {
    const body = await supabaseGet<{ users: SignupUser[] }>(base, key, `/auth/v1/admin/users?page=${page}&per_page=1000`);
    users.push(...body.users);
    if (body.users.length < 1000) break;
  }
  const profiles = await supabaseGet<SignupProfile[]>(base, key, '/rest/v1/profiles?select=id,school,grad_year,major');
  const subscriptions = await supabaseGet<SignupSubscription[]>(
    base,
    key,
    '/rest/v1/subscriptions?select=user_id,status,current_period_end'
  );
  return signupRows(users, profiles, subscriptions, new Date());
}

async function main(): Promise<void> {
  const sheets = sheetsClientFromEnv();
  if (!sheets) {
    console.log('Google Sheets not set up (GOOGLE_SERVICE_ACCOUNT_JSON, TERRA_SHEET_ID); nothing to copy.');
    return;
  }

  const postings = await readJson<SiteSnapshot>(resolve(SITE, 'postings.json'));
  const market = await readJson<MarketSnapshot>(resolve(SITE, 'market.json'));

  const tabs: { title: string; rows: () => Promise<Cell[][] | null>; skip: string }[] = [
    { title: JOBS_TAB, rows: async () => (postings ? jobRows(postings) : null), skip: 'no postings file this run' },
    { title: MARKET_TAB, rows: async () => (market ? marketRows(market) : null), skip: 'no market data file this run' },
    { title: SIGNUPS_TAB, rows: signups, skip: 'accounts are not set up' }
  ];

  await sheets.ensureTabs(tabs.map((tab) => tab.title));

  let failed = 0;
  for (const tab of tabs) {
    try {
      const rows = await tab.rows();
      if (!rows) {
        console.log(`${tab.title}: skipped, ${tab.skip}.`);
        continue;
      }
      await sheets.replaceTab(tab.title, rows);
      console.log(`${tab.title}: wrote ${rows.length - 1} rows.`);
    } catch (error) {
      failed++;
      console.error(`${tab.title}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  if (failed) process.exitCode = 1;
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
