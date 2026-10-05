/**
 * Build the website's script bundles from npm packages, so the site loads
 * nothing from third-party CDNs:
 *
 *   site/match.js                    resume matcher (src/site/browserMatch.ts)
 *   site/vendor/supabase.js          sign-in and profile storage
 *   site/vendor/resume.js            resume text extraction (PDF, DOCX, text)
 *   site/vendor/pdf.worker.min.mjs   pdf.js's worker, copied as published
 *   site/vendor/leaflet.js, .css     the market data development map, copied as published
 *
 *   npm run build:site
 *
 * All of them are build output (gitignored); site.yml runs this before packaging.
 */
import { copyFile, mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const here = dirname(fileURLToPath(import.meta.url));
const backend = resolve(here, '../..');
const site = resolve(backend, '../site');
const require = createRequire(import.meta.url);

const common = { bundle: true, format: 'esm', target: 'es2020', minify: true, logLevel: 'info', platform: 'browser' } as const;

await build({ ...common, entryPoints: [resolve(backend, 'src/site/browserMatch.ts')], outfile: resolve(site, 'match.js') });
await build({
  ...common,
  entryPoints: {
    supabase: resolve(backend, 'site-entries/supabase.js'),
    resume: resolve(backend, 'site-entries/resume.js')
  },
  outdir: resolve(site, 'vendor')
});

await mkdir(resolve(site, 'vendor'), { recursive: true });
await copyFile(require.resolve('pdfjs-dist/build/pdf.worker.min.mjs'), resolve(site, 'vendor/pdf.worker.min.mjs'));
await copyFile(require.resolve('leaflet/dist/leaflet.js'), resolve(site, 'vendor/leaflet.js'));
await copyFile(require.resolve('leaflet/dist/leaflet.css'), resolve(site, 'vendor/leaflet.css'));
