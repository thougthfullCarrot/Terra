import { describe, expect, it } from 'vitest';
import {
  addressWhere,
  circle,
  dealSteps,
  entityName,
  filterSales,
  franchiseUrl,
  inGeometry,
  isEntity,
  OWNER_SOURCES,
  ownerLikeWhere,
  ownerWhere,
  parseAddress,
  readIsochrones,
  readPropertyHash,
  sameEntity,
  sumInside,
  writePropertyHash
} from '../../site/property.js';
import { analyzeDeal } from '../../site/deal.js';
import { candidates, dealType, readOverride, readPrice, readPricePerSqft, readSize, texasPlace, weekOf, ASSUMED_CAP_RATES } from '../src/property/dealOfWeek.js';
import { isCompany, readDelinquent, readSale, statusLabel, taxDueField } from '../src/property/distress.js';
import { joinTracts, latestLodesYear, parseAcsTracts, parseGazetteer, parseLodes } from '../src/property/driveTime.js';
import { buildOutCandidates, companyName, edgarDocUrl, leaseSentences, readBuildOut } from '../src/property/leaseRadar.js';
import { parseProjectPage, type TabsRow } from '../src/market/developments.js';

const houston = OWNER_SOURCES.find((s) => s.county === 'Harris')!;

describe('property hash', () => {
  it('round-trips the tool, market and a picked spot', () => {
    const hash = writePropertyHash({ tool: 'drive', city: 'Austin', lat: 30.26721234, lng: -97.74309876, q: '' });
    expect(hash).toBe('#property&tool=drive&city=Austin&lat=30.26721&lng=-97.7431');
    expect(readPropertyHash(hash)).toMatchObject({ open: true, tool: 'drive', city: 'Austin', lat: 30.26721, lng: -97.7431 });
    expect(readPropertyHash('#property&tool=nope')).toMatchObject({ tool: 'owner', lat: null });
    expect(readPropertyHash('#markets').open).toBe(false);
  });
});

