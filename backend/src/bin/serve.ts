/** Local Node server around the shared web handler: `npx tsx src/bin/serve.ts`. */
import { createServer } from 'node:http';
import { configFromEnv, createHandler } from '../api/handler.js';
import { toNodeHandler } from '../lib/node-adapter.js';

const port = Number(process.env.PORT ?? 8787);

createServer(toNodeHandler(createHandler(configFromEnv()))).listen(port, () =>
  console.log(`terra api on http://localhost:${port}`)
);
