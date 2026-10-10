import { describe, expect, it } from 'vitest';
import { redact } from '../src/lib/redact.js';
import { METROS } from '../src/market/metros.js';
import { outcomeLog } from '../src/market/outcomes.js';
import { parsePermitFile } from '../src/market/permits.js';
import {
  blsSeriesFor,
  buildMarketSnapshot,
  fillFromPrevious,
  GROUPS,
  laggingSources,
  METRICS,
  periodEnd,
  SOURCE_RULES,
  type MarketSnapshot
} from '../src/market/snapshot.js';
import { cesSeries, type Point } from '../src/market/bls.js';
import type { RedfinReading } from '../src/market/redfin.js';
import type { ZillowResult } from '../src/market/zillow.js';
import {
  CATEGORY_LABELS,
  GEOGRAPHY_LABELS,
  rankedCount,
  ranks,
  retainedCount,
  sharedWith,
  valueNotes,
  valueStatus
} from '../../site/market.js';

const cities = METROS.map((m) => m.city);
const zillow = (dallas: number, period = 'Jul 2026'): ZillowResult => ({
  homeValue: new Map([['Dallas', { value: dallas, yearAgo: dallas * 0.97, period }]]),
  rent: new Map()
});
const at = (iso: string) => new Date(iso);
const dallas = (snap: MarketSnapshot) => snap.markets.find((m) => m.city === 'Dallas')!;
const metric = (key: string) => METRICS.find((m) => m.key === key)!;

describe('retained figures', () => {
  const first = buildMarketSnapshot(METROS, null, null, at('2026-08-01T06:00:00Z'), { zillow: zillow(300_000) });

  it('marks a figure read on this build fresh, with the build time', () => {
    expect(dallas(first).status?.zhvi).toBe('fresh');
    expect(dallas(first).fetchedAt?.zhvi).toBe('2026-08-01T06:00:00.000Z');
    expect(dallas(first).status?.zori).toBe('missing');
    expect(first.schemaVersion).toBe(2);
  });

  it('keeps the original period and fetch time when the source does not answer', () => {
    const next = buildMarketSnapshot(METROS, null, null, at('2026-09-01T06:00:00Z'), {});
    const filled = fillFromPrevious(next, first);
    expect(dallas(filled).values.zhvi).toBe(300_000);
    expect(dallas(filled).periods.zhvi).toBe('Jul 2026');
    expect(dallas(filled).fetchedAt?.zhvi).toBe('2026-08-01T06:00:00.000Z');
    expect(dallas(filled).status?.zhvi).toBe('retained');
    expect(filled.generatedAt).toBe('2026-09-01T06:00:00.000Z');
  });

  it('shows a kept figure as not refreshed on the page', () => {
    const filled = fillFromPrevious(buildMarketSnapshot(METROS, null, null, at('2026-09-01T06:00:00Z'), {}), first);
    expect(valueStatus(dallas(filled), 'zhvi')).toBe('retained');
    expect(valueNotes(dallas(filled), metric('zhvi')).join(' | ')).toContain('Not refreshed: kept from an earlier update (read Aug 1, 2026)');
    expect(valueNotes(dallas(filled), metric('zhvi'))[0]).toBe('Jul 2026');
    expect(retainedCount(filled)).toBeGreaterThan(0);
    expect(valueNotes(dallas(first), metric('zhvi')).join(' | ')).not.toContain('Not refreshed');
  });
});

