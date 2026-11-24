import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dueEmployers, type Registry } from '../src/bin/registry-recheck.js';

const registry = JSON.parse(readFileSync(new URL('../data/employer-registry.json', import.meta.url), 'utf8')) as Registry;
const now = new Date('2026-12-01T00:00:00Z');
const daysAgo = (d: number) => new Date(now.getTime() - d * 86_400_000).toISOString();

describe('employer registry recheck schedule', () => {
  it('holds the verified quiet and unsupported employers, each with a board or platform', () => {
    const quiet = registry.employers.filter((e) => e.status === 'quiet');
    expect(quiet.length).toBe(17);
    for (const e of quiet) expect(e.slug && e.careersUrl).toBeTruthy();
    expect(registry.employers.filter((e) => e.status === 'unsupported').length).toBeGreaterThan(0);
  });

  it('reads never-checked employers first, up to the limit, and never the unsupported ones', () => {
    const due = dueEmployers(registry, {}, now, 5);
    expect(due).toHaveLength(5);
    expect(due.every((e) => e.status === 'quiet')).toBe(true);
  });

  it('skips employers checked within recheckDays', () => {
    const state = Object.fromEntries(registry.employers.map((e) => [e.name, { lastChecked: daysAgo(3), fetched: 0, published: 0 }]));
    expect(dueEmployers(registry, state, now, 50)).toEqual([]);
  });

  it('always reads employers past maxDays, even beyond the limit', () => {
    const state = Object.fromEntries(registry.employers.map((e) => [e.name, { lastChecked: daysAgo(15), fetched: 0, published: 0 }]));
    expect(dueEmployers(registry, state, now, 2)).toHaveLength(17);
  });

  it('--all forces a recheck of every readable quiet employer, even ones just checked', () => {
    const state = Object.fromEntries(registry.employers.map((e) => [e.name, { lastChecked: daysAgo(0), fetched: 0, published: 0 }]));
    expect(dueEmployers(registry, state, now, 12, true)).toHaveLength(17);
  });

  it('processes every employer within maxDays when each run reads only 2', () => {
    const state: Record<string, { lastChecked: string; fetched: number; published: number }> = {};
    const start = new Date('2026-11-21T00:00:00Z').getTime();
    const gaps: number[] = [];
    // One run a day for 60 days, reading at most 2 due employers per run.
    for (let day = 0; day <= 60; day++) {
      const at = new Date(start + day * 86_400_000);
      for (const e of dueEmployers(registry, state, at, 2)) {
        const last = Date.parse(state[e.name]?.lastChecked ?? e.verifiedAt);
        gaps.push((at.getTime() - last) / 86_400_000);
        state[e.name] = { lastChecked: at.toISOString(), fetched: 0, published: 0 };
      }
    }
    const quiet = registry.employers.filter((e) => e.status === 'quiet');
    for (const e of quiet) expect(state[e.name]).toBeTruthy();
    expect(Math.max(...gaps)).toBeLessThanOrEqual(registry.maxDays + 1);
  });
});
