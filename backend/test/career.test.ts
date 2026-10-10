import { describe, expect, it } from 'vitest';
import {
  buildBrief,
  decodeTitle,
  jobFlags,
  mentions,
  nearCampus,
  readCareerHash,
  skillDemand,
  sponsorRows,
  tourStops,
  tourUrl,
  writeCareerHash
} from '../../site/career.js';
import { seatKey, updateHistory } from '../src/site/history.js';
import { buildSponsors, lastYearWhere, tidyName, windowLabel } from '../src/career/sponsors.js';
import type { Posting } from '../src/types.js';

const job = (over: Record<string, unknown> = {}) => ({
  id: 'j1',
  role: 'Acquisitions Analyst',
  firm: 'Hines',
  city: 'Houston',
  sector: 'Investment',
  postedAt: '2026-10-01T00:00:00Z',
  match: { required: ['excel', 'modeling'] },
  ...over
});

const project = (over: Record<string, unknown> = {}) => ({
  city: 'Houston',
  name: 'Tower',
  facility: 'Tower One',
  cost: 50_000_000,
  isPublic: false,
  approximate: false,
  address: '1 Main St',
  lat: 29.76,
  lng: -95.37,
  owner: 'Hines Interests LP',
  url: 'https://example.com/p',
  ...over
});

describe('career hash', () => {
  it('round-trips a tool, city and firm', () => {
    const hash = writeCareerHash({ tool: 'tour', city: 'Austin', firm: 'JLL' });
    expect(hash).toBe('#career&tool=tour&city=Austin&firm=JLL');
    expect(readCareerHash(hash)).toMatchObject({ open: true, tool: 'tour', city: 'Austin', firm: 'JLL' });
  });
  it('defaults to the brief and stays closed on other hashes', () => {
    expect(readCareerHash('#career').tool).toBe('brief');
    expect(readCareerHash('#markets').open).toBe(false);
  });
});

describe('job flags', () => {
  const now = new Date('2026-10-10T00:00:00Z');
  it('flags a job open two months or more, from the history date when there is one', () => {
    expect(jobFlags(job({ postedAt: '2026-10-01T00:00:00Z' }), now)).toEqual([]);
    const [flag] = jobFlags(job({ postedAt: '2026-10-01T00:00:00Z', openSince: '2026-07-01' }), now);
    expect(flag).toMatchObject({ kind: 'stale', label: 'Open 3+ months' });
  });
  it('flags reposts', () => {
    expect(jobFlags(job({ reposts: 2 }), now).map((f) => f.label)).toEqual(['Reposted 2×']);
  });
});

describe('title decoder', () => {
  it('reads common entry-level titles', () => {
    expect(decodeTitle('Analyst, Acquisitions')?.key).toBe('acq');
    expect(decodeTitle('Development Associate')?.key).toBe('dev');
    expect(decodeTitle('Assistant Property Manager')?.key).toBe('pm');
    expect(decodeTitle('Commercial Credit Analyst')?.key).toBe('lending');
    expect(decodeTitle('Appraiser Trainee')?.key).toBe('appraisal');
    expect(decodeTitle('Escrow Assistant')?.key).toBe('title');
    expect(decodeTitle('Chief Executive')).toBeNull();
  });
});

describe('skill demand', () => {
  it('counts the share of postings asking for each skill, by sector', () => {
    const jobs = [
      job({ id: '1' }),
      job({ id: '2', match: { required: ['excel'] } }),
      job({ id: '3', sector: 'Property Mgmt', match: { required: ['yardi'] } }),
      job({ id: '4', city: 'Austin', match: { required: ['argus'] } })
    ];
    const d = skillDemand(jobs, 'Houston', 1);
    expect(d.total).toBe(3);
    expect(d.rows[0]).toMatchObject({ key: 'excel', count: 2 });
    expect(d.rows.find((r) => r.key === 'argus')).toBeUndefined();
    expect(d.sectors.map((s) => s.sector)).toEqual(['Investment', 'Property Mgmt']);
    expect(d.rows[0]!.cells[0]).toMatchObject({ sector: 'Investment', share: 1 });
  });
});

