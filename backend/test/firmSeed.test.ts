import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { parseFirmSeed } from '../src/collector/firmSeed.js';
import { parseFirmCandidates } from '../src/collector/firmCandidates.js';

const seedPath = new URL('../supabase/migrations/0002_seed_firms.sql', import.meta.url);
const candidatesPath = new URL('../data/firm-candidates.txt', import.meta.url);

describe('the seed migration', () => {
  it('contains only firms whose board was verified', async () => {
    const sql = await readFile(seedPath, 'utf8');
    const firms = parseFirmSeed(sql);

    expect(firms.length).toBeGreaterThan(0);

    // The rule this file exists to enforce: a firm reaches the database only
    // after the probe confirms its board. An unverified row must be inactive,
    // so the collector never polls something nobody has checked.
    for (const firm of firms) {
      const row = new RegExp(`'${firm.name.replace(/'/g, "''")}'[^)]*\\)`).exec(sql)?.[0] ?? '';
      const verified = /true/.test(row.split(',').slice(3).join(','));
      const inactive = /,\s*false\s*\)/.test(row);
      expect(verified || inactive).toBe(true);
    }
  });

  it('parses rows that carry trailing columns', async () => {
    const firms = parseFirmSeed(await readFile(seedPath, 'utf8'));
    expect(firms.some((firm) => firm.name === 'Lincoln Property Company')).toBe(true);
  });

  it('unescapes doubled quotes in firm names', () => {
    const sql = "insert into firms values ('O''Connor & Associates', 'lever', 'oconnor');";
    expect(parseFirmSeed(sql)[0]?.name).toBe("O'Connor & Associates");
  });

  it('ignores the commented-out url examples above the insert', () => {
    const sql = [
      '-- https://boards-api.greenhouse.io/v1/boards/<slug>/jobs',
      'insert into firms (name, ats, ats_slug) values',
      "  ('CBRE', 'greenhouse', 'cbre');"
    ].join('\n');
    expect(parseFirmSeed(sql)).toHaveLength(1);
  });

  it('returns nothing for SQL with no firm rows', () => {
    expect(parseFirmSeed('select 1;')).toEqual([]);
  });
});

describe('the candidate list', () => {
  it('carries enough names for a probe run to be worth doing', async () => {
    const names = parseFirmCandidates(await readFile(candidatesPath, 'utf8'));
    // Coverage beats precision here: candidates are free to be wrong, and a
    // short list is the one thing the probe cannot compensate for.
    expect(names.length).toBeGreaterThan(50);
  });

  it('drops comments, blank lines and duplicates', () => {
    const names = parseFirmCandidates(
      ['# a heading', '', 'Boxer Property', 'Boxer Property', '  Griffin Partners  ', '# end'].join('\n')
    );
    expect(names).toEqual(['Boxer Property', 'Griffin Partners']);
  });

  it('strips a trailing comment from a name', () => {
    expect(parseFirmCandidates('Hines # Houston')).toEqual(['Hines']);
  });

  it('keeps the seed and the candidates separate', async () => {
    // A firm that has been verified should not still be sitting in the
    // unverified pile, or the probe re-checks what is already settled.
    const seeded = parseFirmSeed(await readFile(seedPath, 'utf8')).map((f) => f.name.toLowerCase());
    const candidates = parseFirmCandidates(await readFile(candidatesPath, 'utf8')).map((n) =>
      n.toLowerCase()
    );
    expect(candidates.filter((name) => seeded.includes(name))).toEqual([]);
  });
});
