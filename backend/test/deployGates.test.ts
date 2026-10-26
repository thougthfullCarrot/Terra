/**
 * The production deploy gates fail closed (docs/free-access.md):
 * - .github/scripts/free-access-gate.sh publishes only when the live database
 *   answers free_access_version() = 21, and fails when settings are missing;
 * - .github/scripts/production-site-check.sh refuses a built site without
 *   sign-in settings or with members-only files in it.
 * TERRA must never fall back to a public app.
 */
import { spawn, spawnSync } from 'node:child_process';
import { createServer, type Server } from 'node:http';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const scripts = new URL('../../.github/scripts/', import.meta.url).pathname;
const run = (script: string, args: string[], env: Record<string, string>) => {
  const result = spawnSync('bash', [join(scripts, script), ...args], { env: { PATH: process.env.PATH ?? '', ...env }, encoding: 'utf8' });
  return { code: result.status, out: `${result.stdout}${result.stderr}` };
};

/** Async, so the in-process fake database can answer while the script runs. */
const runAsync = (script: string, env: Record<string, string>) =>
  new Promise<{ code: number | null; out: string }>((done) => {
    const child = spawn('bash', [join(scripts, script)], { env: { PATH: process.env.PATH ?? '', ...env } });
    let out = '';
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (out += d));
    child.on('close', (code) => done({ code, out }));
  });

describe('free-access gate', () => {
  let server: Server;
  let url = '';
  beforeAll(async () => {
    server = createServer((req, res) => {
      const applied = req.url?.endsWith('/rpc/free_access_version') && req.headers.apikey === 'applied';
      res.writeHead(applied ? 200 : 404).end(applied ? '21' : '{"code":"PGRST202"}');
    });
    await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
    const address = server.address();
    url = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}`;
  });
  afterAll(() => server.close());

  it('passes once the migration is live', async () => {
    expect((await runAsync('free-access-gate.sh', { SUPABASE_URL: url, SUPABASE_ANON_KEY: 'applied' })).code).toBe(0);
  });
  it('fails when the migration has not run', async () => {
    const result = await runAsync('free-access-gate.sh', { SUPABASE_URL: url, SUPABASE_ANON_KEY: 'not-applied' });
    expect(result.code).toBe(1);
    expect(result.out).toMatch(/has not applied 0021_free_access/);
  });
  it('fails when the database cannot be reached', () => {
    expect(run('free-access-gate.sh', [], { SUPABASE_URL: 'http://127.0.0.1:1', SUPABASE_ANON_KEY: 'x' }).code).toBe(1);
  });
  it('fails closed when account settings are missing or incomplete', () => {
    const cases: Record<string, string>[] = [{}, { SUPABASE_URL: url }, { SUPABASE_ANON_KEY: 'applied' }, { SUPABASE_URL: '', SUPABASE_ANON_KEY: '' }];
    for (const env of cases) {
      const result = run('free-access-gate.sh', [], env);
      expect(result.code).toBe(1);
      expect(result.out).toMatch(/Production requires sign-in/);
    }
  });
});

describe('production site check', () => {
  const dirs: string[] = [];
  const site = (config: string | null, files: string[] = []) => {
    const dir = mkdtempSync(join(tmpdir(), 'terra-site-'));
    dirs.push(dir);
    if (config !== null) writeFileSync(join(dir, 'config.js'), config);
    for (const file of files) file.endsWith('/') ? mkdirSync(join(dir, file)) : writeFileSync(join(dir, file), '{}');
    return dir;
  };
  const good = `export const CONFIG = { supabaseUrl: 'https://abcd1234.supabase.co', supabaseAnonKey: 'anon' };`;
  afterAll(() => dirs.forEach((dir) => rmSync(dir, { recursive: true, force: true })));

  it('passes a site that requires sign-in and holds no members-only files', () => {
    expect(run('production-site-check.sh', [site(good, ['news.json', 'stats.json'])], {}).code).toBe(0);
  });
  it('fails without config.js or with the open-site config', () => {
    expect(run('production-site-check.sh', [site(null)], {}).code).toBe(1);
    // The repository's own site/config.js: no project, so the site would be open.
    const open = run('production-site-check.sh', [new URL('../../site', import.meta.url).pathname], {});
    expect(open.code).toBe(1);
    expect(open.out).toMatch(/would open without sign-in/);
    expect(run('production-site-check.sh', [site(`export const CONFIG = { supabaseUrl: 'https://abcd1234.supabase.co', supabaseAnonKey: '' };`)], {}).code).toBe(1);
  });
  it('fails when a members-only file would be published', () => {
    for (const file of ['postings.json', 'market.json', 'developments/']) {
      const result = run('production-site-check.sh', [site(good, [file])], {});
      expect(result.code).toBe(1);
      expect(result.out).toMatch(/members-only/);
    }
  });
});
