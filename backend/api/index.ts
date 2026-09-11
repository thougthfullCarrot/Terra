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
 * Built on first request rather than at module load. A missing environment
 * variable then answers with a readable JSON error instead of crashing the
 * cold start into an opaque 500.
 */
export default async function vercelHandler(
  req: IncomingMessage,
  res: ServerResponse
): Promise<void> {
  try {
    handler ??= toNodeHandler(createHandler(configFromEnv()));
  } catch (error) {
    res.statusCode = 500;
    res.setHeader('content-type', 'application/json; charset=utf-8');
    res.end(
      JSON.stringify({
        error: error instanceof Error ? error.message : 'configuration error'
      })
    );
    return;
  }

  await handler(req, res);
}
