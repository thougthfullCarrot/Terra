/**
 * Row-level security, the 25-item limit and the unsubscribe link, checked on
 * a real Postgres with every migration loaded (test/db/run.sh starts one).
 * Skipped unless TERRA_TEST_PG names that database: npm run test:db.
 */
import { execFile, execFileSync } from 'node:child_process';
import { promisify } from 'node:util';
import { beforeAll, describe, expect, it } from 'vitest';
import { unsubscribeToken } from '../../src/alerts/unsubscribe.js';

const conn = process.env.TERRA_TEST_PG;
const run = promisify(execFile);

type Who = { role: 'anon' | 'authenticated' | 'service_role'; user?: string };

function script(who: Who, query: string): string {
  const claim = who.user ? `set local request.jwt.claim.sub = '${who.user}';` : '';
  return `begin; set local role ${who.role}; ${claim} ${query}; commit;`;
}

/** Run SQL as a role (and user), returning rows as text; throws with Postgres's message on error. */
function sql(who: Who, query: string): string {
  try {
    return execFileSync('psql', [conn!, '-X', '-q', '-A', '-t', '-v', 'ON_ERROR_STOP=1', '-c', script(who, query)], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe']
    }).trim();
  } catch (error) {
    throw new Error(String((error as { stderr?: string }).stderr ?? error));
  }
}

const admin = (query: string) => sql({ role: 'service_role' }, query);
const as = (user: string) => (query: string) => sql({ role: 'authenticated', user }, query);
const anon = (query: string) => sql({ role: 'anon' }, query);

const ids = {
  student: '00000000-0000-4000-8000-000000000001',
  subscriber: '00000000-0000-4000-8000-000000000002',
  none: '00000000-0000-4000-8000-000000000003',
  lapsed: '00000000-0000-4000-8000-000000000004',
  unconfirmed: '00000000-0000-4000-8000-000000000005',
  testUser: '00000000-0000-4000-8000-000000000006',
  full: '00000000-0000-4000-8000-000000000007',
  outsider: '00000000-0000-4000-8000-000000000008'
};

const pending = (file: string) => new URL(`../../supabase/${file}`, import.meta.url).pathname;
const runFile = (path: string) => execFileSync('psql', [conn!, '-X', '-q', '-v', 'ON_ERROR_STOP=1', '-f', path], { stdio: ['ignore', 'pipe', 'pipe'] });

