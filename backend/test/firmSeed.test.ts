import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { parseFirmSeed, SEED_PATHS } from '../src/collector/firmSeed.js';
import { parseFirmCandidates } from '../src/collector/firmCandidates.js';

const seedPath = new URL('../supabase/migrations/0002_seed_firms.sql', import.meta.url);
const candidatesPath = new URL('../data/firm-candidates.txt', import.meta.url);

describe('the seed migration', () => {
  it('contains only firms whose board was verified', async () => {
    const sql = (await Promise.all(SEED_PATHS.map((path) => readFile(path, 'utf8')))).join('\n');
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

  it('keeps ats_host, which the Workday fetcher cannot run without', async () => {
    // Dropping this column is not a cosmetic loss: parseTenant throws without
    // it, so the fetcher never issues a request and the firm reports as
    // unreachable when its board is fine.
    const firms = parseFirmSeed(await readFile(seedPath, 'utf8'));
    const workday = firms.filter((firm) => firm.ats === 'workday');

    expect(workday.length).toBeGreaterThan(0);
    for (const firm of workday) {
      expect(firm.atsHost).toBeTruthy();
      expect(firm.atsSlug).toContain('/');
    }
  });

  it('reads each column by name rather than by position', () => {
    // The same three fields in a different order must parse identically.
    const a = parseFirmSeed(
      "insert into firms (name, ats, ats_slug) values ('A', 'lever', 'a');"
    )[0];
    const b = parseFirmSeed(
      "insert into firms (ats_slug, name, ats) values ('a', 'A', 'lever');"
    )[0];
    expect({ ...a, id: 0 }).toEqual({ ...b, id: 0 });
  });

  it('defaults active to true and slug_verified to false when omitted', () => {
    const firm = parseFirmSeed(
      "insert into firms (name, ats, ats_slug) values ('A', 'lever', 'a');"
    )[0];
    expect(firm?.active).toBe(true);
    expect(firm?.slugVerified).toBe(false);
  });

  it('reads boolean and null columns', () => {
    const firm = parseFirmSeed(
      "insert into firms (name, ats, ats_slug, ats_host, slug_verified, active) values " +
        "('A', 'workday', 'a/b', 'a.wd1.myworkdayjobs.com', true, false);"
    )[0];
    expect(firm).toMatchObject({
      atsHost: 'a.wd1.myworkdayjobs.com',
      slugVerified: true,
      active: false
    });
  });

  it('handles a comma and an escaped quote inside a firm name', () => {
    const firm = parseFirmSeed(
      "insert into firms (name, ats, ats_slug) values ('O''Connor \u0026 Associates, Inc.', 'lever', 'oc');"
    )[0];
    expect(firm?.name).toBe("O'Connor & Associates, Inc.");
    expect(firm?.atsSlug).toBe('oc');
  });

  it('ignores a trailing comment on a values row', () => {
    const firms = parseFirmSeed(
      [
        'insert into firms (name, ats, ats_slug) values',
        "  ('A', 'greenhouse', 'a'),  -- https://example.com/board",
        "  ('B', 'lever', 'b');"
      ].join('\n')
    );
    expect(firms.map((f) => f.name)).toEqual(['A', 'B']);
  });

  it('ignores commented-out url examples above the insert', () => {
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
