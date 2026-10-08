import { describe, expect, it } from 'vitest';
import { createVerify, generateKeyPairSync } from 'node:crypto';
import type { FirmRow } from '../src/db/store.js';
import { SheetsClient, signJwt, spreadsheetId, sheetsConfigFromEnv, tabRange } from '../src/sheets/google.js';
import { FIRMS_TAB, firmStatuses, loadFirms, parseFirmTab, seedToRows } from '../src/sheets/firms.js';
import { accessLabel, jobRows, marketRows, signupRows } from '../src/sheets/tables.js';

const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const pem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
const account = { client_email: 'terra@example.iam.gserviceaccount.com', private_key: pem };

const seed: FirmRow[] = [
  { id: 1, name: 'Lincoln Property Company', ats: 'greenhouse', atsSlug: 'lincoln', atsHost: null, active: true, slugVerified: true },
  { id: 2, name: 'Hines', ats: 'workday', atsSlug: 'Hines', atsHost: 'hines.wd1.myworkdayjobs.com', active: false, slugVerified: false }
];

/** A fake Google: one token endpoint and a spreadsheet held in memory. */
function fakeGoogle(initial: Record<string, string[][]> = {}, options: { fail?: number } = {}) {
  const tabs = new Map(Object.entries(initial));
  const calls: { method: string; url: string; body?: unknown }[] = [];
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    const body = typeof init?.body === 'string' && init.body.startsWith('{') ? JSON.parse(init.body) : init?.body;
    calls.push({ method, url, body });

    if (url.startsWith('https://oauth2.googleapis.com/token')) return json({ access_token: 'token', expires_in: 3600 });
    if (options.fail) return json({ error: { message: 'The caller does not have permission' } }, options.fail);

    const path = decodeURIComponent(new URL(url).pathname.replace(/^\/v4\/spreadsheets\/[^/:]+/, ''));
    if (method === 'GET' && path === '') return json({ sheets: [...tabs.keys()].map((title) => ({ properties: { title } })) });
    if (path === ':batchUpdate') {
      for (const request of (body as { requests: { addSheet: { properties: { title: string } } }[] }).requests) {
        tabs.set(request.addSheet.properties.title, []);
      }
      return json({});
    }
    const title = /^\/values\/'(.+?)'/.exec(path)?.[1]?.replace(/''/g, "'") ?? '';
    if (method === 'GET') return json({ values: tabs.get(title) ?? [] });
    if (path.endsWith(':clear')) {
      tabs.set(title, []);
      return json({});
    }
    if (method === 'PUT') {
      const [, col = 'A', start = '1'] = /!([A-Z]+)(\d+)/.exec(path) ?? [];
      const offset = [...col].reduce((n, c) => n * 26 + c.charCodeAt(0) - 64, 0) - 1;
      const grid = tabs.get(title) ?? [];
      (body as { values: string[][] }).values.forEach((row, i) => {
        const cells = [...(grid[Number(start) - 1 + i] ?? [])];
        while (cells.length < offset) cells.push('');
        cells.splice(offset, row.length, ...row);
        grid[Number(start) - 1 + i] = cells;
      });
      tabs.set(title, grid);
      return json({});
    }
    return json({}, 404);
  }) as typeof fetch;

  return { tabs, calls, client: new SheetsClient({ account, spreadsheetId: 'sheet123' }, { fetchImpl }) };
}