describe('expiry', () => {
  const first = buildMarketSnapshot(METROS, null, null, at('2026-01-01T00:00:00Z'), { zillow: zillow(300_000) });

  it('drops a figure once its source has gone unread past its maximum age, and says so', () => {
    const late = at('2026-01-01T00:00:00Z');
    late.setUTCDate(late.getUTCDate() + SOURCE_RULES.Zillow.maxAgeDays + 1);
    const filled = fillFromPrevious(buildMarketSnapshot(METROS, null, null, late, {}), first);
    expect(dallas(filled).values.zhvi).toBeNull();
    expect(dallas(filled).status?.zhvi).toBe('expired');
    expect(dallas(filled).fetchedAt?.zhvi).toBe('2026-01-01T00:00:00.000Z');
    expect(valueNotes(dallas(filled), metric('zhvi')).join(' | ')).toContain('Removed: the source has not answered since Jan 1, 2026');

    // And it stays expired, not merely missing, on the build after.
    const again = new Date(late);
    again.setUTCDate(again.getUTCDate() + 1);
    const later = fillFromPrevious(buildMarketSnapshot(METROS, null, null, again, {}), filled);
    expect(dallas(later).status?.zhvi).toBe('expired');
  });

  it('keeps a figure within its maximum age', () => {
    const soon = new Date('2026-01-01T00:00:00Z');
    soon.setUTCDate(soon.getUTCDate() + SOURCE_RULES.Zillow.maxAgeDays - 1);
    const filled = fillFromPrevious(buildMarketSnapshot(METROS, null, null, soon, {}), first);
    expect(dallas(filled).status?.zhvi).toBe('retained');
  });

  it('gives yearly sources longer than monthly ones', () => {
    expect(SOURCE_RULES['Census ACS'].maxAgeDays).toBeGreaterThan(365);
    expect(SOURCE_RULES.BLS.maxAgeDays).toBeLessThan(SOURCE_RULES['Census ACS'].maxAgeDays);
  });
});

describe('validation', () => {
  it('rejects an implausible reading and keeps the last good figure', () => {
    const good = buildMarketSnapshot(METROS, null, null, at('2026-08-01T00:00:00Z'), { zillow: zillow(300_000) });
    // A unit slip: thousands of dollars read as dollars.
    const bad = buildMarketSnapshot(METROS, null, null, at('2026-09-01T00:00:00Z'), { zillow: zillow(300, 'Aug 2026') });
    expect(bad.rejected).toEqual([expect.objectContaining({ city: 'Dallas', key: 'zhvi', value: 300 })]);
    expect(dallas(bad).values.zhvi).toBeNull();
    const filled = fillFromPrevious(bad, good);
    expect(dallas(filled).values.zhvi).toBe(300_000);
    expect(dallas(filled).periods.zhvi).toBe('Jul 2026');
    expect(dallas(filled).status?.zhvi).toBe('retained');
  });

  it('keeps a real zero', () => {
    const snap = buildMarketSnapshot(METROS, null, null, at('2026-09-01T00:00:00Z'), {
      permits: {
        current: new Map([['Dallas', { units: 120, multifamilyUnits: 0 }]]),
        previous: new Map(),
        period: 'Jan–Aug 2026'
      }
    });
    expect(dallas(snap).values.multifamilyPermitUnits).toBe(0);
    expect(dallas(snap).status?.multifamilyPermitUnits).toBe('fresh');
  });

  it('has a range for every metric', () => {
    for (const m of METRICS) expect(m.valid.min).toBeLessThan(m.valid.max);
  });
});

describe('Census permits with blank fields', () => {
  const row = (fields: string[]) =>
    `202608,48,240500,0,0,0,0,0,0,0,0,0,0,0,0,0,Fort Worth,${fields.join(',')}`;

  it('reads a blank unit column as unknown, not zero', () => {
    // 1-unit buildings, units, value; 2-unit; 3-4 unit; 5+ unit: the 2-unit count is blank.
    const result = parsePermitFile(row(['4474', '4474', '979062414', '5', '', '603276', '7', '27', '2685653', '93', '4284', '337540704']), cities);
    expect(result.get('Fort Worth')).toEqual({ units: null, multifamilyUnits: 4284 });
  });

  it('skips a row whose unit columns are all blank or malformed', () => {
    const result = parsePermitFile(row(['', '', '', '', 'x', '', '', '', '', '', '', '']), cities);
    expect(result.has('Fort Worth')).toBe(false);
  });

  it('still reads zeros as zeros', () => {
    const result = parsePermitFile(row(['10', '10', '1', '0', '0', '0', '0', '0', '0', '0', '0', '0']), cities);
    expect(result.get('Fort Worth')).toEqual({ units: 10, multifamilyUnits: 0 });
  });
});

