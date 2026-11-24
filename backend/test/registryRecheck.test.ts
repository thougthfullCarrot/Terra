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
});