describe('who owns this', () => {
  it('reads the house number and the street word from a typed address', () => {
    expect(parseAddress('700 Louisiana Street, Houston, TX 77002')).toEqual({ number: '700', street: 'LOUISIANA' });
    expect(parseAddress('1000 N. Main St')).toEqual({ number: '1000', street: 'MAIN', dir: 'N' });
    expect(parseAddress('700 N St Marys St')).toEqual({ number: '700', street: 'MARYS', dir: 'N' });
    expect(parseAddress('100 West Ave')).toEqual({ number: '100', street: 'W' });
    expect(parseAddress('Hines')).toBeNull();
    expect(addressWhere(houston, "100 O'Connor Dr")).toBe(
      "(UPPER(SITE_ADDR_1) LIKE '100 CONNOR %' OR UPPER(SITE_ADDR_1) LIKE '100 CONNOR,%' OR UPPER(SITE_ADDR_1) LIKE '100 % CONNOR %' OR UPPER(SITE_ADDR_1) LIKE '100 % CONNOR' OR UPPER(SITE_ADDR_1) LIKE '100 % CONNOR,%')"
    );
  });

  it('matches the street as a whole word, the way each district pads it', () => {
    const like = (pattern: string) => new RegExp(`^${pattern.replace(/%/g, '.*')}$`);
    const patterns = [...addressWhere(houston, '1601 Elm St')!.matchAll(/LIKE '([^']+)'/g)].map((m) => like(m[1] ?? ''));
    const hits = (a: string) => patterns.some((p) => p.test(a));
    expect(hits('1601 ELM ST')).toBe(true);
    expect(hits('1601  ELM ST   ,DALLAS, TX 752012739')).toBe(true);
    expect(hits('1601 ELM,DALLAS')).toBe(true);
    expect(hits('1601 BELMONT ST, MESQUITE')).toBe(false);
    expect(hits('11601 ELM ST')).toBe(false);
  });

  it('ranks the parcel at the typed number, direction and city first', async () => {
    const { rankAddresses, addressPlace } = await import('../../site/property.js');
    expect(addressPlace('700 Louisiana St, Houston, TX 77002')).toBe('HOUSTON');
    expect(addressPlace('700 Louisiana St, 77002')).toBe('77002');
    const rows = [{ address: '700 S SAINT MARYS ST' }, { address: '700 N ST MARYS ST' }];
    expect(rankAddresses(rows, '700 N St Marys').map((r) => r.address)).toEqual(['700 N ST MARYS ST', '700 S SAINT MARYS ST']);
    const mains = [{ address: '1000 MAIN ST BAYTOWN' }, { address: '1000 MAIN ST HOUSTON 77002' }];
    expect(rankAddresses(mains, '1000 Main St', 'Houston')[0]?.address).toBe('1000 MAIN ST HOUSTON 77002');
  });

  it('builds owner queries with quotes escaped', () => {
    expect(ownerWhere(houston, { owner: "O'Brien Holdings LLC" })).toBe("UPPER(OWNER_LIST) = 'O''BRIEN HOLDINGS LLC'");
    expect(ownerWhere(houston, { mailLine: '700 Louisiana St Ste 225' })).toBe("UPPER(MAIL_ADDR_1) = '700 LOUISIANA ST STE 225'");
    expect(ownerLikeWhere(houston, 'Hines REIT')).toBe(
      "(UPPER(OWNER_LIST) LIKE 'HINES%' OR UPPER(OWNER_LIST) LIKE '% HINES%') AND (UPPER(OWNER_LIST) LIKE 'REIT%' OR UPPER(OWNER_LIST) LIKE '% REIT%')"
    );
  });

  it('searches owners by the distinctive words and lists companies first', async () => {
    const { ownerWords, rankOwners } = await import('../../site/property.js');
    expect(ownerWords('Lincoln Property Company')).toEqual(['LINCOLN']);
    expect(ownerWords('The Properties LLC')).toEqual(['THE', 'PROPERTIES', 'LLC']);
    const rows = [{ owner: 'HINES TODD' }, { owner: 'HINESTROZA MARIA' }, { owner: 'HINES REIT 2100 ROSS LP' }];
    expect(rankOwners(rows, 'Hines')[0]?.owner).toBe('HINES REIT 2100 ROSS LP');
  });

  it('tells companies from people and cleans the name for the state lookup', () => {
    expect(isEntity('HOUSTON PT BAC OFFICE LIMITED PARTNERSHIP')).toBe(true);
    expect(isEntity('SMITH JOHN & MARY')).toBe(false);
    expect(entityName('ACME PROPERTIES LLC % TAX DEPT')).toBe('ACME PROPERTIES LLC');
    expect(new URL(franchiseUrl('Acme Properties, LLC')).searchParams.get('$where')).toBe("upper(taxpayer_name) like 'ACME%PROPERTIES%'");
    expect(sameEntity('ACME PROPERTIES, L.L.C.', 'Acme Properties LLC')).toBe(true);
  });

  it('reads each district into one shape', () => {
    const dallas = OWNER_SOURCES.find((s) => s.county === 'Dallas')!;
    const p = dallas.read({ Prop_ID: '264', OWNER_NAME: 'ACME LLC', NAME_CARE: ' ', SITUS_ADDR: '1200  WINDING BROOK DR   ,GARLAND (DALLAS CO), TX 750442431', MAIL_LINE1: '735 PHEASANT RUN DR', MAIL_CITY: 'MURPHY', MAIL_STAT: 'TEXAS', MAIL_ZIP: '750943890', MKT_VALUE: 130000, LEGAL_AREA: '0.2109 a', DATE_ACQ: 20250801 });
    expect(p).toMatchObject({ account: '264', owner: 'ACME LLC', mail: '735 PHEASANT RUN DR, MURPHY, TEXAS, 75094', value: 130000, landSqft: 9187, acquired: '2025-08-01' });
    expect(p.address).toBe('1200 WINDING BROOK DR, GARLAND (DALLAS CO), TX 75044');
  });
});