describe('shared metros', () => {
  const snap = buildMarketSnapshot(METROS, null, null, at('2026-09-01T00:00:00Z'), {
    fhfa: new Map([
      ['41700', { index: 380, change1y: 9, change5y: 40, period: 'Q2 2026' }],
      ['12420', { index: 500, change1y: 5, change5y: 30, period: 'Q2 2026' }],
      ['26420', { index: 410, change1y: 7, change5y: 35, period: 'Q2 2026' }]
    ]),
    zillow: {
      homeValue: new Map([
        ['San Antonio', { value: 260_000, yearAgo: 255_000, period: 'Aug 2026' }],
        ['New Braunfels', { value: 340_000, yearAgo: 330_000, period: 'Aug 2026' }]
      ]),
      rent: new Map()
    }
  });
  const by = (city: string) => snap.markets.find((m) => m.city === city)!;

  it('marks the repeated metro figure and leaves city figures alone', () => {
    expect(sharedWith(by('New Braunfels'), 'hpiGrowth')).toBe('San Antonio');
    expect(sharedWith(by('Galveston'), 'hpiGrowth')).toBe('Houston');
    expect(sharedWith(by('San Antonio'), 'hpiGrowth')).toBeNull();
    expect(sharedWith(by('New Braunfels'), 'zhvi')).toBeNull();
    expect(sharedWith(by('Fort Worth'), 'hpiGrowth')).toBeNull(); // its own metro division
  });

  it('ranks a shared metro once', () => {
    const place = ranks(snap.markets, metric('hpiGrowth'));
    expect(place.get('San Antonio')).toBe(1);
    expect(place.has('New Braunfels')).toBe(false);
    expect(place.get('Houston')).toBe(2);
    expect(place.get('Austin')).toBe(3);
    expect(rankedCount(snap.markets, 'hpiGrowth')).toBe(3);
    // Both cities have their own Zillow figure, so both rank.
    expect(rankedCount(snap.markets, 'zhvi')).toBe(2);
  });

  it('says on the page which city the figure repeats', () => {
    expect(valueNotes(by('New Braunfels'), metric('hpiGrowth')).join(' | ')).toContain('Same figure as San Antonio');
  });
});

describe('metric metadata', () => {
  const shown = new Set(GROUPS.flatMap((g) => g.metrics));

  it('gives every displayed metric a geography and category the page can name', () => {
    for (const key of shown) {
      const m = metric(key);
      expect(GEOGRAPHY_LABELS[m.geography], `${key} geography`).toBeTruthy();
      expect(CATEGORY_LABELS[m.category], `${key} category`).toBeTruthy();
    }
  });

  it('labels residential figures as residential', () => {
    for (const key of ['medianRent', 'rentGrowth', 'rentalVacancy', 'medianHomeValue', 'permitUnits', 'multifamilyPermitUnits', 'permitGrowth']) {
      expect(metric(key).label.toLowerCase(), key).toContain('residential');
    }
    for (const key of ['medianRent', 'rentalVacancy', 'zhvi', 'zori', 'aptVacancy', 'redfinPrice', 'rdcListPrice', 'hpi']) {
      expect(metric(key).category, key).toBe('residential');
    }
    expect(metric('permitUnits').category).toBe('permits');
  });

  it('keeps residential figures out of the office, industrial, retail and development groups', () => {
    for (const group of GROUPS.filter((g) => ['office', 'industrial', 'retail', 'development'].includes(g.key))) {
      for (const key of group.metrics) expect(metric(key).category, `${group.key}: ${key}`).not.toBe('residential');
    }
  });

  it('calls employment proxies proxies and names the combined appraisal class', () => {
    expect(metric('officeJobs').note).toMatch(/^Employment proxy/);
    expect(metric('officeJobs').category).toBe('economic');
    expect(metric('cadCommercialValue').label).toContain('office, retail and hotel combined');
    expect(metric('cadCommercialValue').category).toBe('appraisal');
  });

  it('shows no metric that has no working source', () => {
    expect([...shown].some((key) => key.startsWith('lihtc'))).toBe(false);
  });
});

