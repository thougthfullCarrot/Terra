import { deflateRawSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { streamFirstSheet } from '../src/lib/xlsx.js';
import {
  annualWage,
  dedupe,
  disclosureFiles,
  filesToRead,
  isCreIndustry,
  isCreTitle,
  isoDate,
  marketFor,
  readFilings,
  summarize,
  titleFamily,
  type SalaryFile,
  type WageFiling
} from '../src/market/salaries.js';
import {
  caseNumber,
  civicClerkCases,
  isZoningItem,
  legistarCases,
  primeGovCases,
  zoningKind,
  zoningUses,
  type ZoningCase,
  type ZoningResult
} from '../src/market/zoning.js';
import { buildingNotHiring, growthRows, hiringOn, sameFirm } from '../../site/growth.js';
import { payRows, zoningCases } from '../../site/insights-view.js';

/* ------------------------------------------------------------ xlsx */

/** A minimal stored-and-deflated zip, enough for the reader. */
function zip(files: Record<string, string>): Buffer {
  const locals: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const [name, text] of Object.entries(files)) {
    const raw = Buffer.from(text, 'utf8');
    const data = deflateRawSync(raw);
    const nameBuf = Buffer.from(name, 'utf8');
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(8, 8);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    locals.push(local, nameBuf, data);
    const dir = Buffer.alloc(46);
    dir.writeUInt32LE(0x02014b50, 0);
    dir.writeUInt16LE(8, 10);
    dir.writeUInt32LE(data.length, 20);
    dir.writeUInt32LE(raw.length, 24);
    dir.writeUInt16LE(nameBuf.length, 28);
    dir.writeUInt32LE(offset, 42);
    central.push(dir, nameBuf);
    offset += 30 + nameBuf.length + data.length;
  }
  const dirBuf = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(Object.keys(files).length, 8);
  end.writeUInt16LE(Object.keys(files).length, 10);
  end.writeUInt32LE(dirBuf.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, dirBuf, end]);
}

function cell(ref: string, value: string | number, strings: string[]): string {
  if (typeof value === 'number') return `<c r="${ref}"><v>${value}</v></c>`;
  let index = strings.indexOf(value);
  if (index < 0) index = strings.push(value) - 1;
  return `<c r="${ref}" t="s"><v>${index}</v></c>`;
}

const HEADER = ['CASE_NUMBER', 'CASE_STATUS', 'DECISION_DATE', 'JOB_TITLE', 'EMPLOYER_NAME', 'NAICS_CODE', 'WORKSITE_CITY', 'WORKSITE_COUNTY', 'WORKSITE_STATE', 'WAGE_RATE_OF_PAY_FROM', 'WAGE_UNIT_OF_PAY', 'PW_WAGE_LEVEL'];

function workbook(rows: (string | number)[][]): Buffer {
  const strings: string[] = [];
  const letters = 'ABCDEFGHIJKL';
  const sheetRows = [HEADER, ...rows]
    .map((row, r) => `<row r="${r + 1}">${row.map((v, c) => cell(`${letters[c]}${r + 1}`, v, strings)).join('')}</row>`)
    .join('');
  const shared = `<sst>${strings.map((s) => `<si><t>${s.replace(/&/g, '&amp;')}</t></si>`).join('')}</sst>`;
  return zip({ 'xl/sharedStrings.xml': shared, 'xl/worksheets/sheet1.xml': `<worksheet><sheetData>${sheetRows}</sheetData></worksheet>` });
}

describe('streaming xlsx reader', () => {
  it('reads shared strings and numbers row by row', async () => {
    const data = workbook([['I-1', 'Certified', 46000, 'Analyst', 'CBRE, INC.', '531210', 'DALLAS', 'DALLAS', 'TX', 70000, 'Year', 'I']]);
    const rows: string[][] = [];
    for await (const row of streamFirstSheet(data)) rows.push(row);
    expect(rows[0]).toEqual(HEADER);
    expect(rows[1]).toEqual(['I-1', 'Certified', '46000', 'Analyst', 'CBRE, INC.', '531210', 'DALLAS', 'DALLAS', 'TX', '70000', 'Year', 'I']);
  });
});

/* ------------------------------------------------------------ Salaries */

