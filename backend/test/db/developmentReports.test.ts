/**
 * The development report queue (pending/0019): members send and see only their
 * own reports, the database enforces the spam and duplicate rules, and only
 * reports the service role approves reach the public view. Skipped unless
 * TERRA_TEST_PG names a database: npm run test:db.
 */
import { execFileSync } from 'node:child_process';
import { beforeAll, describe, expect, it } from 'vitest';

const conn = process.env.TERRA_TEST_PG;

type Who = { role: 'anon' | 'authenticated' | 'service_role'; user?: string };

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

const admin = (query: string) => sql({ role: 'service_role' }, query);
const as = (user: string) => (query: string) => sql({ role: 'authenticated', user }, query);
const anon = (query: string) => sql({ role: 'anon' }, query);

const ids = {
  ana: '00000000-0000-4000-8000-0000000000a1',
  ben: '00000000-0000-4000-8000-0000000000a2',
  cal: '00000000-0000-4000-8000-0000000000a3'
};
const report = (fields: string, values: string) =>
  `insert into development_reports (city, description, ${fields}) values ('San Antonio', 'New club building going up off IH-10', ${values}) returning status`;

describe.skipIf(!conn)('development reports on a real database', () => {
  beforeAll(() => {
    execFileSync('psql', [conn!, '-X', '-q', '-v', 'ON_ERROR_STOP=1', '-c', `
      delete from auth.users where id in ('${ids.ana}', '${ids.ben}', '${ids.cal}');
      insert into auth.users (id, email, email_confirmed_at) values
        ('${ids.ana}', 'ana@utsa.edu', now()), ('${ids.ben}', 'ben@gmail.com', now()), ('${ids.cal}', 'cal@rice.edu', now());
    `]);
  });

  it('takes a report by address or by pin, always as pending from the signed-in member', () => {
    expect(as(ids.ana)(report('address, name', `'13735 IH-10 W, San Antonio, TX 78249', 'PDL Club'`))).toBe('pending');
    // A member can't approve their own report or file it under someone else.
    expect(as(ids.ana)(`${report('lat, lng, status, user_id', `29.58, -98.62, 'approved', '${ids.ben}'`).replace('returning status', 'returning status, user_id')}`)).toBe(
      `pending|${ids.ana}`
    );
  });

  it('refuses visitors and reports with no place, bad links or pins outside Texas', () => {
    expect(() => anon(report('address', `'1 Main St, Austin, TX'`))).toThrow(/permission denied/);
    expect(() => as(ids.ben)(`insert into development_reports (city, description) values ('Austin', 'Something big here')`)).toThrow(/address or drop a pin/);
    expect(() => as(ids.ben)(report('address, source_url', `'2 Main St, Austin, TX', 'javascript:alert(1)'`))).toThrow(/source_url/);
    expect(() => as(ids.ben)(report('lat, lng', `40.7, -74.0`))).toThrow(/check constraint/);
    expect(() => as(ids.ben)(report('address', `'3 Main St'`).replace('New club building going up off IH-10', 'short'))).toThrow(/description/);
    expect(() => as(ids.ben)(report('address, photo_path', `'4 Main St, Austin, TX', '${ids.ana}/x.jpg'`))).toThrow(/own folder/);
  });

  it('stops the same member sending the same place twice, and flags another member near it', () => {
    expect(() => as(ids.ana)(report('address', `'13735  ih-10 w, San Antonio, TX 78249'`))).toThrow(/already reported/);
    const first = admin(`select id from development_reports where user_id = '${ids.ana}' and address like '13735%'`);
    expect(as(ids.ben)(report('address', `'13735 IH 10 W San Antonio TX 78249'`).replace('returning status', 'returning possible_duplicate_of'))).toBe(first);
    const pin = admin(`select id from development_reports where user_id = '${ids.ana}' and lat is not null`);
    // About 50 m from Ana's pin.
    expect(as(ids.ben)(report('lat, lng', `29.5804, -98.6203`).replace('returning status', 'returning possible_duplicate_of'))).toBe(pin);
  });

  it('caps each member at 5 reports a day', () => {
    for (let i = 0; i < 5; i++) as(ids.cal)(report('address', `'${100 + i} Elm St, Dallas, TX'`));
    expect(() => as(ids.cal)(report('address', `'200 Elm St, Dallas, TX'`))).toThrow(/5 reports a day/);
  });

  it("shows members their own reports' status only, and lets nobody but the service role change them", () => {
    expect(as(ids.ben)(`select count(*) from development_reports where user_id <> '${ids.ben}'`)).toBe('0');
    expect(Number(as(ids.ben)(`select count(*) from development_reports`))).toBe(2);
    expect(() => as(ids.ana)(`update development_reports set status = 'approved'`)).toThrow(/permission denied/);
    expect(() => as(ids.ana)(`delete from development_reports`)).toThrow(/permission denied/);
    expect(() => anon(`select * from development_reports`)).toThrow(/permission denied/);
  });

  it('publishes only approved reports, without the reporter', () => {
    expect(anon(`select count(*) from published_development_reports where name = 'PDL Club'`)).toBe('0');
    admin(`update development_reports set status = 'approved', review_note = 'Checked TDLR TABS2026006871' where name = 'PDL Club'`);
    expect(anon(`select name || '|' || (verified_at is not null) from published_development_reports where name = 'PDL Club'`)).toBe('PDL Club|true');
    expect(() => anon(`select user_id from published_development_reports`)).toThrow(/user_id/);
    expect(as(ids.ana)(`select status from development_reports where name = 'PDL Club'`)).toBe('approved');
  });
});
