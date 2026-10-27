import { describe, expect, it } from 'vitest';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { RULES } from '../src/market/devLocation.js';

const run = promisify(execFile);

describe('revalidate:pins between daily exports', () => {
  it('asks nothing and leaves the files alone when no point is due', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'pins-'));
    const file = { asOf: '2026-10-27T00:00:00Z', city: 'Austin', projects: [{ id: 'T1', city: 'Austin', cost: 1, lat: 30.2, lng: -97.7, location: { kind: 'geocoded-address', source: 'x', checked: '2026-10-27', rules: RULES } }] };
    const text = `${JSON.stringify(file)}\n`;
    await writeFile(join(dir, 'austin.json'), text);
    const out = join(dir, 'out.txt');
    await writeFile(out, '');
    // A proxy that refuses everything: any request would fail the check below.
    const { stdout } = await run('npx', ['tsx', 'src/bin/revalidate-pins.ts', '--dir', dir], { env: { ...process.env, GITHUB_OUTPUT: out, HTTPS_PROXY: 'http://127.0.0.1:9', HTTP_PROXY: 'http://127.0.0.1:9' } });
    expect(stdout).toContain('no points due');
    expect(await readFile(out, 'utf8')).toBe('checked=0\nrevalidation_due=0\n');
    expect(await readFile(join(dir, 'austin.json'), 'utf8')).toBe(text);
  }, 60_000);

  it('runs only on builds that reuse the day\'s market data, and keeps the day key', async () => {
    const yml = await readFile(new URL('../../.github/workflows/site.yml', import.meta.url), 'utf8');
    const step = yml.slice(yml.indexOf('- name: Revalidate development pins'), yml.indexOf('- name: Cache revalidated development lists'));
    expect(step).toContain("steps.market-cache.outputs.cache-hit == 'true'");
    expect(step).toContain('npm run --silent revalidate:pins');
    expect(yml).not.toMatch(/revalidation_due != '0'\) && format/);
  });
});