describe('salary filings', () => {
  it('places worksites in markets', () => {
    expect(marketFor('Plano', 'COLLIN', 'TX')).toBe('Dallas');
    expect(marketFor('Arlington', 'Tarrant County', 'TX')).toBe('Fort Worth');
    expect(marketFor('NEW BRAUNFELS', 'COMAL', 'TX')).toBe('New Braunfels');
    expect(marketFor('Galveston', 'GALVESTON', 'TX')).toBe('Galveston');
    expect(marketFor('League City', 'GALVESTON', 'TX')).toBe('Houston');
    expect(marketFor('Tyler', 'SMITH', 'TX')).toBeNull();
    expect(marketFor('Dallas', 'DALLAS', 'GA')).toBeNull();
  });

  it('turns any pay unit into a yearly wage and drops typos', () => {
    expect(annualWage('85,000', 'Year')).toBe(85000);
    expect(annualWage('40', 'Hour')).toBe(83200);
    expect(annualWage(6000, 'Month')).toBe(72000);
    expect(annualWage('40', 'Year')).toBeNull();
    expect(annualWage('', 'Year')).toBeNull();
  });

  it('knows CRE industries, titles and title families', () => {
    expect(isCreIndustry('531210')).toBe(true);
    expect(isCreIndustry('525990')).toBe(true);
    expect(isCreIndustry('541511')).toBe(false);
    expect(isCreTitle('Real Estate Financial Analyst')).toBe(true);
    expect(isCreTitle('Acquisitions Associate')).toBe(true);
    expect(isCreTitle('Software Engineer')).toBe(false);
    expect(titleFamily('Senior Financial Analyst')).toBe('Analyst');
    expect(titleFamily('Acquisitions Associate')).toBe('Associate');
    expect(titleFamily('Vice President, Asset Management')).toBe('Vice president');
    expect(titleFamily('Assistant Project Manager')).toBe('Project / construction');
    expect(titleFamily('Property Manager')).toBe('Manager');
  });

  it('reads Excel serial and text dates', () => {
    expect(isoDate('46000')).toBe('2025-12-09');
    expect(isoDate('2026-03-01 00:00:00')).toBe('2026-03-01');
    expect(isoDate('3/1/2026')).toBe('2026-03-01');
  });

  it('keeps certified Texas CRE filings only', async () => {
    const rows = [
      HEADER,
      ['I-1', 'Certified', '46000', 'FINANCIAL ANALYST', 'CBRE, INC.', '531210', 'DALLAS', 'DALLAS', 'TX', '70000', 'Year', 'I'],
      ['I-2', 'Certified - Withdrawn', '46000', 'REAL ESTATE ANALYST', 'BANK OF TEXAS', '522110', 'HOUSTON', 'HARRIS', 'TX', '45', 'Hour', 'II'],
      ['I-3', 'Denied', '46000', 'ANALYST', 'HINES', '531390', 'HOUSTON', 'HARRIS', 'TX', '90000', 'Year', 'II'],
      ['I-4', 'Certified', '46000', 'SOFTWARE ENGINEER', 'ACME', '541511', 'AUSTIN', 'TRAVIS', 'TX', '150000', 'Year', 'III'],
      ['I-5', 'Certified', '46000', 'SOFTWARE ENGINEER', 'Lincoln Property Company', '541511', 'AUSTIN', 'TRAVIS', 'TX', '150000', 'Year', 'III'],
      ['I-6', 'Certified', '46000', 'ANALYST', 'CBRE, INC.', '531210', 'ATLANTA', 'FULTON', 'GA', '70000', 'Year', 'I'],
      ['I-7', 'Certified', '44000', 'ANALYST', 'CBRE, INC.', '531210', 'DALLAS', 'DALLAS', 'TX', '70000', 'Year', 'I']
    ];
    const { filings, read } = await readFilings(rows, { isFirm: (name) => /lincoln property/i.test(name), since: '2025-06-01' });
    expect(read).toBe(7);
    expect(filings.map((f) => f.caseNumber)).toEqual(['I-1', 'I-2', 'I-5']);
    expect(filings[0]).toMatchObject({ employer: 'CBRE, INC.', title: 'Financial Analyst', market: 'Dallas', place: 'Dallas', wage: 70000, level: 'I', decided: '2025-12-09' });
    expect(filings[1]!.wage).toBe(93600);
  });

  it('summarizes by role and by firm and title', () => {
    const f = (over: Partial<WageFiling>): WageFiling => ({ caseNumber: '', employer: 'CBRE, INC.', title: 'Financial Analyst', market: 'Dallas', place: 'Dallas', wage: 70000, level: 'I', decided: '2026-01-01', ...over });
    const [dallas] = summarize([f({}), f({ wage: 80000, level: 'II' }), f({ wage: 120000, title: 'Director, Leasing', level: 'IV' })]);
    expect(dallas!.filings).toBe(3);
    expect(dallas!.families.find((x) => x.family === 'Analyst')).toMatchObject({ filings: 2, median: 75000, entryMedian: 75000 });
    expect(dallas!.rows[0]).toMatchObject({ employer: 'CBRE, INC.', title: 'Financial Analyst', filings: 2, low: 70000, high: 80000 });
    expect(dedupe([f({ caseNumber: 'A', decided: '2026-01-01' }), f({ caseNumber: 'A', decided: '2026-02-01', wage: 1 })])).toHaveLength(1);
  });

  it('finds the newest disclosure files on the page', () => {
    const html = `<a href="/media/LCA_Disclosure_Data_FY2026_Q3.xlsx">x</a><a href="/sites/dolgov/files/ETA/oflc/pdfs/LCA_Disclosure_Data_FY2025_Q4.xlsx">y</a>
      <a href="/sites/dolgov/files/ETA/oflc/pdfs/LCA_Disclosure_Data_FY2026_Q1.xlsx">z</a><a href="/x/LCA_Disclosure_Data_FY2020_Q1.xlsx">w</a><a href="/x/LCA_Disclosure_Data_FY2026_Q2.xlsx">v</a>`;
    const files = disclosureFiles(html);
    expect(files[0]).toEqual({ year: 2026, quarter: 3, url: 'https://www.dol.gov/media/LCA_Disclosure_Data_FY2026_Q3.xlsx' });
    expect(filesToRead(files).map((f) => `${f.year}Q${f.quarter}`)).toEqual(['2026Q3', '2026Q2', '2026Q1', '2025Q4']);
  });

  it('filters the page rows by market, role and search', () => {
    const file: SalaryFile = {
      generatedAt: '',
      period: '',
      files: [],
      source: '',
      markets: [
        { city: 'Dallas', filings: 3, employers: 2, families: [], rows: [
          { employer: 'CBRE, INC.', title: 'Financial Analyst', family: 'Analyst', filings: 2, median: 70000, low: 70000, high: 70000, level: 'I', latest: '' },
          { employer: 'Hines', title: 'Director', family: 'Director', filings: 1, median: 200000, low: 200000, high: 200000, level: 'IV', latest: '' }
        ] },
        { city: 'Austin', filings: 1, employers: 1, families: [], rows: [{ employer: 'CBRE, INC.', title: 'Analyst', family: 'Analyst', filings: 1, median: 65000, low: 65000, high: 65000, level: 'I', latest: '' }] }
      ]
    };
    expect(payRows(file, '', 'cbre').map((r) => r.city)).toEqual(['Dallas', 'Austin']);
    expect(payRows(file, 'Dallas', '', 'Director').map((r) => r.employer)).toEqual(['Hines']);
  });
});

