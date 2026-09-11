/**
 * Vercel entry point. Every route is served by one function: `vercel.json`
 * rewrites all paths here and the handler does its own routing, so the API
 * stays a single portable unit rather than a folder of per-route files.
 *
 * Set the project's Root Directory to `backend` in the Vercel dashboard.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { configFromEnv, createHandler } from '../src/api/handler.js';
import { toNodeHandler, type NodeHandler } from '../src/lib/node-adapter.js';

let handler: NodeHandler | null = null;

/**
 * Built on first request rather than at module load, so a missing environment
 * variable answers with a readable error instead of crashing the cold start
 * into an opaque 500.
 *
 * `/health` is answered even when the configuration is incomplete. Deploying
 * before the Supabase project exists is the normal order of operations, and a
 * health check that 500s then would read as a broken deployment rather than an
 * unconfigured one — so it reports which variables are missing instead.
 */
export default async function vercelHandler(
  req: IncomingMessage,
  res: ServerResponse
): Promise<void> {
  try {
    handler ??= toNodeHandler(createHandler(configFromEnv()));
  } catch (error) {
    const message = error instanceof Error ? error.message : 'configuration error';
    const health = req.url?.split('?')[0] === '/health';

    return send(res, health ? 200 : 503, {
      ok: health ? true : undefined,
      deployed: true,
      configured: false,
      error: message
    });
  }

  await handler(req, res);
}

function send(res: ServerResponse, status: number, body: Record<string, unknown>): void {
  res.statusCode = status;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.setHeader('cache-control', 'no-store');
  res.end(JSON.stringify(body));
}
