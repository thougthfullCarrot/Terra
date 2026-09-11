import type { IncomingMessage, ServerResponse } from 'node:http';

export type WebHandler = (request: Request) => Promise<Response>;
export type NodeHandler = (req: IncomingMessage, res: ServerResponse) => Promise<void>;

/**
 * Run a web-standard `(Request) => Response` handler on a Node server.
 *
 * Vercel's Node runtime, and `node:http` locally, both speak
 * IncomingMessage/ServerResponse. Keeping the adapter separate means the
 * handler itself stays portable — the same function serves Vercel, a local
 * server, and a Supabase Edge Function with no per-host branching.
 *
 * The Node runtime is deliberate rather than Edge: the collector hashes
 * posting ids with `node:crypto`, which the Edge runtime does not provide.
 */
export function toNodeHandler(handle: WebHandler): NodeHandler {
  return async function nodeHandler(req, res) {
    try {
      const response = await handle(await toRequest(req));

      res.statusCode = response.status;
      response.headers.forEach((value, key) => res.setHeader(key, value));
      res.end(Buffer.from(await response.arrayBuffer()));
    } catch (error) {
      // A throw here is a bug in the adapter, not a handled API error — the
      // handler catches its own. Still, never leave the socket hanging.
      res.statusCode = 500;
      res.setHeader('content-type', 'application/json; charset=utf-8');
      res.end(
        JSON.stringify({ error: error instanceof Error ? error.message : 'unknown error' })
      );
    }
  };
}

async function toRequest(req: IncomingMessage): Promise<Request> {
  const proto = header(req, 'x-forwarded-proto') ?? 'https';
  const host = header(req, 'x-forwarded-host') ?? header(req, 'host') ?? 'localhost';
  const url = new URL(req.url ?? '/', `${proto}://${host}`);

  const method = req.method ?? 'GET';
  const hasBody = method !== 'GET' && method !== 'HEAD';

  return new Request(url, {
    method,
    headers: toHeaders(req),
    body: hasBody ? await readBody(req) : undefined
  });
}

function toHeaders(req: IncomingMessage): Headers {
  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (value === undefined) continue;
    // Node gives repeated headers as an array; Headers wants them appended.
    if (Array.isArray(value)) for (const item of value) headers.append(key, item);
    else headers.set(key, value);
  }
  return headers;
}

function header(req: IncomingMessage, name: string): string | undefined {
  const value = req.headers[name];
  return Array.isArray(value) ? value[0] : value;
}

async function readBody(req: IncomingMessage): Promise<Buffer | undefined> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(Buffer.from(chunk));
  return chunks.length ? Buffer.concat(chunks) : undefined;
}