describe('drive time', () => {
  const square = { type: 'Polygon', coordinates: [[[-1, -1], [1, -1], [1, 1], [-1, 1], [-1, -1]], [[-0.2, -0.2], [0.2, -0.2], [0.2, 0.2], [-0.2, 0.2], [-0.2, -0.2]]] };
  it('counts tracts inside an area, holes excluded', () => {
    expect(inGeometry(0.5, 0.5, square)).toBe(true);
    expect(inGeometry(0, 0, square)).toBe(false);
    expect(inGeometry(2, 0, square)).toBe(false);
    const tracts: [number, number, number, number][] = [[0.5, 0.5, 100, 10], [0, 0, 50, 5], [5, 5, 1, 1]];
    expect(sumInside(tracts, square)).toEqual({ people: 100, jobs: 10, tracts: 1 });
    expect(sumInside(tracts, { type: 'MultiPolygon', coordinates: [square.coordinates] })).toEqual({ people: 100, jobs: 10, tracts: 1 });
  });

  it('draws a fallback circle and reads isochrones smallest first', () => {
    const c = circle(30, -97, 10);
    expect(inGeometry(-97, 30.1, c)).toBe(true);
    expect(inGeometry(-97, 30.2, c)).toBe(false);
    const rings = readIsochrones({ features: [{ properties: { contour: 30 }, geometry: square }, { properties: { contour: 10 }, geometry: square }] });
    expect(rings.map((r) => r.minutes)).toEqual([10, 30]);
  });

  it('joins gazetteer points, ACS people and LODES jobs by tract', () => {
    const points = parseGazetteer('USPS\tGEOID\tALAND\tINTPTLAT\tINTPTLONG\nTX\t48201100000\t1\t29.76049\t-95.36981\nTX\t48201100100\t1\t29.7\t-95.3\n');
    const people = parseAcsTracts([['B01003_001E', 'state', 'county', 'tract'], ['4000', '48', '201', '100000'], ['-666666666', '48', '201', '100100']]);
    const jobs = parseLodes('w_geocode,C000,CA01\n482011000001000,25,1\n482011000001001,5,0\n');
    expect(joinTracts(points, people, jobs)).toEqual([[29.7605, -95.3698, 4000, 30]]);
    expect(latestLodesYear('<a>tx_wac_S000_JT00_2022.csv.gz</a><a>tx_wac_S000_JT00_2023.csv.gz</a>')).toBe(2023);
  });
});

describe('lease radar', () => {
  const row = (name: string, facility: string | null, work = 9002, cost = 5e6): TabsRow => ({
    ProjectNumber: name, ProjectName: name, FacilityName: facility, TypeOfWork: work, EstimatedCost: cost,
    ProjectCreatedOn: '2026-05-01', ProjectStatus: 3005, City: 1, EstimatedStartDate: null, EstimatedEndDate: null
  });
  it('keeps renovations that could be a tenant moving in', () => {
    const kept = buildOutCandidates([row('Mayer Brown', 'TC Energy Center'), row('Lift Station Rehab', null), row('New HQ', null, 9001), row('Roof replacement', 'Tower')]);
    expect(kept.map((r) => r.ProjectName)).toEqual(['Mayer Brown']);
  });

  it('reads a build-out page', () => {
    const html = `<div>PROJECT</div><div>Location Address:</div><div>700 Louisiana St</div><div>Houston, TX 77002</div>
      <div>Type of Funds:</div><div>This project is privately funded, on private land for private use.</div>
      <div>Scope of Work:</div><div>Tenant interior build-out of approximately 60,000 SF on Levels 34-36.</div>
      <div>Square Footage:</div><div>60,000 ft 2</div><div>Are the private funds provided by the tenant?</div><div>Yes</div>
      <div>OWNER</div><div>Owner Name:</div><div>Houston PT BAC Office Limited Partnership</div>
      <div>DESIGN FIRM</div><div>Design Firm Name:</div><div>Kirksey</div>`;
    expect(readBuildOut(parseProjectPage(html))).toMatchObject({
      address: '700 Louisiana St, Houston, TX 77002', squareFeet: 60000, landlord: 'Houston PT BAC Office Limited Partnership', designFirm: 'Kirksey', isBuildOut: true
    });
  });

  it('finds the lease sentence and year in a 10-K', () => {
    const now = new Date('2026-10-06');
    const text = 'Our offices are leased. Our corporate headquarters in Houston, Texas consists of 120,000 square feet under a lease that expires in March 2029. We believe our facilities are adequate. Our former lease in Houston, Texas expired in 2019 and was not renewed.';
    expect(leaseSentences(text, 'Houston', now)).toEqual([{ sentence: 'Our corporate headquarters in Houston, Texas consists of 120,000 square feet under a lease that expires in March 2029.', year: 2029 }]);
    expect(edgarDocUrl({ _id: '0001437749-26-020323:frd10k.htm', _source: { ciks: ['0000039092'], display_names: [], file_date: '' } })).toBe('https://www.sec.gov/Archives/edgar/data/39092/000143774926020323/frd10k.htm');
    expect(companyName('FRIEDMAN INDUSTRIES INC  (FRD)  (CIK 0000039092)')).toBe('Friedman Industries Inc');
  });
});