describe('Google sign-in', () => {
  it('signs the token request with the service account key', () => {
    const jwt = signJwt({ iss: account.client_email }, pem);
    const [header, claims, signature] = jwt.split('.');
    expect(JSON.parse(Buffer.from(header!, 'base64url').toString())).toEqual({ alg: 'RS256', typ: 'JWT' });
    expect(JSON.parse(Buffer.from(claims!, 'base64url').toString()).iss).toBe(account.client_email);
    const ok = createVerify('RSA-SHA256').update(`${header}.${claims}`).verify(publicKey, Buffer.from(signature!, 'base64url'));
    expect(ok).toBe(true);
  });

  it('accepts a key whose newlines were pasted as \\n', () => {
    expect(() => signJwt({}, pem.replace(/\n/g, '\\n'))).not.toThrow();
  });

  it('reads settings from the environment, and the sheet id from a pasted URL', () => {
    expect(sheetsConfigFromEnv({})).toBeNull();
    const config = sheetsConfigFromEnv({
      GOOGLE_SERVICE_ACCOUNT_JSON: JSON.stringify(account),
      TERRA_SHEET_ID: 'https://docs.google.com/spreadsheets/d/1AbC-d_9/edit#gid=0'
    });
    expect(config?.spreadsheetId).toBe('1AbC-d_9');
    expect(spreadsheetId('1AbC-d_9')).toBe('1AbC-d_9');
    expect(() => sheetsConfigFromEnv({ GOOGLE_SERVICE_ACCOUNT_JSON: '{', TERRA_SHEET_ID: 'x' })).toThrow(/valid JSON/);
  });

  it('writes values as RAW so a cell is never run as a formula', async () => {
    const google = fakeGoogle({ Jobs: [] });
    await google.client.write(tabRange('Jobs', 'A1'), [['=IMPORTXML("x")']]);
    const put = google.calls.find((call) => call.method === 'PUT')!;
    expect(put.url).toContain('valueInputOption=RAW');
    expect(put.url).toContain(encodeURIComponent("'Jobs'!A1"));
  });
});

