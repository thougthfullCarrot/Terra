import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createServer, type Server } from 'node:http';

/**
 * The Vercel entry point, exercised the way Vercel calls it. These assert the
 * unconfigured case specifically: deploying before the Supabase project exists
 * is the normal order of operations, and the health check has to stay readable
 * through it.
 */
const SUPABASE_KEYS = ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY'] as const;

let server: Server;
let base: string;
let saved: Record<string, string | undefined>;

async function startWith(env: Record<string, string | undefined>): Promise<void> {
  saved = Object.fromEntries(SUPABASE_KEYS.map((key) => [key, process.env[key]]));
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }

  // The entry caches its handler at module scope, so each case needs it fresh.
  vi.resetModules();
  const { default: handler } = await import('../api/index.js');

  server = createServer((req, res) => void handler(req, res));
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  base = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}`;
}

afterEach(async () => {
  for (const [key, value] of Object.entries(saved ?? {})) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  if (server) {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve()))
    );
  }
});

describe('an unconfigured deployment', () => {
  beforeEach(async () => {
    await startWith({ SUPABASE_URL: undefined, SUPABASE_SERVICE_ROLE_KEY: undefined });
  });

  it('still answers the health check, so the deploy can be verified', async () => {
    const response = await fetch(`${base}/health`);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      deployed: true,
      configured: false
    });
  });

  it('names the missing variables rather than failing opaquely', async () => {
    const body = (await (await fetch(`${base}/health`)).json()) as { error: string };
    expect(body.error).toContain('SUPABASE_URL');
    expect(body.error).toContain('SUPABASE_SERVICE_ROLE_KEY');
  });

  it('refuses real routes with 503, not a misleading 200', async () => {
    const response = await fetch(`${base}/v1/postings`);

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({ configured: false });
  });

  it('does not run a collector pass while unconfigured', async () => {
    const response = await fetch(`${base}/v1/collect`, { method: 'POST' });
    expect(response.status).toBe(503);
  });

  it('reports health on a request carrying a query string', async () => {
    // Vercel's rewrite can append one; the path check must not be confused.
    expect((await fetch(`${base}/health?from=vercel`)).status).toBe(200);
  });
});

describe('a configured deployment', () => {
  beforeEach(async () => {
    await startWith({
      SUPABASE_URL: 'https://example.supabase.co',
      SUPABASE_SERVICE_ROLE_KEY: 'service-role-key'
    });
  });

  it('hands the request to the real handler', async () => {
    const response = await fetch(`${base}/health`);

    expect(response.status).toBe(200);
    // The real handler's health payload, not the unconfigured stand-in.
    await expect(response.json()).resolves.toEqual({ ok: true });
  });
});
