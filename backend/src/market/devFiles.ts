/**
 * Development data split by market: market.json keeps the headline projects
 * (the biggest per metro, which the career, insights and alert views read),
 * and each market's full list goes in developments/<slug>.json, which the dev
 * map downloads only for the market it opens. The files are also the next
 * build's starting point, so details read on earlier builds are never dropped.
 */
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { City } from '../types.js';
import type { Development, DevelopmentsResult, PageCheckpoint, PageDetails } from './developments.js';

export const DEV_DIR = 'developments';

export interface MarketDevFile {
  asOf: string;
  city: City;
  projects: Development[];
}

export function marketSlug(city: City): string {
  return city.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

/** The previous build's full lists; a market with no file falls back to market.json's projects. */
export async function readMarketFiles(dir: string): Promise<Development[]> {
  const names = await readdir(dir).catch(() => [] as string[]);
  const out: Development[] = [];
  for (const name of names) {
    if (!name.endsWith('.json') || name.startsWith('_')) continue;
    try {
      const file = JSON.parse(await readFile(join(dir, name), 'utf8')) as MarketDevFile;
      if (Array.isArray(file.projects)) out.push(...file.projects);
    } catch {
      // A damaged file only costs its market's carried-over details.
    }
  }
  return out;
}

/** Merge the full lists with market.json's projects, the file's copy winning. */
export function previousProjects(fromFiles: Development[], fromSnapshot: Development[] = []): Development[] {
  const byId = new Map(fromSnapshot.map((p) => [p.id, p]));
  for (const p of fromFiles) byId.set(p.id, p);
  return [...byId.values()];
}

/** Page details saved while a build runs, so one cut short keeps its reads. */
export function fileCheckpoint(path: string): PageCheckpoint & { clear(): Promise<void> } {
  return {
    async load() {
      const raw = JSON.parse(await readFile(path, 'utf8')) as Record<string, PageDetails>;
      return new Map(Object.entries(raw));
    },
    async save(pages) {
      await writeFile(path, JSON.stringify(Object.fromEntries(pages)));
    },
    async clear() {
      await rm(path, { force: true });
    }
  };
}

/** market.json's copy (headline projects plus where each full list lives) and one file per market. */
export function splitDevelopments(result: DevelopmentsResult): { headline: DevelopmentsResult; files: MarketDevFile[] } {
  const byCity = new Map<City, Development[]>();
  for (const p of result.projects) {
    const list = byCity.get(p.city) ?? [];
    list.push(p);
    byCity.set(p.city, list);
  }
  const files: MarketDevFile[] = [...byCity].map(([city, projects]) => ({ asOf: result.asOf, city, projects }));
  const paths: Partial<Record<City, string>> = {};
  for (const f of files) paths[f.city] = `${DEV_DIR}/${marketSlug(f.city)}.json`;
  const headline: DevelopmentsResult = { ...result, projects: result.projects.filter((p) => p.headline), files: paths };
  return { headline, files };
}

export async function writeMarketFiles(dir: string, files: MarketDevFile[]): Promise<void> {
  await mkdir(dir, { recursive: true });
  for (const f of files) await writeFile(join(dir, `${marketSlug(f.city)}.json`), `${JSON.stringify(f)}\n`);
}
