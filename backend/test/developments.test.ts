import { describe, expect, it } from 'vitest';
import { developerLink } from '../src/market/developers.js';
import {
  currentDevelopments,
  distanceKm,
  fetchDevelopments,
  geocodable,
  parseProjectPage,
  parseZcta,
  projectDetails,
  searchForm,
  spread,
  zipOf,
  type Development,
  type TabsRow
} from '../src/market/developments.js';

/** A TABS project page cut down to its markup shape: labels and values in their own elements. */
function page(fields: [string, ...string[]][][], sections = ['PROJECT', 'OWNER', 'TENANT', 'DESIGN FIRM']): string {
  const body = sections
    .map((section, i) => {
      const rows = (fields[i] ?? []).map(([label, ...values]) => `<dt>${label}</dt><dd>${values.map((v) => `<span>${v}</span>`).join('<br/>')}</dd>`);
      return `<h4>${section}</h4><dl>${rows.join('')}</dl>`;
    })
    .join('');
  return `<html><head><script>var x = "OWNER";</script></head><body><h3>Project #:</h3><p>TABS1</p>${body}<p>Registered accessibility specialists (RAS) set and collect the fees.</p><p>OWNER</p></body></html>`;
}

const HOUSTON_PAGE = page([
  [
    ['Project Name:', 'Hanover Rankin &amp; 59'],
    ['Location Address:', '1200 Rankin Rd', 'Houston, TX 77073'],
    ['Type of Funds:', 'This project does not involve public funds.'],
    ['Scope of Work:', 'Four-story apartment building with structured parking.'],
    ['Square Footage:', '312,450 ft', '2'],
    ['Are the private funds provided by the tenant?', 'No']
  ],
  [
    ['Owner Name:', 'Hanover Rankin LLC'],
    ['Owner Address:', '5847 San Felipe St', 'Houston, Texas 77057']
  ],
  [['Not Assigned']],
  [['Design Firm Name:', 'Meeks + Partners']]
]);

function row(over: Partial<TabsRow> = {}): TabsRow {
  return {
    ProjectNumber: 'TABS2026021473',
    ProjectName: 'Hanover Rankin & 59',
    ProjectCreatedOn: '2026-05-29T10:00:00',
    ProjectStatus: 3008,
    FacilityName: 'Hanover Rankin & 59',
    City: 785,
    TypeOfWork: 9001,
    EstimatedCost: 37246815,
    EstimatedStartDate: '2026-08-01T00:00:00',
    EstimatedEndDate: '2028-02-01T00:00:00',
    ...over
  };
}

describe('TABS project pages', () => {
  it('reads the address, owner, design firm, size and funding', () => {
    const details = projectDetails(parseProjectPage(HOUSTON_PAGE));
    expect(details).toEqual({
      address: '1200 Rankin Rd, Houston, TX 77073',
      owner: 'Hanover Rankin LLC',
      tenant: null,
      designFirm: 'Meeks + Partners',
      scope: 'Four-story apartment building with structured parking.',
      squareFeet: 312450,
      isPublic: false
    });
  });

  it('marks public projects and trims a long scope', () => {
    const html = page([
      [
        ['Location Address:', 'From: West of White Oak Bayou To: McKee Street', 'Houston, TX 77002'],
        ['Type of Funds:', 'This project involves public funds, public land, or is a Federally funded roadway project.'],
        ['Scope of Work:', 'x'.repeat(400)]
      ],
      [['Owner Name:', 'TxDOT District: Houston']]
    ]);
    const details = projectDetails(parseProjectPage(html));
    expect(details.isPublic).toBe(true);
    expect(details.owner).toBe('TxDOT District: Houston');
    expect(details.scope).toHaveLength(298);
    expect(geocodable(details.address)).toBeNull();
  });
});

describe('which filings count as current developments', () => {
  it('keeps new buildings and additions still under way', () => {
    const rows = [
      row(),
      row({ ProjectNumber: 'add', TypeOfWork: 9003 }),
      row({ ProjectNumber: 'reno', TypeOfWork: 9002 }),
      row({ ProjectNumber: 'closed', ProjectStatus: 3007 }),
      row({ ProjectNumber: 'inspected', ProjectStatus: 3001 }),
      row({ ProjectNumber: 'typo', EstimatedCost: 20_000_000_000 }),
      row({ ProjectNumber: 'road', ProjectName: 'IH 10 (CSJ: 0508-01-397)' }),
      row({ ProjectNumber: 'school', ProjectName: 'Richardson ISD - Liberty Middle School', EstimatedCost: 1_060_000_000 })
    ];
    expect(currentDevelopments(rows).map((r) => r.ProjectNumber)).toEqual(['TABS2026021473', 'add']);
  });

  it('searches one city for the last year, biggest first', () => {
    const form = searchForm('Houston', new Date('2025-10-05T00:00:00Z'), new Date('2026-10-05T00:00:00Z'));
    expect(form).toMatchObject({
      LocationCity: '785',
      RegistrationDateBegin: '10/05/2025',
      RegistrationDateEnd: '10/05/2026',
      'order[0][dir]': 'desc',
      'columns[9][data]': 'EstimatedCost'
    });
  });

  it('only geocodes street addresses', () => {
    expect(geocodable('811 Main, Houston, TX 77002')).toBe('811 Main, Houston, TX 77002');
    expect(geocodable('NE corner of FM 1960 and Kuykendahl, Houston, TX')).toBeNull();
    expect(geocodable(null)).toBeNull();
  });

  it('measures distance well enough to reject a wrong-city match', () => {
    expect(distanceKm([29.7604, -95.3698], [32.7767, -96.797])).toBeGreaterThan(350);
    expect(distanceKm([29.7604, -95.3698], [29.76, -95.37])).toBeLessThan(1);
  });
});

