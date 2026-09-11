/** Local Node server around the shared web handler: `npx tsx src/bin/serve.ts`. */
import { createServer } from 'node:http';
import { configFromEnv, createHandler } from '../api/handler.js';

const port = Number(process.env.PORT ?? 8787);
const handle = createHandler(configFromEnv());

createServer(async (req, res) => {
  const url = `http://${req.headers.host ?? 'localhost'}${req.url ?? '/'}`;
  const body =
    req.method === 'GET' || req.method === 'HEAD' ? undefined : await readBody(req);

  const response = await handle(
    new Request(url, {
      method: req.method,
      headers: req.headers as Record<string, string>,
      body
    })
  );

  res.writeHead(response.status, Object.fromEntries(response.headers));
  res.end(Buffer.from(await response.arrayBuffer()));
}).listen(port, () => console.log(`terra api on http://localhost:${port}`));

async function readBody(req: NodeJS.ReadableStream): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}