/* ------------------------------------------------------------ Zoning */

describe('zoning alerts', () => {
  it('tells zoning cases from other agenda items', () => {
    expect(isZoningItem('An application for MF-2(A) Multifamily District on property zoned CR Community Retail District')).toBe(true);
    expect(isZoningItem('C14-2026-0043 - 4201 Westbank Retail - rezoning property locally known as 4201 Westbank Dr')).toBe(true);
    expect(isZoningItem('Approve the minutes of the zoning commission meeting')).toBe(false);
    expect(isZoningItem('Application of Molly Davis for a special exception to the fence height regulations, zoned R-7.5(A)')).toBe(false);
    expect(isZoningItem('An application to replat a 0.438-acre tract zoned PD 193')).toBe(false);
    expect(isZoningItem('Approve a contract for street resurfacing')).toBe(false);
  });

  it('names the kind of request and the uses it points at', () => {
    expect(zoningKind('a new Specific Use Permit for a bar')).toBe('Special use permit');
    expect(zoningKind('a new Planned Development District for MF-2(A) uses')).toBe('Planned development');
    expect(zoningKind('NPA-2022-0005.01 amending the neighborhood plan, future land use map')).toBe('Plan amendment');
    expect(zoningKind('rezone 13.4 acres from HOL to C-3')).toBe('Rezoning');
    expect(zoningUses('an application for MF-2(A) Multifamily District on property zoned CR Community Retail')).toEqual(['Multifamily', 'Retail']);
    expect(zoningUses('LI Light Industrial District for a warehouse')).toEqual(['Industrial']);
    expect(caseNumber('C14-2026-0043 - 4201 Westbank Retail near IH-35, MF-33')).toBe('C14-2026-0043');
    expect(caseNumber('26P-041 Request for a change of zoning')).toBe('26P-041');
    expect(caseNumber('from "R-6" to "MF-33" along IH-35')).toBeNull();
  });

  it('reads Legistar agenda items and skips headings', () => {
    const source = { client: 'cityofdallas', place: 'Dallas', market: 'Dallas' as const };
    const event = { EventId: 1, EventBodyName: 'City Plan Commission', EventDate: '2026-10-08T00:00:00', EventInSiteURL: 'https://cityofdallas.legistar.com/MeetingDetail.aspx?LEGID=1' };
    const cases = legistarCases(source, event, [
      { EventItemId: 1, EventItemTitle: 'ZONING CASES - CONSENT', EventItemMatterFile: null, EventItemMatterName: null, EventItemMatterType: null },
      { EventItemId: 2, EventItemTitle: 'An application for MF-2(A) Multifamily District on property zoned CR Community Retail District', EventItemMatterFile: '26-2841A', EventItemMatterName: null, EventItemMatterType: 'ZONING' },
      { EventItemId: 3, EventItemTitle: 'Approve the minutes', EventItemMatterFile: '26-1', EventItemMatterName: null, EventItemMatterType: 'MINUTES' }
    ]);
    expect(cases).toHaveLength(1);
    expect(cases[0]).toMatchObject({ id: 'legistar:cityofdallas:2', market: 'Dallas', file: '26-2841A', kind: 'Rezoning', uses: ['Multifamily', 'Retail'], date: '2026-10-08', body: 'City Plan Commission' });
  });

  it('reads CivicClerk items, nested ones too', () => {
    const cases = civicClerkCases(
      { tenant: 'galvestontx', place: 'Galveston', market: 'Galveston' },
      { id: 9, eventName: 'Planning Commission', startDateTime: '2026-10-06T22:00:00Z', agendaId: 8 },
      [{ id: 1, agendaObjectItemName: 'Public Hearings', childItems: [{ id: 2, agendaObjectItemName: '26P-041 Request for a change of zoning from R-1 to Commercial (C) at 2101 Broadway' }] }]
    );
    expect(cases).toHaveLength(1);
    expect(cases[0]).toMatchObject({ file: '26P-041', kind: 'Rezoning', uses: ['Retail', 'Single family'], url: 'https://galvestontx.portal.civicclerk.com/event/9/overview' });
  });

  it("reads San Antonio's HTML agendas", () => {
    const html = `<div id="MeetingContents"><p>1.</p><p>ZONING CASE Z-2026-10700123 (Council District 3): A request for a change in zoning from "R-6" to "MF-33" on Lot 1, located at 100 Main Street. Staff recommends Approval.</p>
      <p>2.</p><p>PLAN AMENDMENT CASE PA-2026-11600045 (Council District 2): A request by Brown &amp; McDonald for a Resolution amending the land use from "Low Density Residential" to "Light Industrial". (Associated Zoning Case Z-2026-10700124) [email&#160;protected]</p></div>`;
    const cases = primeGovCases({ id: 5, title: 'Zoning Commission Meeting', dateTime: '2026-10-06T13:00:00', documentList: [] }, html, 'https://example');
    expect(cases.map((c) => [c.file, c.kind])).toEqual([
      ['Z-2026-10700123', 'Rezoning'],
      ['PA-2026-11600045', 'Plan amendment']
    ]);
    expect(cases[0]!.uses).toEqual(['Multifamily', 'Single family']);
    expect(cases[1]!.title).not.toMatch(/email/);
  });

  it('splits upcoming from recent for the page', () => {
    const base: Omit<ZoningCase, 'id' | 'date'> = { market: 'Dallas', place: 'Dallas', file: null, title: '', kind: 'Rezoning', uses: [], body: '', url: '' };
    const zoning: ZoningResult = { asOf: '', covered: [], failed: [], cases: [
      { ...base, id: 'a', date: '2026-10-01' },
      { ...base, id: 'b', date: '2026-10-20' },
      { ...base, id: 'c', date: '2026-10-09', market: 'Austin' }
    ] };
    expect(zoningCases(zoning, '', { when: 'upcoming', today: '2026-10-07' }).map((c) => c.id)).toEqual(['c', 'b']);
    expect(zoningCases(zoning, 'Dallas', { when: 'recent', today: '2026-10-07' }).map((c) => c.id)).toEqual(['a']);
  });
});