describe.skipIf(!conn)('watchlists on a real database', () => {
  beforeAll(() => {
    // Superuser setup: users, profiles, one active and one lapsed subscription.
    execFileSync('psql', [conn!, '-X', '-q', '-v', 'ON_ERROR_STOP=1', '-c', `
      truncate auth.users cascade;
      insert into auth.users (id, email, email_confirmed_at, raw_app_meta_data) values
        ('${ids.student}', 'sam@mail.utexas.edu', now(), '{}'),
        ('${ids.subscriber}', 'pat@gmail.com', now(), '{}'),
        ('${ids.none}', 'lee@gmail.com', now(), '{}'),
        ('${ids.lapsed}', 'kim@gmail.com', now(), '{}'),
        ('${ids.unconfirmed}', 'ana@tamu.edu', null, '{}'),
        ('${ids.testUser}', 'fake@test.edu', now(), '{"terra_test_user": "true"}'),
        ('${ids.full}', 'max@rice.edu', now(), '{}'),
        ('${ids.outsider}', 'jo@utdallas.edu', now(), '{}');
      insert into profiles (id) select id from auth.users;
      insert into subscriptions (user_id, stripe_customer_id, stripe_subscription_id, status, current_period_end) values
        ('${ids.subscriber}', 'cus_a', 'sub_a', 'active', now() + interval '20 days'),
        ('${ids.lapsed}', 'cus_b', 'sub_b', 'canceled', now() - interval '2 days');
      -- Private beta: everyone but the outsider is a tester.
      insert into private.watch_testers (user_id) select id from auth.users where id <> '${ids.outsider}';
    `]);
  });

  it('lets a college member and a subscriber follow items, and nobody else', () => {
    expect(as(ids.student)(`insert into watchlist_items (kind, city) values ('market', 'Austin') returning kind`)).toBe('market');
    expect(as(ids.subscriber)(`insert into watchlist_items (kind, city, ref) values ('project', 'Houston', 'TABS2026000001') returning ref`)).toBe(
      'TABS2026000001'
    );
    expect(() => as(ids.none)(`insert into watchlist_items (kind, city) values ('area', 'Dallas')`)).toThrow(/row-level security/);
    expect(() => as(ids.unconfirmed)(`insert into watchlist_items (kind, city) values ('area', 'Dallas')`)).toThrow(/row-level security/);
    expect(() => anon(`insert into watchlist_items (user_id, kind, city) values ('${ids.student}', 'area', 'Dallas')`)).toThrow();
  });

  it('keeps each member to their own items', () => {
    expect(() => as(ids.student)(`insert into watchlist_items (user_id, kind, city) values ('${ids.subscriber}', 'area', 'Dallas')`)).toThrow(
      /row-level security/
    );
    expect(as(ids.student)(`select count(*) from watchlist_items where user_id = '${ids.subscriber}'`)).toBe('0');
    expect(as(ids.subscriber)(`delete from watchlist_items where user_id = '${ids.student}' returning id`)).toBe('');
    expect(() => as(ids.student)(`update watchlist_items set user_id = '${ids.subscriber}'`)).toThrow(/row-level security/);
    expect(anon(`select count(*) from watchlist_items`)).toBe('0');
  });

  it('lets a lapsed subscriber see and remove items but not add any', () => {
    admin(`insert into watchlist_items (user_id, kind, city) values ('${ids.lapsed}', 'area', 'Austin')`);
    expect(as(ids.lapsed)(`select count(*) from watchlist_items`)).toBe('1');
    expect(() => as(ids.lapsed)(`insert into watchlist_items (kind, city) values ('area', 'Dallas')`)).toThrow(/row-level security/);
    expect(as(ids.lapsed)(`delete from watchlist_items returning city`)).toBe('Austin');
  });

  it('stops at 25 items', () => {
    const add = as(ids.full);
    for (let i = 0; i < 25; i++) add(`insert into watchlist_items (kind, city, ref) values ('project', 'Austin', 'TABS${i}')`);
    expect(() => add(`insert into watchlist_items (kind, city, ref) values ('project', 'Austin', 'TABS25')`)).toThrow(/up to 25 items/);
    expect(add(`select count(*) from watchlist_items`)).toBe('25');
    add(`delete from watchlist_items where ref = 'TABS0'`);
    expect(add(`insert into watchlist_items (kind, city, ref) values ('project', 'Austin', 'TABS25') returning ref`)).toBe('TABS25');
  });

  it('holds the limit when two adds race for the last place', async () => {
    admin(`delete from watchlist_items where user_id = '${ids.full}' and ref = 'TABS25'`);
    const insert = (ref: string) =>
      run('psql', [conn!, '-X', '-q', '-v', 'ON_ERROR_STOP=1', '-c', script({ role: 'authenticated', user: ids.full }, `insert into watchlist_items (kind, city, ref) values ('project', 'Austin', '${ref}')`)]).then(
        () => 'ok',
        () => 'refused'
      );
    const results = await Promise.all([insert('RACE1'), insert('RACE2')]);
    expect(results.sort()).toEqual(['ok', 'refused']);
    expect(admin(`select count(*) from watchlist_items where user_id = '${ids.full}'`)).toBe('25');
  });

  it('rejects malformed items', () => {
    expect(() => as(ids.student)(`insert into watchlist_items (kind, city) values ('firm', 'Austin')`)).toThrow(/check/);
    expect(() => as(ids.student)(`insert into watchlist_items (kind, city, filters) values ('area', 'Austin', '[1]')`)).toThrow(/check/);
    expect(() => as(ids.student)(`insert into watchlist_items (kind, city, ref) values ('project', 'Austin', repeat('x', 61))`)).toThrow(/check/);
  });

  it('keeps the history, send log and secret away from members and visitors', () => {
    admin(`insert into market_history (day, data) values ('2026-10-01', '{}') on conflict do nothing`);
    admin(`insert into watch_sends (user_id, event_id, state) values ('${ids.student}', 'e1', 'sent'), ('${ids.subscriber}', 'e2', 'sent') on conflict do nothing`);
    expect(as(ids.student)(`select count(*) from market_history`)).toBe('0');
    expect(anon(`select count(*) from market_history`)).toBe('0');
    expect(as(ids.student)(`select event_id from watch_sends`)).toBe('e1');
    expect(() => as(ids.student)(`insert into watch_sends (user_id, event_id) values ('${ids.student}', 'e3')`)).toThrow(/row-level security/);
    expect(() => as(ids.student)(`select * from watch_recipients()`)).toThrow(/permission denied/);
    expect(() => as(ids.student)(`select public.alert_link_secret()`)).toThrow(/permission denied/);
    expect(() => anon(`select public.alert_link_secret()`)).toThrow(/permission denied/);
    expect(() => as(ids.student)(`select * from private.alert_link_secret`)).toThrow(/permission denied/);
  });

  it('lists only eligible members with the digest on and something followed', () => {
    admin(`update profiles set watch_emails = true`);
    admin(`insert into watchlist_items (user_id, kind, city) values ('${ids.testUser}', 'area', 'Austin'), ('${ids.lapsed}', 'area', 'Austin'), ('${ids.unconfirmed}', 'area', 'Austin')`);
    const rows = admin(`select email || '|' || digest_frequency || '|' || jsonb_array_length(items) from watch_recipients() order by email`).split('\n');
    expect(rows).toEqual(['max@rice.edu|weekly|25', 'pat@gmail.com|weekly|1', 'sam@mail.utexas.edu|weekly|1']);
  });

  it('turns emails off from a signed link, without signing in, and refuses a forged one', () => {
    const secret = admin(`select public.alert_link_secret()`);
    expect(secret).toMatch(/^[0-9a-f]{64}$/);
    const token = unsubscribeToken(secret, ids.student, 'watch');
    expect(anon(`select public.unsubscribe_alerts('${ids.student}', 'watch', '${token}')`)).toBe('t');
    expect(admin(`select watch_emails from profiles where id = '${ids.student}'`)).toBe('f');
    // The token for one member or one kind of email does nothing for another.
    expect(anon(`select public.unsubscribe_alerts('${ids.subscriber}', 'watch', '${token}')`)).toBe('f');
    expect(anon(`select public.unsubscribe_alerts('${ids.student}', 'jobs', '${token}')`)).toBe('f');
    expect(anon(`select public.unsubscribe_alerts('${ids.student}', 'all', '${token}')`)).toBe('f');
    expect(admin(`select watch_emails from profiles where id = '${ids.subscriber}'`)).toBe('t');
    admin(`update profiles set email_alerts = true where id = '${ids.subscriber}'`);
    expect(anon(`select public.unsubscribe_alerts('${ids.subscriber}', 'jobs', '${unsubscribeToken(secret, ids.subscriber, 'jobs')}')`)).toBe('t');
    expect(admin(`select email_alerts::text || watch_emails::text from profiles where id = '${ids.subscriber}'`)).toBe('falsetrue');
  });

  it('can be applied twice, keeping the same link secret, testers and beta switch', () => {
    const before = admin(`select public.alert_link_secret()`);
    runFile(pending('migrations/0017_watchlists.sql'));
    expect(admin(`select public.alert_link_secret()`)).toBe(before);
    expect(admin(`select count(*) from watchlist_items`)).not.toBe('0');
    expect(as(ids.outsider)(`select public.watch_beta_access()`)).toBe('f');
    expect(as(ids.student)(`select public.watch_beta_access()`)).toBe('t');
  });
});