describe('distress', () => {
  it('reads tax sale listings and drops cancelled ones', () => {
    const base = { uid: 1, county: 'HARRIS COUNTY', prop_address_one: '1307 TOWNHOUSE LN', prop_city: 'PASADENA', prop_zipcode: '77502-1234', value: '1182895.00', minimum_bid: '375015.65', sale_date_only: '2026-11-03', status: 'Scheduled for Auction', sale_type: 'SALE', geometry: { coordinates: [-95.2, 29.7] as [number, number] } };
    expect(readSale(base, 'Houston', 'Harris')).toMatchObject({ address: '1307 Townhouse Ln', place: 'Pasadena', zip: '77502', value: 1182895, minimumBid: 375016, saleDate: '2026-11-03', status: 'Courthouse auction', lat: 29.7 });
    expect(readSale({ ...base, status: 'Cancelled' }, 'Houston', 'Harris')).toBeNull();
    expect(statusLabel({ uid: 2, county: '', sale_type: 'STRUCK OFF', status: 'Available for Future Sale' })).toBe('Struck off (county-owned)');
  });

  it('keeps commercial delinquent accounts and leaves people unnamed', () => {
    expect(taxDueField(['Owner', 'HCTO_Tax_P_I_02_12_2026'])).toEqual({ field: 'HCTO_Tax_P_I_02_12_2026', asOf: '2026-02-12' });
    const a = { state_class: 'F1', Owner: 'J KARAM II INC', Address: '1307 TOWNHOUSE LN PASADENA', HCAD_NUM: '1215250010001', HCAD_Value: 1182895, HCTO_Tax_P_I_02_12_2026: 375015.65, Years_Count: 9 };
    expect(readDelinquent(a, 'HCTO_Tax_P_I_02_12_2026')).toMatchObject({ owner: 'J KARAM II INC', taxDue: 375016, yearsDue: 9, code: 'F1' });
    expect(readDelinquent({ ...a, Owner: 'SMITH JANE' }, null)?.owner).toBeNull();
    expect(readDelinquent({ ...a, state_class: 'A1' }, null)).toBeNull();
    expect(isCompany('FIRST BAPTIST CHURCH')).toBe(true);
  });

  it('lists scheduled sales first', () => {
    const sales = [{ city: 'Houston', saleDate: null, value: 9 }, { city: 'Houston', saleDate: '2026-11-03', value: 1 }, { city: 'Dallas', saleDate: '2026-10-07', value: 1 }];
    expect(filterSales(sales, { city: 'Houston' }).map((s) => s.saleDate)).toEqual(['2026-11-03', null]);
    expect(filterSales(sales, { scheduledOnly: true }).map((s) => s.city)).toEqual(['Dallas', 'Houston']);
  });
});