/* ------------------------------------------------------------ Hiring vs building */

describe("who's hiring vs. who's building", () => {
  it('matches firm names on filings without false friends', () => {
    expect(sameFirm('Hines', 'Hines Interests LP')).toBe(true);
    expect(sameFirm('Hines', 'Hines Frisco Station Development LP')).toBe(true); // ALIASES
    expect(sameFirm('Stonelake', 'Stonelake Frisco Station LP')).toBe(false);
    expect(sameFirm('Stonelake', 'Stonelake Development Ltd')).toBe(true);
    expect(sameFirm('Lincoln Property Company', 'Lincoln Property Company Southwest')).toBe(true);
    expect(sameFirm('Lincoln Property Company', 'Lincoln Electric')).toBe(false);
    expect(sameFirm('Trammell Crow Company', 'TCR Uptown Owner LLC')).toBe(true);
    expect(sameFirm('Greystar', null)).toBe(false);
  });

  const jobs = [
    { id: '1', firm: 'Hines', city: 'Houston', sector: 'Development' },
    { id: '2', firm: 'Hines', city: 'Houston', sector: 'Development' },
    { id: '3', firm: 'CBRE', city: 'Dallas', sector: 'Brokerage' },
    { id: '4', firm: 'Hines', city: 'Dallas', sector: 'Development' }
  ];
  const projects = [
    { id: 'p1', city: 'Houston', name: 'Tower', cost: 300e6, owner: 'Hines Interests LP', isPublic: false },
    { id: 'p2', city: 'Dallas', name: 'Office', cost: 50e6, owner: 'Hines', isPublic: false },
    { id: 'p3', city: 'Houston', name: 'Warehouse A', cost: 30e6, owner: 'Hillwood Development', isPublic: false },
    { id: 'p4', city: 'Houston', name: 'Warehouse B', cost: 25e6, owner: 'Hillwood Development Company LLC', isPublic: false },
    { id: 'p5', city: 'Houston', name: 'School', cost: 90e6, owner: 'Houston ISD', isPublic: true }
  ];

  it('ranks firms building and hiring first, in the same market', () => {
    const rows = growthRows(jobs, projects, 'Houston');
    expect(rows.map((r) => [r.firm, r.jobs.length, r.projects.map((p) => p.id), r.label])).toEqual([['Hines', 2, ['p1'], 'Building and hiring']]);
    const all = growthRows(jobs, projects);
    expect(all[0]!.projects.map((p) => p.id)).toEqual(['p1', 'p2']);
    expect(all[1]).toMatchObject({ firm: 'CBRE', label: 'Hiring, nothing on the map' });
  });

  it('lists private developers with no jobs in the feed', () => {
    const rows = buildingNotHiring(jobs, projects, 'Houston');
    expect(rows.map((r) => [r.owner, r.projects.length, r.cost])).toEqual([['Hillwood Development', 2, 55e6]]);
  });

  it('links a map pin to the firms hiring on it', () => {
    expect(hiringOn(projects[0]!, jobs)).toEqual([{ firm: 'Hines', count: 2 }]);
    expect(hiringOn(projects[4]!, jobs)).toEqual([]);
  });
});
