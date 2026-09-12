import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { FeedReader } from './feed.js';
import { SupabaseStore } from '../db/supabase.js';
import { runCollector } from '../collector/run.js';
import { ExpoNotifier } from '../notify/expo.js';

export interface HandlerConfig {
  supabaseUrl: string;
  serviceRoleKey: string;
  /** Shared secret pg_cron sends as x-collector-secret on POST /v1/collect. */
  collectorSecret?: string;
  /**
   * Vercel Cron's secret. It fires a GET with `Authorization: Bearer <secret>`
   * and no custom headers, so it cannot use collectorSecret's scheme.
   */
  cronSecret?: string;
  expoAccessToken?: string;
  /**
   * The git commit this build came from, reported by `/health`. Vercel sets
   * VERCEL_GIT_COMMIT_SHA automatically. Without it a health check cannot tell
   * a new deployment from the previous one still being served while the new
   * build runs.
   */
  commit?: string;
}

export function configFromEnv(env: Record<string, string | undefined> = process.env): HandlerConfig {
  const supabaseUrl = env.SUPABASE_URL;
  const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set');
  }
  return {
    supabaseUrl,
    serviceRoleKey,
    collectorSecret: env.COLLECTOR_SECRET,
    cronSecret: env.CRON_SECRET,
    expoAccessToken: env.EXPO_ACCESS_TOKEN,
    commit: env.VERCEL_GIT_COMMIT_SHA ?? env.GIT_COMMIT_SHA
  };
}

/**
 * The whole API surface, as a web-standard `(Request) => Response`. That keeps
 * it runnable on Node, Deno, Bun, Vercel, or a Supabase Edge Function without
 * a per-host rewrite.
 *
 *   GET  /v1/postings?state=TX&city=Austin&level=intern,entry
 *   GET  /v1/markets
 *   POST /v1/collect          (scheduler only, x-collector-secret)
 *
 * The postings route reads the caller's Supabase JWT to attach their match
 * scores. Without one it still serves postings, just unscored — the feed is
 * public, the scoring is personal.
 */
export function createHandler(config: HandlerConfig): (request: Request) => Promise<Response> {
  const service = createClient(config.supabaseUrl, config.serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false }
  });
  const reader = new FeedReader(service);

  return async function handle(request: Request): Promise<Response> {
    const url = new URL(request.url);

    try {
      if (request.method === 'GET' && url.pathname === '/v1/postings') {
        const profileId = await resolveProfile(service, request);
        const feed = await reader.getFeed({
          state: url.searchParams.get('state') ?? 'TX',
          city: url.searchParams.get('city') ?? undefined,
          kind: parseLevel(url.searchParams.get('level')),
          profileId
        });
        return json(feed);
      }

      if (request.method === 'GET' && url.pathname === '/v1/markets') {
        return json(await reader.getMarkets());
      }

      if (url.pathname === '/v1/collect' && (request.method === 'POST' || request.method === 'GET')) {
        if (!config.collectorSecret && !config.cronSecret) {
          return json({ error: 'collector disabled: no COLLECTOR_SECRET or CRON_SECRET set' }, 503);
        }
        if (!authorizedToCollect(request, config)) {
          return json({ error: 'forbidden' }, 403);
        }
        const report = await runCollector({
          store: new SupabaseStore(service),
          notifier: new ExpoNotifier({ accessToken: config.expoAccessToken })
        });
        return json(report);
      }

      if (request.method === 'GET' && url.pathname === '/health') {
        return json({
          ok: true,
          configured: true,
          commit: config.commit ?? null
        });
      }

      return json({ error: 'not found' }, 404);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'unknown error';
      // The client renders this string in the error card, so keep it readable.
      return json({ error: message }, 500);
    }
  };
}

/**
 * Two schedulers, two auth schemes. pg_cron POSTs with a custom header;
 * Vercel Cron GETs with a bearer token and no way to add one. Either proves
 * the caller is the scheduler.
 */
export function authorizedToCollect(request: Request, config: HandlerConfig): boolean {
  if (
    config.collectorSecret &&
    request.headers.get('x-collector-secret') === config.collectorSecret
  ) {
    return true;
  }

  const bearer = request.headers.get('authorization')?.match(/^Bearer\s+(.+)$/i)?.[1];
  return Boolean(config.cronSecret && bearer === config.cronSecret);
}

/** 'intern,entry' -> undefined (both), 'intern' -> Internship, 'entry' -> Entry-level. */
function parseLevel(value: string | null): 'Internship' | 'Entry-level' | undefined {
  if (!value) return undefined;
  const levels = value
    .split(',')
    .map((part) => part.trim().toLowerCase())
    .filter(Boolean);
  if (levels.length !== 1) return undefined;
  if (levels[0]?.startsWith('intern')) return 'Internship';
  if (levels[0]?.startsWith('entry')) return 'Entry-level';
  return undefined;
}

async function resolveProfile(db: SupabaseClient, request: Request): Promise<string | null> {
  const header = request.headers.get('authorization');
  const token = header?.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!token) return null;

  const { data, error } = await db.auth.getUser(token);
  if (error || !data.user) return null;
  return data.user.id;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': status === 200 ? 'public, max-age=60' : 'no-store'
    }
  });
}