describe('source outcomes', () => {
  it('records successes, failures and partial answers, without keys', async () => {
    const log = outcomeLog(['s3cret-key-value']);
    expect(await log.attempt('Zillow', async () => 1)).toBe(1);
    expect(
      await log.attempt('Census ACS', async () => {
        throw new Error('GET https://api.census.gov/data/2024/acs/acs1?get=NAME&key=abc123 failed with s3cret-key-value');
      })
    ).toBeNull();
    await log.attempt('BLS', async () => new Map());
    log.partial('BLS', '7 of 90 series not published');
    log.record('HUD Fair Market Rents', 'skipped', 'HUD_API_TOKEN not set');

    expect(log.outcomes.map((o) => [o.source, o.status])).toEqual([
      ['Zillow', 'ok'],
      ['Census ACS', 'failed'],
      ['BLS', 'partial'],
      ['HUD Fair Market Rents', 'skipped']
    ]);
    const failed = log.outcomes[1]!.detail!;
    expect(failed).toContain('key=[redacted]');
    expect(failed).not.toContain('abc123');
    expect(failed).not.toContain('s3cret-key-value');
  });

  it('redacts a crash stack trace and keeps more of it', () => {
    const stack = `Error: GET https://api.census.gov/data?key=abc123 failed\n${'    at frame (file.ts:1:1)\n'.repeat(20)}`;
    const text = redact(stack, ['s3cret-key-value'], 4000);
    expect(text).not.toContain('abc123');
    expect(text.length).toBeGreaterThan(240);
  });

  it('redacts token-shaped parameters', () => {
    expect(redact('url?registrationkey=XYZ&token=abc&x=1')).toBe('url?registrationkey=[redacted]&token=[redacted]&x=1');
  });
});

describe('older files', () => {
  // A version 1 file: no schemaVersion, fetchedAt, status or shared.
  const v1: MarketSnapshot = {
    generatedAt: '2026-08-01T00:00:00.000Z',
    metrics: [],
    groups: [],
    sources: [],
    markets: [{ city: 'Dallas', metro: 'Dallas-Plano-Irving metro division', values: { zhvi: 290_000 }, periods: { zhvi: 'Jun 2026' } }]
  };

  it('fills from a version 1 file, dating kept figures to that file', () => {
    const filled = fillFromPrevious(buildMarketSnapshot(METROS, null, null, at('2026-09-01T00:00:00Z'), {}), v1);
    expect(dallas(filled).values.zhvi).toBe(290_000);
    expect(dallas(filled).periods.zhvi).toBe('Jun 2026');
    expect(dallas(filled).fetchedAt?.zhvi).toBe('2026-08-01T00:00:00.000Z');
    expect(dallas(filled).status?.zhvi).toBe('retained');
  });

  it('reads a version 1 file on the page as before', () => {
    const market = v1.markets[0]!;
    expect(valueStatus(market, 'zhvi')).toBe('fresh');
    expect(valueStatus(market, 'zori')).toBe('missing');
    expect(sharedWith(market, 'zhvi')).toBeNull();
    expect(retainedCount(v1)).toBe(0);
    expect(ranks(v1.markets, { key: 'zhvi', better: null }).get('Dallas')).toBe(1);
    expect(valueNotes(market, { key: 'zhvi' })).toEqual(['Jun 2026']);
  });

  it('keeps the fields every existing reader uses', () => {
    const snap = buildMarketSnapshot(METROS, null, null, at('2026-09-01T00:00:00Z'), { zillow: zillow(300_000) });
    expect(Object.keys(snap)).toEqual(expect.arrayContaining(['generatedAt', 'metrics', 'groups', 'markets', 'sources']));
    for (const market of snap.markets) {
      expect(Object.keys(market.values).sort()).toEqual(METRICS.map((m) => m.key).sort());
      expect(Object.keys(market.periods).sort()).toEqual(METRICS.map((m) => m.key).sort());
    }
  });
});

