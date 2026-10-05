import { describe, expect, it } from 'vitest';
import { classifySector } from '../src/collector/sector.js';
import { DEFAULT_QUERIES, isRealEstate } from '../src/collector/sources/adzuna.js';

describe('Affordable Housing sector', () => {
  it('files subsidized-housing roles', () => {
    expect(classifySector('LIHTC Compliance Analyst').sector).toBe('Affordable Housing');
    expect(classifySector('Compliance Specialist', 'Income certifications for tax credit and HUD properties.').sector).toBe('Affordable Housing');
    expect(classifySector('Affordable Housing Development Associate', 'LIHTC developer.').sector).toBe('Affordable Housing');
    expect(classifySector('Housing Authority Intern').sector).toBe('Affordable Housing');
    expect(classifySector('Community Development Analyst', 'Affordable housing lending.').sector).toBe('Affordable Housing');
  });

  it('leaves ordinary jobs where they were', () => {
    expect(classifySector('Compliance Specialist', 'SEC fund compliance.').sector).not.toBe('Affordable Housing');
    expect(classifySector('Acquisitions Analyst', 'Underwriting multifamily acquisitions.').sector).toBe('Investment');
    expect(classifySector('Development Analyst', 'Ground-up office development and entitlements.').sector).toBe('Development');
    expect(classifySector('Property Manager', 'Class A office property management.').sector).toBe('Property Mgmt');
    expect(classifySector('Community Development Manager', 'Master-planned community, construction.').sector).toBe('Development');
  });

  it('searches and accepts affordable housing on Adzuna', () => {
    expect(DEFAULT_QUERIES.some((q) => /LIHTC/.test(q.what_or ?? ''))).toBe(true);
    expect(isRealEstate('Compliance Specialist', 'LIHTC portfolio')).toBe(true);
  });
});

import { affordableSearchUrl, buildNewsFile, mergeAffordable, topicsFor, type RssItem } from '../src/news/googleNews.js';

describe('Affordable housing news', () => {
  const now = new Date('2026-10-05T12:00:00Z');
  const item = (title: string, link: string): RssItem => ({ title, link, source: 'Paper', sourceUrl: null, publishedAt: '2026-10-04T12:00:00Z' });

  it('searches affordable housing per city', () => {
    const q = new URL(affordableSearchUrl('Houston')).searchParams.get('q')!;
    expect(q).toContain('"Houston"');
    expect(q).toContain('LIHTC');
  });

  it('tags affordable headlines', () => {
    expect(topicsFor('Houston Housing Authority approves 300 affordable apartments')).toContain('Affordable housing');
    expect(topicsFor('LIHTC deal closes in San Antonio')).toContain('Affordable housing');
    expect(topicsFor('Film tax credits expand in Texas')).not.toContain('Affordable housing');
  });

  it('adds affordable stories without duplicates', () => {
    const merged = mergeAffordable([], [item('Dallas approves affordable housing tower', 'https://a/1'), item('Mavericks win', 'https://a/2')], now);
    expect(merged.map((h) => h.url)).toEqual(['https://a/1']);
  });

  it('puts the topic in the news file', async () => {
    const file = await buildNewsFile(now, null, {
      fetchCity: async () => [],
      fetchAffordable: async (city) => (city === 'Austin' ? [item('Austin breaks ground on LIHTC apartments', 'https://a/3')] : []),
      fetchShared: async () => [],
      log: () => {}
    });
    expect(file.topics).toContain('Affordable housing');
    expect(file.cities.find((c) => c.city === 'Austin')!.headlines[0]!.topics).toContain('Affordable housing');
  });
});

import { parseAcs, rentBurdened, rentSeverelyBurdened } from '../src/market/census.js';
import { GROUPS, METRICS } from '../src/market/snapshot.js';

describe('Affordable housing market data', () => {
  it('computes renter cost burden from B25070', () => {
    const header = ['NAME', 'B25070_001E', 'B25070_007E', 'B25070_008E', 'B25070_009E', 'B25070_010E', 'B25070_011E', 'metropolitan statistical area/micropolitan statistical area'];
    const row = parseAcs([header, ['Houston', '1050', '100', '100', '100', '200', '50', '26420']]).get('26420');
    expect(rentBurdened(row)).toBeCloseTo(50);
    expect(rentSeverelyBurdened(row)).toBeCloseTo(20);
    expect(rentBurdened(parseAcs([header.slice(0, 2).concat(header[7]!), ['x', '10', '26420']]).get('26420'))).toBeNull();
  });

  it('lists an affordable housing group whose metrics all exist', () => {
    const group = GROUPS.find((g) => g.key === 'affordable')!;
    expect(group.label).toBe('Affordable housing');
    for (const key of group.metrics) expect(METRICS.some((m) => m.key === key), key).toBe(true);
  });
});
