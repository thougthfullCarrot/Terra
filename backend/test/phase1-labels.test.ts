import { describe, expect, it } from 'vitest';
import { compareWarnings, figureSource, isDivision, type Market, type Metric } from '../../site/market.js';
import { LABELS, labelText, stateKind, taxSource } from '../../site/labels.js';

const jobs: Metric = { key: 'jobs', label: 'Jobs', unit: 'count', better: 'high', source: 'BLS', geography: 'metro' };
const rent: Metric = { key: 'rent', label: 'Median rent', unit: 'usd', better: null, source: 'Zillow', geography: 'city' };
const listings: Metric = { key: 'listings', label: 'Active listings', unit: 'count', better: null, source: 'Realtor.com', geography: 'msa' };

const markets: Market[] = [
  { city: 'Austin', metro: 'Austin-Round Rock-San Marcos metro', values: { jobs: 1, rent: 1700, listings: 9 }, periods: { jobs: 'Aug 2026', rent: 'Sep 2026', listings: 'Sep 2026' } },
  { city: 'Dallas', metro: 'Dallas-Plano-Irving metro division', values: { jobs: 2, rent: 1500, listings: 20 }, periods: { jobs: 'Aug 2026', rent: 'Aug 2026', listings: 'Sep 2026' } },
  { city: 'Fort Worth', metro: 'Fort Worth-Arlington-Grapevine metro division', values: { jobs: 3, rent: null, listings: 20 }, periods: { jobs: 'Aug 2026', listings: 'Sep 2026' } },
  {
    city: 'New Braunfels',
    metro: 'San Antonio-New Braunfels metro',
    values: { jobs: 4, rent: 1400, listings: 5 },
    periods: { jobs: 'Aug 2026', rent: 'Sep 2026', listings: 'Sep 2026' },
    shared: { jobs: 'San Antonio' },
    status: { rent: 'retained' }
  }
];

describe('figure source line', () => {
  it('names source, period and area, leaving out what is not on record', () => {
    expect(figureSource(markets[0], jobs)).toBe('BLS · Aug 2026 · metro area');
    expect(figureSource(markets[2], rent)).toBe('Zillow · city limits');
    expect(figureSource({ city: 'X', values: {} }, { key: 'q' })).toBe('');
  });
  it("says when a city repeats another city's metro figure", () => {
    expect(figureSource(markets[3], jobs)).toBe("BLS · Aug 2026 · San Antonio's metro area");
  });
});

describe('comparison warnings', () => {
  it('stays quiet when every compared figure matches', () => {
    expect(compareWarnings(markets, [jobs], ['Dallas', 'Fort Worth'])).toEqual([]);
    expect(compareWarnings(markets, [listings], ['Austin', 'Dallas'])).toEqual([]);
  });
  it('flags different reporting periods with each city named', () => {
    const w = compareWarnings(markets, [rent], ['Austin', 'Dallas']);
    expect(w).toEqual([{ key: 'rent', label: 'Median rent', kind: 'period', text: 'Different reporting periods (Austin: Sep 2026; Dallas: Aug 2026).' }]);
  });
  it('skips cities with no figure instead of inventing one', () => {
    expect(compareWarnings(markets, [rent], ['Dallas', 'Fort Worth'])).toEqual([]);
  });
  it('flags metro divisions mixed with whole metros', () => {
    const w = compareWarnings(markets, [jobs], ['Austin', 'Dallas']);
    expect(w.map((x) => x.kind)).toEqual(['geography']);
    expect(w[0]!.text).toContain('Dallas uses a metro division');
  });
  it('flags a figure repeated from another city and one not refreshed', () => {
    const w = compareWarnings(markets, [jobs, rent], ['Austin', 'New Braunfels']);
    expect(w.some((x) => x.kind === 'geography' && x.text.startsWith('New Braunfels shows the San Antonio figure'))).toBe(true);
    expect(w.some((x) => x.kind === 'stale' && x.text.includes('New Braunfels'))).toBe(true);
  });
  it('notes when Dallas and Fort Worth share one whole-metro figure', () => {
    const w = compareWarnings(markets, [listings], ['Dallas', 'Fort Worth']);
    expect(w[0]!.text).toBe('Dallas and Fort Worth share one whole-metro figure here.');
  });
  it('detects divisions from the metro name', () => {
    expect(isDivision(markets[1])).toBe(true);
    expect(isDivision(markets[0])).toBe(false);
    expect(isDivision(null)).toBe(false);
  });
});

describe('provenance labels', () => {
  it('has exactly the three kinds', () => {
    expect(Object.keys(LABELS)).toEqual(['verified', 'assumption', 'estimate']);
    expect(LABELS.assumption.text).toBe('Your assumption');
  });
  it('never treats an unknown kind as verified', () => {
    expect(labelText('made-up').text).toBe('Estimate');
    expect(labelText('').text).toBe('Estimate');
  });
  it('adds the source to the hint', () => {
    expect(labelText('verified', 'appraisal district roll').hint).toContain('Source: appraisal district roll.');
  });
  it('names the tax rate source and the city period', () => {
    const snap = { metrics: [{ key: 'taxRate', source: 'Texas Comptroller' }], markets: [{ city: 'Dallas', periods: { taxRate: '2025' } }] };
    expect(taxSource(snap, 'Dallas')).toBe('Texas Comptroller, 2025 (typical property inside the city)');
    expect(taxSource(null, 'Dallas')).toBe('Texas Comptroller (typical property inside the city)');
  });
});

describe('section states', () => {
  it('maps the older error flag and unknown values', () => {
    expect(stateKind(true)).toBe('error');
    expect(stateKind(false)).toBe('empty');
    expect(stateKind('loading')).toBe('loading');
    expect(stateKind('weird')).toBe('empty');
  });
});
