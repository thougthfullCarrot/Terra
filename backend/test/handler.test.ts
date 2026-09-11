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
    await expect(response.json()).resolves.toEqual({ ok: true });
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
});