describe('near campus and tours', () => {
  const uh = { lat: 29.7199, lng: -95.3422 };
  it('lists nearby private projects and the firms on them, hiring firms first', () => {
    const projects = [
      project(),
      project({ name: 'Far', lat: 30.5, lng: -95.37, owner: 'Far Owner LLC' }),
      project({ name: 'School', isPublic: true, owner: 'Houston ISD' }),
      project({ name: 'Shop', lat: 29.73, lng: -95.35, owner: 'Acme Retail LLC', cost: 2_000_000 })
    ];
    const near = nearCampus(projects, [job()], uh, 10);
    expect(near.projects.map((p) => p.name)).toEqual(['Shop', 'Tower']);
    expect(near.firms[0]).toMatchObject({ name: 'Hines Interests LP' });
    expect(near.firms[0]!.jobs).toHaveLength(1);
  });
  it('orders tour stops by nearest neighbor and builds a Maps link', () => {
    const projects = [
      project({ name: 'A', lat: 29.8, lng: -95.4 }),
      project({ name: 'B', lat: 29.77, lng: -95.38 }),
      project({ name: 'C', lat: 29.7, lng: -95.3, approximate: true }),
      project({ name: 'D', lat: 29.79, lng: -95.39, address: null })
    ];
    const stops = tourStops(projects, 'Houston', { lat: 29.76, lng: -95.37 });
    expect(stops.map((s) => s.name)).toEqual(['B', 'A']);
    const url = new URL(tourUrl({ lat: 29.76, lng: -95.37 }, stops));
    expect(url.hostname).toBe('www.google.com');
    expect(url.searchParams.get('destination')).toBe('29.80000,-95.40000');
    expect(url.searchParams.get('waypoints')).toBe('29.77000,-95.38000');
  });
});

describe('interview brief', () => {
  it('pulls the firm\'s projects, headlines, zoning cases, pay and sponsor count', () => {
    const b = buildBrief('Hines', {
      jobs: [job(), job({ id: '2', firm: 'JLL' })],
      projects: [project(), project({ owner: 'Someone Else LLC' })],
      news: { cities: [{ city: 'Houston', headlines: [{ title: 'Hines buys tower downtown', url: 'u1', source: 'HBJ', publishedAt: '2026-10-01' }, { title: 'Machines take over', url: 'u2' }] }] },
      zoning: { cases: [{ title: 'Zoning change for Hines tract', place: 'Austin', body: 'Council', date: '2026-10-20' }] },
      salaries: { markets: [{ city: 'Houston', rows: [{ employer: 'Hines Interests LP', title: 'Analyst', median: 90000, filings: 3 }] }] },
      sponsors: { brokers: [{ name: 'Hines', newAgents: 4 }] }
    });
    expect(b.jobs).toHaveLength(1);
    expect(b.projects).toHaveLength(1);
    expect(b.headlines.map((h) => h.url)).toEqual(['u1']);
    expect(b.cases).toHaveLength(1);
    expect(b.pay).toHaveLength(1);
    expect(b.sponsor?.newAgents).toBe(4);
    expect(b.points.length).toBeGreaterThanOrEqual(3);
    expect(b.questions.length).toBeGreaterThan(0);
  });
  it('matches whole words only', () => {
    expect(mentions('Hines', 'Hines lands a tenant')).toBe(true);
    expect(mentions('Hines', 'Machines lands a tenant')).toBe(false);
    expect(mentions('Lincoln Property Company', 'Lincoln Property buys a site')).toBe(true);
  });
});

