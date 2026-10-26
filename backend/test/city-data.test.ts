import { describe, expect, it } from 'vitest';
import { GROUPS, METRICS, SOURCES } from '../src/market/snapshot.js';
// @ts-expect-error plain JS module shared with the site
import { cityRows, coverage, formatValue, HEADLINE_METRICS, metricSource } from '../../site/market.js';

const snapshot = { metrics: METRICS, groups: GROUPS, sources: SOURCES };
const group = (key: string) => GROUPS.find((g) => g.key === key)!;

describe('city data page rules', () => {
  it('leaves the headline figures out of a topic and lists each metric once', () => {
    const market = { values: Object.fromEntries(METRICS.map((m) => [m.key, 1])), periods: {} };
    const { rows } = cityRows(snapshot, market, { ...group('overview'), metrics: [...group('overview').metrics, 'medianIncome'] });
    const keys = rows.map((r: { metric: { key: string } }) => r.metric.key);
    for (const key of HEADLINE_METRICS) expect(keys).not.toContain(key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('keeps zero as a figure and sets missing ones apart', () => {
    const market = { values: { ozTracts: 0, taxRate: null }, periods: { ozTracts: 'FY2026' } };
    const { rows, missing } = cityRows(snapshot, market, group('taxes'));
    expect(rows.map((r: { metric: { key: string } }) => r.metric.key)).toEqual(['ozTracts']);
    expect(rows[0].period).toBe('FY2026');
    expect(formatValue(0, 'count')).toBe('0');
    expect(missing.map((m: { metric: { key: string } }) => m.metric.key)).toContain('taxRate');
  });

  it('links each metric to its publisher, telling the two HUD lists apart', () => {
    const find = (key: string) => metricSource(snapshot, METRICS.find((m) => m.key === key));
    expect(find('jobsGrowth').name).toMatch(/Labor Statistics/);
    expect(find('pepGrowth').name).toMatch(/Population Estimates/);
    expect(find('populationGrowth').name).toMatch(/American Community Survey/);
    expect(find('fmr1').name).toMatch(/Fair Market/);
    expect(find('ozTracts').name).toMatch(/Opportunity Zones/);
    for (const m of METRICS) expect(metricSource(snapshot, m), m.key).toBeTruthy();
  });

  it('counts the figures a city has', () => {
    expect(coverage({ metrics: METRICS.slice(0, 3) }, { values: { [METRICS[0]!.key]: 0 } })).toEqual({ have: 1, total: 3 });
  });
});