describe('ZIP code centers', () => {
  it('reads Texas ZCTA centers from the gazetteer', () => {
    const text = 'GEOID\tALAND\tAWATER\tALAND_SQMI\tAWATER_SQMI\tINTPTLAT\tINTPTLONG                                                                                                               \n' +
      '77044\t1\t0\t1\t0\t29.887\t-95.183\n10001\t1\t0\t1\t0\t40.75\t-73.99\n88510\t1\t0\t1\t0\t31.8\t-106.4\n';
    expect(parseZcta(text)).toEqual(new Map([['77044', [29.887, -95.183]], ['88510', [31.8, -106.4]]]));
  });

  it('takes the ZIP from the end of an address, not from a many-site filing', () => {
    expect(zipOf('12550 Timber Forest Dr, Houston, TX 77044')).toBe('77044');
    expect(zipOf('i-635 & Hillcrest Road, Dallas, TX 75230-1234')).toBe('75230');
    expect(zipOf('Various locations in Houston area and San Antonio, Houston, TX 77001')).toBeNull();
    expect(zipOf(null)).toBeNull();
  });

  it('spreads projects sharing a center so each has its own pin', () => {
    expect(spread([29.9, -95.2], 0)).toEqual([29.9, -95.2]);
    const [a, b] = [spread([29.9, -95.2], 1), spread([29.9, -95.2], 2)];
    expect(a).not.toEqual(b);
    expect(distanceKm([29.9, -95.2], a)).toBeLessThan(0.3);
  });
});

describe('developer links', () => {
  it('uses the listed site when the owner or project names a known developer', () => {
    expect(developerLink('Hanover Rankin LLC', 'x', 'Houston')).toEqual({ url: 'https://www.hanoverco.com/', direct: true, name: 'The Hanover Company' });
    expect(developerLink('2120 Post Oak Owner LLC', 'Hines 2120 Post Oak', 'Houston').url).toBe('https://www.hines.com/');
  });

  it('falls back to a first-result search for the owner', () => {
    const link = developerLink('Fairbanks Industrial Investors', 'Fairbanks D', 'Houston');
    expect(link.direct).toBe(false);
    expect(decodeURIComponent(link.url)).toBe('https://duckduckgo.com/?q=!ducky Fairbanks Industrial Investors Houston Texas');
  });
});