describe('the Firms tab', () => {
  it('reads firms by header, so columns can move', () => {
    const sheet = parseFirmTab([
      ['Board id', 'Firm', 'Board type', 'Active'],
      ['lincoln', 'Lincoln Property Company', 'Greenhouse', ''],
      ['', '', '', ''],
      ['cbre', 'CBRE', 'taleo', ''],
      ['x', 'Hines', 'workday', 'yes'],
      ['cortland', 'Cortland', 'greenhouse', 'no']
    ]);
    expect(sheet.firms.map((entry) => entry.firm?.name ?? entry.problem)).toEqual([
      'Lincoln Property Company',
      'Skipped: board type must be one of greenhouse, lever, workday, icims, workable, ashby, smartrecruiters',
      'Skipped: Workday needs a host',
      'Cortland'
    ]);
    expect(sheet.firms[0]).toMatchObject({ row: 2, firm: { ats: 'greenhouse', atsSlug: 'lincoln', active: true } });
    expect(sheet.firms[3]!.firm!.active).toBe(false);
    // No "Last check" header: it goes in the sixth column.
    expect(sheet.statusColumn).toBe('F');
  });

  it('uses the seed list when Sheets is not set up', async () => {
    const result = await loadFirms(null, seed, { write: true });
    expect(result).toMatchObject({ source: 'seed', firms: seed });
  });

  it('uses the seed list when the sheet cannot be read', async () => {
    const google = fakeGoogle({}, { fail: 403 });
    const result = await loadFirms(google.client, seed, { write: true });
    expect(result.source).toBe('seed');
    expect(result.firms).toBe(seed);
    expect(result.note).toMatch(/does not have permission/);
  });

  it('fills an empty sheet with the seed list, and uses the seed', async () => {
    const google = fakeGoogle({});
    const result = await loadFirms(google.client, seed, { write: true });
    expect(result.source).toBe('seed');
    expect(google.tabs.get(FIRMS_TAB)).toEqual(seedToRows(seed));
    // And the next build reads it back as the same firms.
    const again = await loadFirms(google.client, seed, { write: true });
    expect(again.source).toBe('sheet');
    expect(again.firms.map((firm) => [firm.name, firm.ats, firm.atsSlug, firm.atsHost, firm.active])).toEqual(
      seed.map((firm) => [firm.name, firm.ats, firm.atsSlug, firm.atsHost, firm.active])
    );
  });

  it('does not touch the sheet on a read-only build', async () => {
    const google = fakeGoogle({});
    const result = await loadFirms(google.client, seed, { write: false });
    expect(result.source).toBe('seed');
    expect(google.calls.some((call) => call.method !== 'GET' && call.url.includes('sheets.googleapis.com'))).toBe(false);
  });

  it('falls back to the seed when no row is usable', async () => {
    const google = fakeGoogle({ [FIRMS_TAB]: [['Firm', 'Board type', 'Board id'], ['CBRE', 'taleo', 'cbre']] });
    const result = await loadFirms(google.client, seed, { write: true });
    expect(result.source).toBe('seed');
  });

  it('adds the Sector column and the homebuilders to a tab made before them, once', async () => {
    const withBuilder: FirmRow[] = [
      ...seed,
      { id: 3, name: 'Perry Homes', ats: 'workable', atsSlug: 'perryhomes', atsHost: null, active: true, slugVerified: true, sector: 'Homebuilder' }
    ];
    const google = fakeGoogle({
      [FIRMS_TAB]: [
        ['Firm', 'Board type', 'Board id', 'Workday host', 'Active', 'Last check'],
        ['Lincoln Property Company', 'greenhouse', 'lincoln', '', 'yes', 'OK']
      ]
    });

    const result = await loadFirms(google.client, withBuilder, { write: true });
    expect(result.source).toBe('sheet');
    expect(result.firms.map((firm) => [firm.name, firm.sector])).toEqual([
      ['Lincoln Property Company', null],
      ['Perry Homes', 'Homebuilder']
    ]);
    expect(google.tabs.get(FIRMS_TAB)).toEqual([
      ['Firm', 'Board type', 'Board id', 'Workday host', 'Active', 'Last check', 'Sector', 'Real estate only'],
      ['Lincoln Property Company', 'greenhouse', 'lincoln', '', 'yes', 'OK', '', ''],
      ['Perry Homes', 'workable', 'perryhomes', '', 'yes', '', 'Homebuilder', '']
    ]);

    // The owner deletes the builder; the next build leaves it deleted.
    google.tabs.get(FIRMS_TAB)!.pop();
    const again = await loadFirms(google.client, withBuilder, { write: true });
    expect(again.firms.map((firm) => firm.name)).toEqual(['Lincoln Property Company']);
    expect(google.tabs.get(FIRMS_TAB)).toHaveLength(2);
  });

  it('adds the Real estate only column and the banks and title companies once', async () => {
    const withBank: FirmRow[] = [
      ...seed,
      { id: 9, name: 'Stewart', ats: 'workday', atsSlug: 'Careers', atsHost: 'stewart.wd1.myworkdayjobs.com', active: true, slugVerified: false, sector: 'Title & Escrow', creOnly: true }
    ];
    const google = fakeGoogle({
      [FIRMS_TAB]: [
        ['Firm', 'Board type', 'Board id', 'Workday host', 'Active', 'Last check', 'Sector'],
        ['Lincoln Property Company', 'greenhouse', 'lincoln', '', 'yes', 'OK', '']
      ]
    });
    const result = await loadFirms(google.client, withBank, { write: true });
    expect(result.firms.map((firm) => [firm.name, firm.sector, firm.creOnly])).toEqual([
      ['Lincoln Property Company', null, false],
      ['Stewart', 'Title & Escrow', true]
    ]);
    expect(google.tabs.get(FIRMS_TAB)![2]).toEqual(['Stewart', 'workday', 'Careers', 'stewart.wd1.myworkdayjobs.com', 'yes', '', 'Title & Escrow', 'yes']);

    google.tabs.get(FIRMS_TAB)!.pop();
    const again = await loadFirms(google.client, withBank, { write: true });
    expect(again.firms.map((firm) => firm.name)).toEqual(['Lincoln Property Company']);
  });

  it('reads a typed sector, and pins the seed\'s on a read-only build of an old tab', async () => {
    expect(
      parseFirmTab([
        ['Firm', 'Board type', 'Board id', 'Sector'],
        ['Brightland', 'lever', 'brightland', 'homebuilder'],
        ['Cortland', 'greenhouse', 'cortland', 'Nonsense']
      ]).firms.map((entry) => entry.firm?.sector)
    ).toEqual(['Homebuilder', null]);

    const google = fakeGoogle({ [FIRMS_TAB]: [['Firm', 'Board type', 'Board id'], ['Perry Homes', 'workable', 'perryhomes']] });
    const pinned: FirmRow[] = [{ id: 1, name: 'Perry Homes', ats: 'workable', atsSlug: 'perryhomes', active: true, slugVerified: true, sector: 'Homebuilder' }];
    const result = await loadFirms(google.client, pinned, { write: false });
    expect(result.firms[0]!.sector).toBe('Homebuilder');
    expect(google.calls.some((call) => call.method === 'PUT')).toBe(false);
  });

  it('writes each firm\'s result beside it', async () => {
    const sheet = parseFirmTab([
      ['Firm', 'Board type', 'Board id', 'Workday host', 'Active', 'Last check'],
      ['Lincoln Property Company', 'greenhouse', 'lincoln'],
      ['Cortland', 'greenhouse', 'cortland'],
      [],
      ['CBRE', 'taleo', 'cbre'],
      ['Hines', 'workday', 'Hines', 'hines.wd1.myworkdayjobs.com', 'no']
    ]);
    const statuses = firmStatuses(
      sheet,
      { ranAt: new Date('2026-10-05T01:20:00Z'), errors: [{ firm: 'Cortland', message: '404' }] },
      new Map([['Lincoln Property Company', 3]])
    )!;
    expect(statuses.range).toBe("'Firms'!F2:F6");
    expect(statuses.rows).toEqual([
      ['OK 2026-10-05 01:20 UTC: 3 matching jobs'],
      ['Failed 2026-10-05 01:20 UTC: 404'],
      [''],
      ['Skipped: board type must be one of greenhouse, lever, workday, icims, workable, ashby, smartrecruiters'],
      ['Not polled (Active is no)']
    ]);
  });
});

