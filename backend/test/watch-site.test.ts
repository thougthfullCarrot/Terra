import { describe, expect, it } from 'vitest';
import { handleUnsubscribe } from '../../site/unsubscribe.js';
import {
  WATCH_LIMIT,
  addProblem,
  areaItem,
  countLine,
  digestRow,
  itemKey,
  itemLabel,
  marketItem,
  projectItem,
  unsubscribeParams
} from '../../site/watch.js';
import { renderEmail } from '../src/alerts/digest.js';

const USER = '00000000-0000-4000-8000-000000000001';
const TOKEN = 'a'.repeat(64);

describe('watchlist rules on the site', () => {
  it('builds items the database accepts', () => {
    expect(marketItem('Austin')).toEqual({ kind: 'market', city: 'Austin', ref: '', filters: {} });
    expect(marketItem('Austin', 'aptVacancy', { above: 8 })).toEqual({ kind: 'market', city: 'Austin', ref: 'aptVacancy', filters: { above: 8 } });
    // A line needs a figure to cross it.
    expect(marketItem('Austin', '', { above: 8 }).filters).toEqual({});
    expect(areaItem('Houston', { work: ['Addition', 'Demolition'], minCost: 2500000.6 }).filters).toEqual({ work: ['Addition'], minCost: 2500001 });
    expect(areaItem('Houston', { minCost: -5 }).filters).toEqual({});
    expect(projectItem('Austin', 'TABS1', 'Tower')).toEqual({ kind: 'project', city: 'Austin', ref: 'TABS1', filters: { name: 'Tower' } });
    expect(itemKey(marketItem('Austin', 'aptRent', { above: 1 }))).toBe(itemKey(marketItem('Austin', 'aptRent')));
  });

  it('labels items and the count in plain words', () => {
    expect(itemLabel(marketItem('Austin'))).toBe('Austin market figures');
    expect(itemLabel(marketItem('Austin', 'aptVacancy', { below: 5 }), () => 'Apartment vacancy')).toBe('Austin: Apartment vacancy below 5');
    expect(itemLabel(areaItem('Dallas', { work: ['New construction'], minCost: 1000000 }))).toBe(
      'New project filings in the Dallas metro (new construction, $1,000,000+)'
    );
    expect(itemLabel(projectItem('Austin', 'TABS1', 'Tower'))).toBe('Project: Tower (Austin)');
    expect(countLine(3)).toBe(`3 of ${WATCH_LIMIT} followed.`);
    expect(countLine(25)).toMatch(/Remove one/);
  });

  it('keeps digest settings to the allowed values, weekly by default', () => {
    expect(digestRow({ watchEmails: 'on', digestFrequency: 'daily' })).toEqual({ watch_emails: true, digest_frequency: 'daily' });
    expect(digestRow({ watchEmails: false, digestFrequency: 'hourly' })).toEqual({ watch_emails: false, digest_frequency: 'weekly' });
  });

  it('explains a refused add', () => {
    expect(addProblem('You can follow up to 25 items. Remove one to add another.')).toMatch(/up to 25/);
    expect(addProblem('new row violates row-level security policy for table "watchlist_items"')).toMatch(/college email or an active subscription/);
    expect(addProblem('duplicate key value violates unique constraint')).toBe("You're already following this.");
  });

  it('reads an unsubscribe link and rejects a damaged one', () => {
    expect(unsubscribeParams('?job=1')).toBeNull();
    expect(unsubscribeParams(`?unsubscribe=watch&u=${USER}&t=${TOKEN}`)).toEqual({ kind: 'watch', user: USER, token: TOKEN, valid: true });
    expect(unsubscribeParams(`?unsubscribe=watch&u=${USER}&t=short`)).toEqual({ kind: 'watch', valid: false });
    expect(unsubscribeParams(`?unsubscribe=everything&u=${USER}&t=${TOKEN}`)).toBeNull();
  });

  it('calls the database once for a good link and reports the result', async () => {
    const calls: { url: string; body: unknown; apikey: string | null }[] = [];
    const fetchImpl = (async (url: string, init: RequestInit) => {
      calls.push({ url, body: JSON.parse(String(init.body)), apikey: new Headers(init.headers).get('apikey') });
      return Response.json(true);
    }) as typeof fetch;
    const config = { supabaseUrl: 'https://abc.supabase.co/', supabaseAnonKey: 'anon' };
    const done = await handleUnsubscribe(config, { search: `?unsubscribe=jobs&u=${USER}&t=${TOKEN}` }, fetchImpl);
    expect(done).toEqual({ ok: true, text: expect.stringContaining('unsubscribed from job alert emails') });
    expect(calls).toEqual([{ url: 'https://abc.supabase.co/rest/v1/rpc/unsubscribe_alerts', body: { p_user: USER, p_scope: 'jobs', p_token: TOKEN }, apikey: 'anon' }]);
    const refused = await handleUnsubscribe(config, { search: `?unsubscribe=jobs&u=${USER}&t=${TOKEN}` }, (async () => Response.json(false)) as typeof fetch);
    expect(refused?.ok).toBe(false);
    expect(await handleUnsubscribe(config, { search: '?unsubscribe=jobs&u=x&t=y' }, fetchImpl)).toMatchObject({ ok: false });
    expect(calls).toHaveLength(1);
    expect(await handleUnsubscribe(config, { search: '' }, fetchImpl)).toBeNull();
  });
});

describe('job alert emails', () => {
  const picked = [{ job: { id: 'j1', role: 'Analyst', firm: 'Hines', city: 'Houston', kind: 'Entry-level', applyUrl: 'https://x.test', pay: null } }] as never;

  it('are unchanged without an unsubscribe link', () => {
    const email = renderEmail(picked, 'https://example.org/');
    expect(email.text).not.toMatch(/Unsubscribe/);
    expect(email.html).not.toMatch(/unsubscribe/);
  });

  it('carry the link when watchlists are on', () => {
    const link = 'https://example.org/?unsubscribe=jobs&u=a&t=b';
    const email = renderEmail(picked, 'https://example.org/', [], link);
    expect(email.text).toContain(`Unsubscribe from job alerts: ${link}`);
    expect(email.html).toContain('https://example.org/?unsubscribe=jobs&amp;u=a&amp;t=b');
  });
});