describe('reporting period end dates', () => {
  const iso = (p: string | null) => periodEnd(p)?.toISOString().slice(0, 10) ?? null;

  it('reads every period form the snapshot writes', () => {
    expect(iso('May 2026')).toBe('2026-05-31');
    expect(iso('Aug 2026, San Antonio metro')).toBe('2026-08-31');
    expect(iso('Jan–Aug 2026')).toBe('2026-08-31');
    expect(iso('July 2025')).toBe('2025-07-31');
    expect(iso('Q2 2026')).toBe('2026-06-30');
    expect(iso('2024')).toBe('2024-12-31');
    expect(iso('2023–24')).toBe('2024-12-31');
    expect(iso('FY 2027')).toBe('2027-09-30');
    expect(iso('2025 rates')).toBe('2025-12-31');
    expect(iso('2026 certified')).toBe('2026-12-31');
    expect(iso('Houston district, 2026-10-10')).toBeNull();
    expect(iso(null)).toBeNull();
  });
});

describe('sources that answer with an old file', () => {
  const redfin = (period: string, periodEnd: string): Map<'Dallas', RedfinReading> =>
    new Map([['Dallas', { medianSalePrice: 512_200, medianSalePriceYoy: 1, inventory: 9000, medianDom: 40, saleToList: 97, periodEnd, period, seasonallyAdjusted: false }]]);

  it('flags Redfin when its newest month is May in an October build', () => {
    const snap = buildMarketSnapshot(METROS, null, null, at('2026-10-10T01:27:00Z'), { redfin: redfin('May 2026', '2026-05-31') });
    expect(laggingSources(snap)).toEqual([{ source: 'Redfin', latest: 'May 2026', days: 132, maxLagDays: SOURCE_RULES.Redfin.maxLagDays }]);
    // Still published, with its own date: it is real data, just old.
    expect(dallas(snap).values.redfinPrice).toBe(512_200);
    expect(dallas(snap).periods.redfinPrice).toBe('May 2026');
  });

  it('does not flag a source on its normal schedule', () => {
    const snap = buildMarketSnapshot(METROS, null, null, at('2026-10-10T01:27:00Z'), {
      redfin: redfin('Aug 2026', '2026-08-31'),
      zillow: zillow(300_000, 'Aug 2026')
    });
    expect(laggingSources(snap)).toEqual([]);
  });

  it('judges a yearly survey by its own schedule', () => {
    const acs = { year: 2024, current: new Map([['19124', { population: 5_000_000 } as never]]), previous: new Map() };
    const snap = buildMarketSnapshot(METROS, null, acs, at('2026-10-10T00:00:00Z'));
    expect(laggingSources(snap).map((l) => l.source)).not.toContain('Census ACS');
  });
});

describe('construction jobs', () => {
  const months = (base: number): Point[] =>
    Array.from({ length: 13 }, (_, i) => ({ year: i < 1 ? 2025 : 2026, month: i < 1 ? 8 : i, value: base }));

  it('uses mining, logging and construction in every market, never construction alone', () => {
    const houston = METROS.find((m) => m.city === 'Houston')!;
    const series = new Map<string, Point[]>([
      [cesSeries(houston, 'construction'), months(240)],
      [cesSeries(houston, 'miningConstruction'), months(330)]
    ]);
    const snap = buildMarketSnapshot(METROS, series, null, at('2026-10-10T00:00:00Z'));
    expect(snap.markets.find((m) => m.city === 'Houston')!.values.constructionJobs).toBe(330_000);
    expect(blsSeriesFor(METROS)).not.toContain(cesSeries(houston, 'construction'));
    expect(metric('constructionJobs').label).toBe('Construction, mining and logging jobs');
  });
});