describe.skipIf(!conn)('the private beta', () => {
  const outsider = () => as(ids.outsider);

  it('starts on, and tells each member only about themselves', () => {
    expect(execFileSync('psql', [conn!, '-X', '-A', '-t', '-c', 'select private_beta from private.watch_settings'], { encoding: 'utf8' }).trim()).toBe('t');
    expect(outsider()(`select public.watch_beta_access()`)).toBe('f');
    expect(as(ids.student)(`select public.watch_beta_access()`)).toBe('t');
    // Visitors can't ask at all, and nobody can ask about another account.
    expect(() => anon(`select public.watch_beta_access()`)).toThrow(/permission denied/);
    expect(() => outsider()(`select private.watch_open_to('${ids.student}')`)).toThrow(/permission denied/);
  });

  it('refuses every watchlist read and write from a member who is not a tester', () => {
    expect(() => outsider()(`insert into watchlist_items (kind, city) values ('market', 'Austin')`)).toThrow(/row-level security/);
    admin(`insert into watchlist_items (user_id, kind, city) values ('${ids.outsider}', 'market', 'Dallas')`);
    expect(outsider()(`select count(*) from watchlist_items`)).toBe('0');
    expect(outsider()(`update watchlist_items set city = 'Houston' returning id`)).toBe('');
    expect(outsider()(`delete from watchlist_items returning id`)).toBe('');
    admin(`insert into watch_sends (user_id, event_id, state) values ('${ids.outsider}', 'o1', 'sent') on conflict do nothing`);
    expect(outsider()(`select count(*) from watch_sends`)).toBe('0');
    expect(admin(`select city from watchlist_items where user_id = '${ids.outsider}'`)).toBe('Dallas');
  });

  it('keeps the tester list and the switch out of reach of members and visitors', () => {
    for (const who of [outsider(), as(ids.student), anon]) {
      expect(() => who(`select * from private.watch_testers`)).toThrow(/permission denied/);
      expect(() => who(`insert into private.watch_testers (user_id) values ('${ids.outsider}')`)).toThrow(/permission denied/);
      expect(() => who(`update private.watch_settings set private_beta = false`)).toThrow(/permission denied/);
    }
    // Setting their own profile flag gets a non-tester nothing.
    outsider()(`update profiles set watch_emails = true where id = '${ids.outsider}'`);
    expect(outsider()(`select public.watch_beta_access()`)).toBe('f');
  });

  it('sends digests only to testers', () => {
    admin(`update profiles set watch_emails = true where id = '${ids.outsider}'`);
    expect(admin(`select count(*) from watch_recipients() where user_id = '${ids.outsider}'`)).toBe('0');
    expect(admin(`select count(*) from watch_recipients()`)).not.toBe('0');
  });

  it('opens to every eligible member once the beta is switched off, and closes again', () => {
    execFileSync('psql', [conn!, '-X', '-q', '-c', 'update private.watch_settings set private_beta = false']);
    expect(outsider()(`select count(*) from watchlist_items`)).toBe('1');
    expect(admin(`select count(*) from watch_recipients() where user_id = '${ids.outsider}'`)).toBe('1');
    execFileSync('psql', [conn!, '-X', '-q', '-c', 'update private.watch_settings set private_beta = true']);
    expect(outsider()(`select count(*) from watchlist_items`)).toBe('0');
  });

  it('drops out of the beta when a tester account is deleted', () => {
    execFileSync('psql', [conn!, '-X', '-q', '-c', `delete from auth.users where id = '${ids.testUser}'`]);
    expect(execFileSync('psql', [conn!, '-X', '-A', '-t', '-c', `select count(*) from private.watch_testers where user_id = '${ids.testUser}'`], { encoding: 'utf8' }).trim()).toBe('0');
  });
});

