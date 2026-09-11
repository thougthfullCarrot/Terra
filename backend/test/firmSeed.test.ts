import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { parseFirmSeed } from '../src/collector/firmSeed.js';

describe('parseFirmSeed', () => {
  it('reads the shipped seed migration', async () => {
    const sql = await readFile(
      new URL('../supabase/migrations/0002_seed_firms.sql', import.meta.url),
      'utf8'
    );
    const firms = parseFirmSeed(sql);

    // The spec calls for 30 firms to start; coverage is the whole game.
    expect(firms).toHaveLength(30);
    expect(firms.every((firm) => firm.name && firm.atsSlug)).toBe(true);
    expect(new Set(firms.map((firm) => firm.name)).size).toBe(30);
    expect(firms[0]).toMatchObject({ name: 'CBRE', ats: 'greenhouse', atsSlug: 'cbre' });
    expect(firms.some((firm) => firm.ats === 'lever')).toBe(true);
  });

  it('ignores the commented-out url examples above the insert', () => {
    const sql = [
      "-- https://boards-api.greenhouse.io/v1/boards/<slug>/jobs",
      "insert into firms (name, ats, ats_slug) values",
      "  ('CBRE', 'greenhouse', 'cbre');"
    ].join('\n');
    expect(parseFirmSeed(sql)).toHaveLength(1);
  });

  it('unescapes doubled quotes in firm names', () => {
    const sql = "insert into firms values ('O''Connor & Associates', 'lever', 'oconnor');";
    expect(parseFirmSeed(sql)[0]?.name).toBe("O'Connor & Associates");
  });

  it('returns nothing for SQL with no firm rows', () => {
    expect(parseFirmSeed('select 1;')).toEqual([]);
  });
});