describe('copying the site to the sheet', () => {
  it('turns postings into rows', () => {
    const rows = jobRows({
      generatedAt: '2026-10-05T01:20:00.000Z',
      boards: { polled: 1, failed: 0 },
      cities: [],
      jobs: [
        {
          id: 'a',
          role: 'Analyst',
          firm: 'Hines',
          city: 'Houston',
          sector: 'Development',
          kind: 'Full-time',
          pay: null,
          postedAt: '2026-10-01T12:00:00.000Z',
          deadline: null,
          desc: '',
          reqs: [],
          applyUrl: 'https://example.com/a',
          match: {} as never,
          via: null
        }
      ]
    } as never);
    expect(rows[0]![10]).toBe('Refreshed 2026-10-05 01:20 UTC');
    expect(rows[1]).toEqual(['2026-10-01', 'Analyst', 'Hines', 'Houston', 'Development', 'Full-time', '', '', 'https://example.com/a', 'Firm careers page', '']);
  });

  it('labels market columns with their unit and period', () => {
    const rows = marketRows({
      generatedAt: '2026-10-05T01:20:00.000Z',
      metrics: [{ key: 'jobs', label: 'Total jobs', unit: 'count', better: 'high', source: 'BLS', note: '' }],
      groups: [],
      sources: [],
      markets: [{ city: 'Austin', metro: 'Austin-Round Rock', values: { jobs: 1_400_000 }, periods: { jobs: 'Aug 2026' } }]
    } as never);
    expect(rows[0]!.slice(0, 3)).toEqual(['City', 'Metro area', 'Total jobs, Aug 2026']);
    expect(rows[1]!.slice(0, 3)).toEqual(['Austin', 'Austin-Round Rock', 1_400_000]);
  });

  it('logs sign-ups newest first, with the same access rule as the site', () => {
    const now = new Date('2026-10-05T00:00:00Z');
    const rows = signupRows(
      [
        { id: 'u1', email: 'jane@mail.utexas.edu', created_at: '2026-10-01T00:00:00Z', email_confirmed_at: '2026-10-01T00:00:00Z' },
        { id: 'u2', email: 'pat@gmail.com', created_at: '2026-10-03T00:00:00Z', email_confirmed_at: '2026-10-03T00:00:00Z', last_sign_in_at: '2026-10-04T09:00:00Z' }
      ],
      [{ id: 'u1', school: 'UT Austin', grad_year: 2027, major: 'Finance' }],
      [{ user_id: 'u2', status: 'active', current_period_end: '2026-11-03T00:00:00Z' }],
      now
    );
    expect(rows.slice(1)).toEqual([
      ['2026-10-03', 'pat@gmail.com', 'Subscriber', '', '', '', '2026-10-04', ''],
      ['2026-10-01', 'jane@mail.utexas.edu', 'College (free)', 'UT Austin', 2027, 'Finance', '', '']
    ]);
  });

  it('does not count look-alike or unconfirmed college addresses', () => {
    const now = new Date();
    expect(accessLabel({ id: 'x', email: 'a@edu.com', created_at: '', email_confirmed_at: 'y' }, undefined, now)).toBe('Signed up, not subscribed');
    expect(accessLabel({ id: 'x', email: 'a@rice.edu', created_at: '' }, undefined, now)).toBe('Email not confirmed');
    expect(
      accessLabel({ id: 'x', email: 'a@b.com', created_at: '', email_confirmed_at: 'y' }, { user_id: 'x', status: 'canceled', current_period_end: null }, now)
    ).toBe('Subscription canceled');
  });
});
