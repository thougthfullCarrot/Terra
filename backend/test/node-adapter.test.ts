import { describe, expect, it, afterAll, beforeAll } from 'vitest';
import { createServer, type Server } from 'node:http';
import { toNodeHandler } from '../src/lib/node-adapter.js';
import { authorizedToCollect, createHandler } from '../src/api/handler.js';

/**
 * These run the real API over a real socket — the same path Vercel takes.
 * Everything else in the suite calls the web handler directly, which would not
 * catch an adapter that mangles a body, a header, or a query string.
 */
let server: Server;
let base: string;

const handle = createHandler({
  supabaseUrl: 'https://example.supabase.co',
  serviceRoleKey: 'service-role-key',
  collectorSecret: 'pg-cron-secret',
  cronSecret: 'vercel-cron-secret'
});

beforeAll(async () => {
  server = createServer(toNodeHandler(handle));
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  base = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}`;
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve()))
  );
});

describe('toNodeHandler', () => {
  it('serves a GET and preserves the status and JSON body', async () => {
    const response = await fetch(`${base}/health`);
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('application/json');
    await expect(response.json()).resolves.toMatchObject({ ok: true });
  });

  it('passes the query string through', async () => {
    // state=CA is refused by the feed reader, which proves the param arrived.
    const response = await fetch(`${base}/v1/postings?state=CA`);
    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toMatchObject({
      error: expect.stringContaining('TX')
    });
  });

  it('passes custom request headers through', async () => {
    const response = await fetch(`${base}/v1/collect`, {
      method: 'POST',
      headers: { 'x-collector-secret': 'wrong' }
    });
    expect(response.status).toBe(403);
  });

  it('404s an unknown path', async () => {
    expect((await fetch(`${base}/nope`)).status).toBe(404);
  });
});

/**
 * Checked on the predicate rather than over HTTP: a request that passes the
 * gate runs a real collector pass, which is not what these assertions are
 * about.
 */
describe('authorizedToCollect', () => {
  const config = { collectorSecret: 'pg-cron-secret', cronSecret: 'vercel-cron-secret' };
  const collect = (headers: Record<string, string>, method = 'POST') =>
    authorizedToCollect(
      new Request('https://api.test/v1/collect', { method, headers }),
      { supabaseUrl: 'x', serviceRoleKey: 'y', ...config }
    );

  it("accepts pg_cron's custom header", () => {
    expect(collect({ 'x-collector-secret': 'pg-cron-secret' })).toBe(true);
  });

  it("accepts Vercel Cron's bearer token on a GET", () => {
    expect(collect({ authorization: 'Bearer vercel-cron-secret' }, 'GET')).toBe(true);
  });

  it('rejects the wrong values for either scheme', () => {
    expect(collect({ 'x-collector-secret': 'wrong' })).toBe(false);
    expect(collect({ authorization: 'Bearer wrong' })).toBe(false);
    expect(collect({})).toBe(false);
  });

  it('does not accept a user JWT as a scheduler credential', () => {
    // The postings route reads this same header to attach match scores. A
    // signed-in user must not be able to trigger a collector pass with it.
    expect(collect({ authorization: 'Bearer some.user.jwt' })).toBe(false);
  });

  it('cannot be satisfied when neither secret is configured', () => {
    const open = authorizedToCollect(
      new Request('https://api.test/v1/collect', {
        headers: { authorization: 'Bearer anything' }
      }),
      { supabaseUrl: 'x', serviceRoleKey: 'y' }
    );
    expect(open).toBe(false);
  });
});