describe('job history', () => {
  const posting = (over: Partial<Posting> = {}): Posting => ({
    id: 'a',
    role: 'Analyst - Acquisitions (R1234)',
    firm: 'Hines',
    city: 'Houston',
    sector: 'Investment',
    kind: 'Entry-level',
    pay: null,
    deadline: null,
    postedAt: new Date('2026-10-01T00:00:00Z'),
    description: '',
    reqs: [],
    applyUrl: 'https://example.com',
    source: 'greenhouse',
    ...over
  });

  it('treats requisition numbers and punctuation as the same seat', () => {
    expect(seatKey(posting())).toBe(seatKey(posting({ role: 'Analyst, Acquisitions' })));
  });

  it('keeps the first date, and counts a new id or a return after days away as a repost', () => {
    const day1 = updateHistory(null, [posting()], new Date('2026-10-02T00:00:00Z'));
    expect(day1.seen.get('a')).toEqual({ openSince: '2026-10-01', reposts: 0 });
    // Same id the next build: nothing new.
    const day2 = updateHistory(day1.history, [posting()], new Date('2026-10-02T02:00:00Z'));
    expect(day2.seen.get('a')?.reposts).toBe(0);
    // Reposted under a new id with a fresh posted date: still open since the first date.
    const day3 = updateHistory(day2.history, [posting({ id: 'b', postedAt: new Date('2026-10-05T00:00:00Z') })], new Date('2026-10-05T00:00:00Z'));
    expect(day3.seen.get('b')).toEqual({ openSince: '2026-10-01', reposts: 1 });
    // Gone for a week, then back with the same id.
    const day4 = updateHistory(day3.history, [posting({ id: 'b' })], new Date('2026-10-12T00:00:00Z'));
    expect(day4.seen.get('b')?.reposts).toBe(2);
  });

  it('does not count one seat listed twice in the same build', () => {
    const first = updateHistory(null, [posting()], new Date('2026-10-02T00:00:00Z'));
    const next = updateHistory(first.history, [posting(), posting({ id: 'dup' })], new Date('2026-10-02T02:00:00Z'));
    expect(next.seen.get('a')?.reposts).toBe(0);
  });

  it('forgets seats not seen for months', () => {
    const old = updateHistory(null, [posting()], new Date('2026-01-01T00:00:00Z'));
    const later = updateHistory(old.history, [], new Date('2026-10-01T00:00:00Z'));
    expect(Object.keys(later.history.seats)).toHaveLength(0);
  });
});

describe('new-agent sponsors', () => {
  it('builds a twelve-month window over MM/DD/YYYY text dates', () => {
    const where = lastYearWhere(new Date('2026-10-10T00:00:00Z'));
    expect(where).toContain("original_license_date like '10/%/2026'");
    expect(where).toContain("original_license_date like '11/%/2025'");
    expect(where).not.toContain("'10/%/2025'");
    expect(windowLabel(new Date('2026-10-10T00:00:00Z'))).toBe('Nov 2025 to Oct 2026');
  });

  it('groups new agents by sponsor, places each in its busiest Terra county, and skips the rest of Texas', () => {
    const brokers = buildSponsors(
      [
        { related_license_number: '1-BB', related_license_full_name: 'KELLER WILLIAMS REALTY, LLC', county: 'Harris', n: '5' },
        { related_license_number: '1-BB', related_license_full_name: 'KELLER WILLIAMS REALTY, LLC', county: 'Travis', n: '2' },
        { related_license_number: '2-BB', related_license_full_name: 'SMALL TOWN REALTY', county: 'Smith', n: '9' },
        { related_license_number: '3-BB', related_license_full_name: 'ONE AGENT LLC', county: 'Dallas', n: '1' },
        { related_license_number: '4-BB', related_license_full_name: 'ISLAND HOMES', county: 'Galveston', n: '3' }
      ],
      [{ related_license_number: '1-BB', n: '40' }]
    );
    expect(brokers).toEqual([
      { license: '1-BB', name: 'Keller Williams Realty, LLC', city: 'Houston', place: 'Harris County', newAgents: 7, agents: 40 },
      { license: '4-BB', name: 'Island Homes', city: 'Galveston', place: 'Galveston County', newAgents: 3, agents: 3 }
    ]);
    expect(sponsorRows({ brokers }, 'Houston').map((b) => b.name)).toEqual(['Keller Williams Realty, LLC']);
    expect(sponsorRows({ brokers }, '', 'island').map((b) => b.name)).toEqual(['Island Homes']);
  });

  it('tidies all-caps names', () => {
    expect(tidyName('JPAR - SAN ANTONIO')).toBe('JPAR - San Antonio');
    expect(tidyName('eXp Realty LLC')).toBe('eXp Realty LLC');
  });
});