describe('deal of the week', () => {
  const item = (title: string, source = 'The Business Journals') => ({ title: `${title} - ${source}`, link: `https://example.com/${encodeURIComponent(title)}`, source, sourceUrl: null, publishedAt: '2026-10-05T12:00:00Z' });

  it('reads prices, sizes and property types from headlines', () => {
    expect(readPrice('Landmark Galleria Skyscraper Sells for $300 Million')).toBe(300_000_000);
    expect(readPrice('Eldridge Place Campus Sold for $155M')).toBe(155_000_000);
    expect(readPrice('Plano apartment complex sells for $37.75 million')).toBe(37_750_000);
    expect(readPricePerSqft('Hines snags Downtown Austin office high-rise for $733 per sf')).toBe(733);
    expect(readSize('High Street Buys 1 Million-SF Project in Houston').squareFeet).toBe(1_000_000);
    expect(readSize('Dallas complex with 312 units sells').units).toBe(312);
    expect(dealType('Two Mesquite shopping centers sold for $45 million')).toBe('retail');
    expect(dealType('Downtown Austin Tower Sold for $208 Million')).toBe('office');
  });

  it('places the property in Texas, not the buyer', () => {
    expect(texasPlace('Downtown Austin Tower Sold for $208 Million')?.city).toBe('Austin');
    expect(texasPlace('Luxury multifamily property in Austin, Texas, sells for $86 million')?.city).toBe('Austin');
    expect(texasPlace('Plano apartment complex sells for $37.75 million')?.city).toBe('Dallas');
    expect(texasPlace('Dallas firm acquires Miami Beach retail building for $18.4 million')).toBeNull();
    expect(texasPlace('Kohler spends $14 million on Wedgewood-Houston warehouse')).toBeNull();
  });

  it('keeps priced Texas sales, biggest first', () => {
    const found = candidates([
      item('Downtown Austin Tower Sold for $208 Million', 'Realty News Report'),
      item('Houston multifamily complex sells for $39 million', 'CoStar'),
      item('Shell puts longtime Houston headquarters on the market for $325M', 'Houston Chronicle'),
      item('Sunflower Bank sells $890 million in multifamily loans to Brookfield', 'CoStar'),
      item('Dallas firm acquires Miami Beach retail building for $18.4 million', 'CoStar'),
      item("Cousins Properties Sells Austin's One Eleven Congress For $208M", 'Bisnow')
    ]);
    expect(found.map((c) => [c.place, c.price])).toEqual([['Austin', 208_000_000], ['Houston', 39_000_000]]);
  });

  it('dates the week and takes an override with real figures', () => {
    expect(weekOf(new Date('2026-10-06T15:00:00Z'))).toBe('2026-10-05');
    expect(weekOf(new Date('2026-10-11T15:00:00Z'))).toBe('2026-10-05');
    const deal = readOverride([{ week: '2026-10-05', title: 'One Eleven Congress sells', url: 'https://x', price: 208e6, capRate: 7.1, why: 'Bought below replacement cost.' }], '2026-10-05');
    expect(deal).toMatchObject({ curated: true, capRate: 7.1, type: 'other' });
    expect(readOverride([{ week: '2026-09-28', title: 't', url: 'u', price: 1 }], '2026-10-05')).toBeNull();
  });

  it('walks the numbers: implied income, the loan and leverage', () => {
    const file = { assumptions: ASSUMED_CAP_RATES, treasury: { value: 4.2, date: '2026-10-02' } };
    const deal = { type: 'office', price: 100e6, capRate: null, noi: null, squareFeet: 500_000, pricePerSqft: null, units: null };
    const steps = dealSteps(deal, file, analyzeDeal)!;
    expect(steps.cap).toBe(8);
    expect(steps.noi).toBe(8e6);
    expect(steps.rate).toBe(6.2);
    expect(steps.perSqft).toBe(200);
    expect(steps.loan.amount).toBe(60e6);
    expect(steps.loan.leverage).toBe('positive');
    const apartments = dealSteps({ ...deal, type: 'multifamily' }, file, analyzeDeal)!;
    expect(apartments.loan.leverage).toBe('negative');
    expect(dealSteps({ ...deal, type: 'land' }, file, analyzeDeal)!.noi).toBeNull();
  });
});

