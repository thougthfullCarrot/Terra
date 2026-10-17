/**
 * The members-only snapshot rows: the feed, market data and each market's
 * development list (developments/<market>.json, PR #81) share one policy.
 * Checked on a real Postgres with every migration loaded: npm run test:db.
 */
import { execFileSync } from 'node:child_process';
import { beforeAll, describe, expect, it } from 'vitest';

const conn = process.env.TERRA_TEST_PG;

type Who = { role: 'anon' | 'authenticated' | 'service_role'; user?: string };

/** Run SQL as a role (and user), returning rows as text; throws with Postgres's message on error. */
function sql(who: Who, query: string): string {
  const claim = who.user ? `set local request.jwt.claim.sub = '${who.user}';` : '';
  try {
    return execFileSync('psql', [conn!, '-X', '-q', '-A', '-t', '-v', 'ON_ERROR_STOP=1', '-c', `begin; set local role ${who.role}; ${claim} ${query}; commit;`], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe']
    }).trim();
  } catch (error) {
    throw new Error(String((error as { stderr?: string }).stderr ?? error));
  }
}

const anon = (query: string) => sql({ role: 'anon' }, query);
const as = (user: string) => (query: string) => sql({ role: 'authenticated', user }, query);

const ids = {
  student: '00000000-0000-4000-8000-000000000101',
  subscriber: '00000000-0000-4000-8000-000000000102',
  none: '00000000-0000-4000-8000-000000000103',
  lapsed: '00000000-0000-4000-8000-000000000104',
  unconfirmed: '00000000-0000-4000-8000-000000000105'
};
const ROWS = ['market', 'developments/houston.json', 'developments/san-antonio.json'];
const visible = (run: (q: string) => string) => run(`select string_agg(id, ',' order by id) from site_snapshots where id = any(array['${ROWS.join("','")}'])`);

describe.skipIf(!conn)('members-only snapshot rows on a real database', () => {
  beforeAll(() => {
    execFileSync('psql', [conn!, '-X', '-q', '-v', 'ON_ERROR_STOP=1', '-c', `
      truncate auth.users cascade;
      insert into auth.users (id, email, email_confirmed_at, raw_app_meta_data) values
        ('${ids.student}', 'sam@mail.utexas.edu', now(), '{}'),
        ('${ids.subscriber}', 'pat@gmail.com', now(), '{}'),
        ('${ids.none}', 'lee@gmail.com', now(), '{}'),
        ('${ids.lapsed}', 'kim@gmail.com', now(), '{}'),
        ('${ids.unconfirmed}', 'ana@tamu.edu', null, '{}');
      insert into profiles (id) select id from auth.users on conflict do nothing;
      insert into subscriptions (user_id, stripe_customer_id, stripe_subscription_id, status, current_period_end) values
        ('${ids.subscriber}', 'cus_s1', 'sub_s1', 'active', now() + interval '20 days'),
        ('${ids.lapsed}', 'cus_s2', 'sub_s2', 'canceled', now() - interval '2 days');
      insert into site_snapshots (id, data) values
        ${ROWS.map((id) => `('${id}', '{"projects": []}')`).join(',\n        ')}
      on conflict (id) do update set data = excluded.data;
    `]);
  });

  it('denies signed-out visitors every row, market data and development lists alike', () => {
    let read: string;
    try {
      read = anon(`select count(*) from site_snapshots`);
    } catch (error) {
      read = String(error);
    }
    // Either no grant at all or no rows through the policy; never a row.
    expect(read === '0' || /permission denied/.test(read)).toBe(true);
    expect(() => anon(`insert into site_snapshots (id, data) values ('developments/x.json', '{}')`)).toThrow();
  });

  it('shows a market list to exactly the members who can read market data', () => {
    for (const member of [ids.student, ids.subscriber]) expect(visible(as(member))).toBe(ROWS.slice().sort().join(','));
    for (const outsider of [ids.none, ids.lapsed, ids.unconfirmed]) expect(visible(as(outsider))).toBe('');
  });

  it('lets no signed-in user write or change the rows', () => {
    expect(() => as(ids.student)(`insert into site_snapshots (id, data) values ('developments/x.json', '{}')`)).toThrow();
    let changed: string;
    try {
      changed = as(ids.subscriber)(`update site_snapshots set data = '{}' where id = 'developments/houston.json' returning id`);
    } catch {
      changed = '';
    }
    expect(changed).toBe('');
  });
});
