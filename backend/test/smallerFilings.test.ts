import { describe, expect, it } from 'vitest';
import { capFor, fetchDevelopments, smallerFilings, type TabsRow } from '../src/market/developments.js';

const NOW = new Date('2026-10-14T12:00:00Z');

const row = (i: number, cost: number, over: Partial<TabsRow> = {}): TabsRow => ({
  ProjectNumber: `TABSS${String(i).padStart(6, '0')}`,
  ProjectName: `Filing ${i}`,
  ProjectCreatedOn: '2026-03-01T10:00:00',
  ProjectStatus: 3005,
  FacilityName: null,
  City: 1537,
  County: 2015,
  TypeOfWork: 9001,
  EstimatedCost: cost,
  EstimatedStartDate: '2026-04-01T00:00:00',
  EstimatedEndDate: '2027-06-01T00:00:00',
  ...over
});

/** San Antonio as the build saw it: 300 filings at $2.77M or more, then the PDL Club at $1.2M. */
const PDL = row(9999, 1_200_000, { ProjectNumber: 'TABS2026006871', ProjectName: 'PDL Club ' });
const ROWS = [...Array.from({ length: 300 }, (_, i) => row(i, 2_769_500 + (300 - i) * 1000)), PDL, row(301, 900_000)];

describe('filings below the map cap', () => {
  it('San Antonio pins only its 300 biggest, so a $1.2M filing falls below the $2.77M cutoff', () => {
    expect(capFor('San Antonio')).toBe(300);
    expect(ROWS.indexOf(PDL)).toBeGreaterThanOrEqual(capFor('San Antonio'));
  });

  it('lists the filings past the cap, biggest first, with a TDLR link and no pin fields', () => {
    const list = smallerFilings('San Antonio', ROWS, new Map([[1537, 'San Antonio']]));
    expect(list.map((s) => s.id)).toEqual(['TABS2026006871', 'TABSS000301']);
    expect(list[0]).toEqual({
      id: 'TABS2026006871',
      city: 'San Antonio',
      place: 'San Antonio',
      name: 'PDL Club',
      status: 'Registered',
      work: expect.any(String),
      cost: 1_200_000,
      registered: '2026-03-01',
      end: '2027-06-01',
      url: 'https://www.tdlr.texas.gov/TABS/Projects/TABS2026006871'
    });
    expect(list[0]).not.toHaveProperty('lat');
  });

  it('keeps the list to its limit and is empty when nothing passes the cap', () => {
    expect(smallerFilings('San Antonio', ROWS, new Map(), 1)).toHaveLength(1);
    expect(smallerFilings('San Antonio', ROWS.slice(0, 300))).toEqual([]);
  });
});

describe('the build result', () => {
  it('reports each metro’s filings, cap and cutoff, and reads no page for the smaller list', async () => {
    const pages: string[] = [];
    const fetchImpl = (async (input: string | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('/SearchProjects')) {
        const form = new URLSearchParams(String(init?.body));
        const data = form.get('LocationCounty') === '2015' ? ROWS : [];
        return new Response(JSON.stringify({ data: data.slice(0, 100 * 4), recordsFiltered: data.length }));
      }
      if (url.includes('/Search/Project/')) {
        pages.push(url);
        return new Response('<h4>PROJECT</h4>');
      }
      if (url.includes('geocoding')) return new Response(JSON.stringify({ result: { addressMatches: [] } }));
      return new Response('', { status: 404 });
    }) as typeof fetch;
    const result = await fetchDevelopments(['San Antonio'], { now: NOW, pauseMs: 0, retries: 0, fetchImpl });
    const sa = result.metros?.find((m) => m.city === 'San Antonio');
    expect(sa).toMatchObject({ cap: 300, filings: 302, cutoff: 2_770_500 });
    expect(result.smaller?.map((s) => s.id)).toContain('TABS2026006871');
    expect(pages.some((u) => u.includes('TABS2026006871'))).toBe(false);
  });
});