describe('lease radar merging and deal filters', () => {
  it('merges a tenant that files each floor separately', async () => {
    const { mergeMoves } = await import('../src/property/leaseRadar.js');
    const base = { id: '1', city: 'Houston' as const, place: null, building: '6 Pines', address: '10001 Six Pines Drive, The Woodlands, TX 77380', cost: 1e6, registered: '2026-01-01', start: '2026-02-01', landlord: null, designFirm: null, scope: null, url: '' };
    const merged = mergeMoves([
      { ...base, tenant: '6 Pines - Beusa - Level 4', squareFeet: 23538, end: '2026-10-20' },
      { ...base, id: '2', tenant: '6 Pines - Beusa - Level 7', squareFeet: 24085, end: '2026-12-15' },
      { ...base, id: '3', tenant: 'Other Co', squareFeet: 15000, end: '2026-11-01' }
    ]);
    expect(merged.map((m) => [m.squareFeet, m.end])).toEqual([[47623, '2026-12-15'], [15000, '2026-11-01']]);
  });

  it('skips headlines that are not a property sale', () => {
    const item = (title: string) => ({ title, link: 'https://x/' + encodeURIComponent(title), source: '', sourceUrl: null, publishedAt: null });
    const found = candidates([
      item('Homrich Berg buys $700M healthcare-focused RIA in Texas push'),
      item('What $5 Million To $10 Million Buys You In The Woodlands, a Land Where Mansions Rule'),
      item('Williams Tower Sells for $300M in Major Houston Office Deal'),
      item('Blackstone buys $900M industrial portfolio in Texas')
    ]);
    expect(found.map((c) => c.price)).toEqual([300_000_000, 900_000_000]);
  });
});

describe('lease radar noise', () => {
  it('drops data centers, store remodels and hospitals', async () => {
    const { buildOutCandidates } = await import('../src/property/leaseRadar.js');
    const row = (ProjectName: string) => ({ ProjectNumber: ProjectName, ProjectName, FacilityName: null, TypeOfWork: 9002, EstimatedCost: 1e6 });
    const kept = buildOutCandidates(['DFW37 Data Hall 3', 'CyrusOne CDC4', 'Target T-1234 Remodel', 'UTMB Clinic Fit-out', 'Planet Fitness', 'Acme Corp Level 12 Tenant Finish-Out'].map(row) as never);
    expect(kept.map((r) => r.ProjectName)).toEqual(['Acme Corp Level 12 Tenant Finish-Out']);
  });
});

describe('distress trimming', () => {
  it('keeps every dated auction and the top unscheduled listings per market', async () => {
    const { trimSales } = await import('../src/property/distress.js');
    const sale = (id: string, saleDate: string | null, value: number) => ({ id, city: 'Houston', county: 'Harris', address: id, place: null, zip: null, saleDate, status: '', value, minimumBid: null, cause: null, notes: null, lat: null, lng: null, url: null });
    const kept = trimSales([sale('a', '2026-11-03', 1), sale('b', null, 5), sale('c', null, 50), sale('d', null, 20)] as never, 2);
    expect(kept.map((s) => s.id)).toEqual(['a', 'c', 'd']);
  });
});

describe('lease radar order', () => {
  it('puts upcoming move-ins first, then recent ones, then undated', async () => {
    const { filterMoves } = await import('../../site/property.js');
    const m = (id: string, end: string | null) => ({ id, city: 'Dallas', end, squareFeet: 1 });
    const order = filterMoves([m('past-old', '2026-03-01'), m('none', null), m('soon', '2026-11-01'), m('later', '2027-02-01'), m('past-new', '2026-09-01')], '', '2026-10-06');
    expect(order.map((x) => x.id)).toEqual(['soon', 'later', 'past-new', 'past-old', 'none']);
  });
});

describe('tax sale links', () => {
  it('links only a map, never the auction site', async () => {
    const { saleLinks } = await import('../../site/property.js');
    const base = { address: '3140 Helmet St', place: 'Irving', zip: '75060', lat: 32.81218, lng: -96.9886 };
    expect(saleLinks({ ...base, url: 'https://dallas.texas.sheriffsaleauctions.com/index.cfm?RDR=C1000335276' })).toEqual([
      { label: 'Map', url: 'https://www.google.com/maps/search/?api=1&query=32.81218%2C-96.9886' }
    ]);
    const noPoint = saleLinks({ ...base, url: null, lat: null, lng: null });
    expect(noPoint[0]?.url).toContain(encodeURIComponent('3140 Helmet St, Irving, TX, 75060'));
  });
});

