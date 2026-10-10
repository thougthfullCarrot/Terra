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
  full: '00000000-0000-4000-8000-000000000007'
};

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
        ('${ids.full}', 'max@rice.edu', now(), '{}');
      insert into profiles (id) select id from auth.users;
      insert into subscriptions (user_id, stripe_customer_id, stripe_subscription_id, status, current_period_end) values
        ('${ids.subscriber}', 'cus_a', 'sub_a', 'active', now() + interval '20 days'),
        ('${ids.lapsed}', 'cus_b', 'sub_b', 'canceled', now() - interval '2 days');
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

  it('can be applied twice, keeping the same link secret', () => {
    const before = admin(`select public.alert_link_secret()`);
    execFileSync('psql', [conn!, '-X', '-q', '-v', 'ON_ERROR_STOP=1', '-f', new URL('../../supabase/pending/0016_watchlists.sql', import.meta.url).pathname], {
      stdio: ['ignore', 'pipe', 'pipe']
    });
    expect(admin(`select public.alert_link_secret()`)).toBe(before);
    expect(admin(`select count(*) from watchlist_items`)).not.toBe('0');
  });
});