describe('fetchDevelopments', () => {
  const geocodeHit = { result: { addressMatches: [{ coordinates: { x: -95.41, y: 29.95 } }] } };

  function fakeFetch(calls: string[]): typeof fetch {
    return (async (input: string | URL, init?: RequestInit) => {
      const url = String(input);
      calls.push(init?.method === 'POST' ? `POST ${url} ${String(init.body)}` : url);
      if (url.endsWith('/SearchProjects')) {
        return new Response(JSON.stringify({ data: [row(), row({ ProjectNumber: 'OLD1', ProjectName: 'Old one' }), row({ ProjectNumber: 'X', ProjectStatus: 3007 })] }));
      }
      if (url.includes('/Search/Project/')) return new Response(HOUSTON_PAGE);
      if (url.includes('geocoding.geo.census.gov')) return new Response(JSON.stringify(geocodeHit));
      return new Response('', { status: 404 });
    }) as typeof fetch;
  }

  it('skips a city with no TABS city id yet', async () => {
    const calls: string[] = [];
    const result = await fetchDevelopments(['New Braunfels'], { now: new Date('2026-10-05T00:00:00Z'), pauseMs: 0, fetchImpl: fakeFetch(calls) });
    expect(result.projects).toHaveLength(0);
    expect(calls).toHaveLength(0);
  });

  it('reads new projects, reuses earlier ones, and places them on the map', async () => {
    const calls: string[] = [];
    const old = { id: 'OLD1', address: '1 Old St', owner: 'Hines', tenant: null, designFirm: null, scope: null, squareFeet: null, isPublic: false, lat: 29.7, lng: -95.4 } as Development;
    const result = await fetchDevelopments(['Houston'], {
      now: new Date('2026-10-05T00:00:00Z'),
      previous: [old],
      pauseMs: 0,
      fetchImpl: fakeFetch(calls)
    });
    expect(result.projects).toHaveLength(2);
    const [fresh, kept] = result.projects;
    expect(fresh).toMatchObject({
      id: 'TABS2026021473',
      city: 'Houston',
      owner: 'Hanover Rankin LLC',
      cost: 37246815,
      status: 'Registered',
      work: 'New construction',
      registered: '2026-05-29',
      start: '2026-08-01',
      lat: 29.95,
      lng: -95.41,
      developerUrl: 'https://www.hanoverco.com/',
      developerDirect: true,
      url: 'https://www.tdlr.texas.gov/TABS/Projects/TABS2026021473'
    });
    expect(fresh!.facility).toBeNull();
    expect(kept).toMatchObject({ id: 'OLD1', name: 'Old one', lat: 29.7, developerUrl: 'https://www.hines.com/' });
    // One search, one project page and one geocode: the earlier project is not read again.
    expect(calls.filter((c) => c.includes('/Search/Project/'))).toHaveLength(1);
    expect(calls.filter((c) => c.includes('geocoding'))).toHaveLength(1);
    expect(calls[0]).toContain('LocationCity=785');
  });

  it('leaves a project off the map when the geocoder places it in another city', async () => {
    const calls: string[] = [];
    const base = fakeFetch(calls);
    const farAway = (async (input: string | URL, init?: RequestInit) =>
      String(input).includes('geocoding')
        ? new Response(JSON.stringify({ result: { addressMatches: [{ coordinates: { x: -96.8, y: 32.78 } }] } }))
        : base(input, init)) as typeof fetch;
    const result = await fetchDevelopments(['Houston'], { pauseMs: 0, fetchImpl: farAway });
    expect(result.projects[0]).toMatchObject({ lat: null, lng: null });
  });

  it('puts an address the geocoder misses at its ZIP code center, marked approximate', async () => {
    const calls: string[] = [];
    const base = fakeFetch(calls);
    const gazetteer = zipFile('2026_Gaz_zcta_national.txt', 'GEOID\tINTPTLAT\tINTPTLONG\n77073\t30.02\t-95.39\n');
    const missThenZip = (async (input: string | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes('geocoding')) return new Response(JSON.stringify({ result: { addressMatches: [] } }));
      if (url.includes('2026_Gaz_zcta')) return new Response(gazetteer);
      return base(input, init);
    }) as typeof fetch;
    const result = await fetchDevelopments(['Houston'], { now: new Date('2026-10-05T00:00:00Z'), pauseMs: 0, fetchImpl: missThenZip });
    expect(result.projects[0]).toMatchObject({ lat: 30.02, lng: -95.39, approximate: true });
    expect(result.projects[1]).toMatchObject({ approximate: true });
    expect(result.projects[1]!.lat).not.toBe(30.02);
  });
});

/** A one-file zip with the file stored uncompressed. */
function zipFile(name: string, text: string): Buffer {
  const data = Buffer.from(text);
  const fileName = Buffer.from(name);
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt32LE(data.length, 18);
  local.writeUInt32LE(data.length, 22);
  local.writeUInt16LE(fileName.length, 26);
  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt32LE(data.length, 20);
  central.writeUInt32LE(data.length, 24);
  central.writeUInt16LE(fileName.length, 28);
  central.writeUInt32LE(0, 42);
  const centralAt = local.length + fileName.length + data.length;
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(1, 8);
  end.writeUInt16LE(1, 10);
  end.writeUInt32LE(central.length + fileName.length, 12);
  end.writeUInt32LE(centralAt, 16);
  return Buffer.concat([local, fileName, data, central, fileName, end]);
}

describe('map helpers on the site', async () => {
  const { cityProjects, markerRadius, projectDates } = await import('../../site/market.js');

  it('lists one city biggest first, optionally private only', () => {
    const projects = [
      { city: 'Houston', cost: 5, isPublic: false, id: 'a' },
      { city: 'Houston', cost: 9, isPublic: true, id: 'b' },
      { city: 'Dallas', cost: 7, isPublic: false, id: 'c' }
    ];
    expect(cityProjects(projects, 'Houston').map((p) => p.id)).toEqual(['b', 'a']);
    expect(cityProjects(projects, 'Houston', { privateOnly: true }).map((p) => p.id)).toEqual(['a']);
    expect(cityProjects(null, 'Houston')).toEqual([]);
  });

  it('sizes pins by cost between 6 and 20 pixels', () => {
    expect(markerRadius(100, 100)).toBe(20);
    expect(markerRadius(0, 100)).toBe(6);
    expect(markerRadius(25, 100)).toBe(13);
  });

  it('writes the construction window', () => {
    expect(projectDates('2026-08-01', '2028-02-01')).toBe('Aug 2026 – Feb 2028');
    expect(projectDates('2026-08-01', null)).toBe('Starts Aug 2026');
    expect(projectDates('2026-08-01', '2026-06-01')).toBe('Starts Aug 2026');
    expect(projectDates(null, null)).toBe('');
  });
});