describe.skipIf(!conn)('rolling back 0017', () => {
  const su = (query: string) => execFileSync('psql', [conn!, '-X', '-A', '-t', '-v', 'ON_ERROR_STOP=1', '-c', query], { encoding: 'utf8' }).trim();
  const accounts = () =>
    su(`select (select count(*) from auth.users) || '|' || (select count(*) from profiles) || '|' || (select string_agg(user_id || status, ',' order by user_id) from subscriptions) || '|' || (select string_agg(id || email_alerts::text, ',' order by id) from profiles)`);

  it('removes only what 0017 added, keeps accounts, billing and job alerts, and can be re-applied', () => {
    su(`update profiles set email_alerts = (id::text like '%1' or id::text like '%2')`);
    const before = accounts();
    runFile(pending('rollback/0017_watchlists_rollback.sql'));
    expect(accounts()).toBe(before);
    expect(su(`select count(*) from pg_tables where tablename in ('watchlist_items', 'watch_sends', 'watch_digests', 'market_history')`)).toBe('0');
    expect(su(`select count(*) from pg_namespace where nspname = 'private'`)).toBe('0');
    expect(su(`select count(*) from information_schema.columns where table_name = 'profiles' and column_name in ('watch_emails', 'digest_frequency')`)).toBe('0');
    expect(su(`select count(*) from pg_proc where proname in ('watch_recipients', 'alert_link_secret', 'unsubscribe_alerts', 'watch_beta_access', 'watch_open_to', 'watchlist_limit')`)).toBe('0');
    // Job alerts still have what they read.
    expect(Number(admin(`select count(*) from alert_recipients()`))).toBeGreaterThanOrEqual(0);
    // Running it again is harmless, and 0017 goes back on cleanly, beta on.
    runFile(pending('rollback/0017_watchlists_rollback.sql'));
    runFile(pending('migrations/0017_watchlists.sql'));
    expect(accounts()).toBe(before);
    expect(su(`select private_beta from private.watch_settings`)).toBe('t');
    expect(su(`select count(*) from private.watch_testers`)).toBe('0');
  });
});
