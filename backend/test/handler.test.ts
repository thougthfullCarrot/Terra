import { describe, expect, it } from 'vitest';
import { configFromEnv, createHandler } from '../src/api/handler.js';

const handle = createHandler({
  supabaseUrl: 'https://example.supabase.co',
  serviceRoleKey: 'service-role-key',
  collectorSecret: 'shh'
});

describe('createHandler', () => {
  it('answers the health check', async () => {
    const response = await handle(new Request('https://api.test/health'));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ ok: true, configured: true });
  });

  it('reports the build commit, so a check can tell deployments apart', async () => {
    const withCommit = createHandler({
      supabaseUrl: 'https://example.supabase.co',
      serviceRoleKey: 'service-role-key',
      commit: 'abc123'
    });
    const body = await (await withCommit(new Request('https://api.test/health'))).json();
    expect(body).toMatchObject({ ok: true, commit: 'abc123' });
  });

  it('reports a null commit rather than omitting the field', async () => {
    // A missing key and an unknown commit are different states; the health
    // check distinguishes them.
    const body = (await (await handle(new Request('https://api.test/health'))).json()) as {
      commit: unknown;
    };
    expect(body.commit).toBeNull();
  });

  it('404s an unknown route', async () => {
    const response = await handle(new Request('https://api.test/v1/nope'));
    expect(response.status).toBe(404);
  });

  it('rejects a collect call without the shared secret', async () => {
    const response = await handle(
      new Request('https://api.test/v1/collect', { method: 'POST' })
    );
    expect(response.status).toBe(403);
  });

  it('rejects a collect call with the wrong secret', async () => {
    const response = await handle(
      new Request('https://api.test/v1/collect', {
        method: 'POST',
        headers: { 'x-collector-secret': 'wrong' }
      })
    );
    expect(response.status).toBe(403);
  });

  it('reports a configuration problem rather than pretending to collect', async () => {
    const unconfigured = createHandler({
      supabaseUrl: 'https://example.supabase.co',
      serviceRoleKey: 'service-role-key'
    });
    const response = await unconfigured(
      new Request('https://api.test/v1/collect', { method: 'POST' })
    );
    expect(response.status).toBe(503);
  });

  it('refuses a state other than TX, since the app is Texas only', async () => {
    const response = await handle(new Request('https://api.test/v1/postings?state=CA'));
    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toMatchObject({ error: expect.stringContaining('TX') });
  });
});

describe('configFromEnv', () => {
  it('requires the Supabase credentials', () => {
    expect(() => configFromEnv({})).toThrow(/SUPABASE_URL/);
  });

  it('reads the optional secrets', () => {
    const config = configFromEnv({
      SUPABASE_URL: 'https://example.supabase.co',
      SUPABASE_SERVICE_ROLE_KEY: 'key',
      COLLECTOR_SECRET: 'shh',
      EXPO_ACCESS_TOKEN: 'expo'
    });
    expect(config.collectorSecret).toBe('shh');
    expect(config.expoAccessToken).toBe('expo');
  });

  it("picks up Vercel's commit sha", () => {
    const config = configFromEnv({
      SUPABASE_URL: 'https://example.supabase.co',
      SUPABASE_SERVICE_ROLE_KEY: 'key',
      VERCEL_GIT_COMMIT_SHA: '166e79a4ad12fc715d81cbb62f7ac2729b0b7684'
    });
    expect(config.commit).toBe('166e79a4ad12fc715d81cbb62f7ac2729b0b7684');
  });
});