describe('statewide owner lookup', () => {
  const attrs = { PROP_ID: '0011410000001', OWNER_NAME: 'MILAM HOUSTON REAL ESTATE HOLDING INC', NAME_CARE: 'Null', LEGAL_AREA: '1.4348', MKT_VALUE: '0', SITUS_ADDR: '919 MILAM ST , HOUSTON, TX 77002', MAIL_ADDR: '919 MILAM ST STE 120, , HOUSTON, TX 77002-5356', MAIL_LINE1: '919 MILAM ST STE 120', SOURCE: 'HARRIS APPRAISAL DISTRICT', DATE_ACQ: '46235', COUNTY: 'HARRIS', YEAR_BUILT: '1956', STAT_LAND_USE: 'Null', LGL_AREA_UNIT: 'Null' };

  it('asks for the whole address', async () => {
    const { isFullAddress } = await import('../../site/property.js');
    expect(isFullAddress('919 Milam St, Houston, TX 77002')).toBe(true);
    expect(isFullAddress('919 Milam St')).toBe(false);
    expect(isFullAddress('919 Milam St, Houston TX')).toBe(true);
    expect(isFullAddress('700 Louisiana Street Houston TX')).toBe(true);
    expect(isFullAddress('919 Milam St 77002')).toBe(true);
    expect(isFullAddress('Hines, Houston')).toBe(false);
  });

  it('adds the market city when only the street was typed', async () => {
    const { geocodeText, identifyUrl } = await import('../../site/property.js');
    expect(geocodeText('919 Milam St', 'Houston')).toBe('919 Milam St, Houston, TX');
    expect(geocodeText('919 Milam St, Houston', 'Dallas')).toBe('919 Milam St, Houston');
    expect(new URL(identifyUrl({ lat: 29.75, lng: -95.36 }, 30)).searchParams.get('tolerance')).toBe('30');
  });

  it('reads a state parcel map record', async () => {
    const { readStatewide } = await import('../../site/property.js');
    const p = readStatewide(attrs);
    expect(p.address).toBe('919 MILAM ST, HOUSTON, TX 77002');
    expect(p.owner).toBe('MILAM HOUSTON REAL ESTATE HOLDING INC');
    expect(p.mail).toBe('919 MILAM ST STE 120, HOUSTON, TX 77002');
    expect(p.value).toBeNull();
    expect(p.acquired).toBe('2026-08-01');
    expect(p.source).toMatchObject({ county: 'Harris', statewide: true });
  });

  it('puts the parcel with the matching house number first', async () => {
    const { pickStatewide, readGeocode } = await import('../../site/property.js');
    const next = { ...attrs, PROP_ID: '2', SITUS_ADDR: '901 MILAM ST, HOUSTON, TX 77002' };
    const picked = pickStatewide({ results: [{ attributes: next }, { attributes: attrs }, { attributes: attrs }] }, '919 Milam St, Houston, TX 77002');
    expect(picked.map((p) => p.account)).toEqual(['0011410000001', '2']);
    expect(readGeocode([{ lat: '29.75', lon: '-95.36', address: { state: 'Texas' } }])).toEqual({ lat: 29.75, lng: -95.36 });
    expect(readGeocode([{ lat: '35', lon: '-90', address: { state: 'Tennessee' } }])).toBeNull();
  });
});

describe('statewide record cleanup', () => {
  it('drops a blank city, a zero ZIP and a repeated owner name', async () => {
    const { readStatewide } = await import('../../site/property.js');
    const p = readStatewide({ SITUS_ADDR: '500 W TEXAS AV,, TX 000000', OWNER_NAME: 'TALL CITY TOWERS LLC', NAME_CARE: 'TALL CITY TOWERS LLC', COUNTY: 'MIDLAND' });
    expect(p.address).toBe('500 W TEXAS AV');
    expect(p.owner).toBe('TALL CITY TOWERS LLC');
  });
});
