import { describe, expect, it } from 'vitest';
import { countyMarkets, fetchBids, pickBids, TXDOT_PROJECTS_PAGE, txdotBid, txdotBids, type Bid, type TxdotProjectRow } from '../src/market/bids.js';
import { rolesOn } from '../../site/growth.js';

const NOW = new Date('2026-10-08T16:00:00Z');
const markets = countyMarkets(['Fort Worth', 'Dallas', 'Austin', 'Houston', 'Galveston']);

// Shapes from TxDOT's Project Information dataset (data.texas.gov drau-zphx), October 2026.
const row: TxdotProjectRow = {
  project_name: 'IH 35W PM 2611-1',
  county: 'Tarrant',
  district_division: 'Fort Worth',
  let_type_description: 'Statewide Let',
  bid_received_until_date_and: '2026-11-03T13:00:00.000',
  control_section_job_csj: '6482-46-001',
  project_sub_type_description: 'Roadway'
};

describe('TxDOT bids', () => {
  it('maps counties to their market', () => {
    expect(markets.get('tarrant')).toEqual(['Fort Worth']);
    expect(markets.get('galveston')).toEqual(['Houston', 'Galveston']);
    expect(markets.get('bexar')).toBeUndefined();
    expect(txdotBids({ ...row, county: 'Galveston' }, markets, NOW).map((b) => b.city)).toEqual(['Houston', 'Galveston']);
    expect(txdotBids({ ...row, county: 'Bexar' }, markets, NOW)).toEqual([]);
  });

  it('reads an open bid with its agency, due time and CSJ', () => {
    expect(txdotBid(row, 'Fort Worth', NOW)).toEqual({
      city: 'Fort Worth',
      title: 'IH 35W PM 2611-1',
      agency: 'TxDOT Fort Worth District',
      due: '2026-11-03T13:00',
      county: 'Tarrant',
      csj: '6482-46-001',
      url: TXDOT_PROJECTS_PAGE
    });
    expect(txdotBid({ ...row, local_agency_name: 'City of Arlington' }, 'Fort Worth', NOW)!.agency).toBe('City of Arlington');
    expect(txdotBid({ ...row, local_agency_name: 'NA' }, 'Fort Worth', NOW)!.agency).toBe('TxDOT Fort Worth District');
  });

  it('drops closed bids, other counties and material-only orders', () => {
    expect(txdotBid({ ...row, bid_received_until_date_and: '2026-09-22T10:00:00.000' }, 'Fort Worth', NOW)).toBeNull();
    expect(txdotBids({ ...row, county: 'De Witt' }, markets, NOW)[0] ?? null).toBeNull();
    expect(txdotBid({ ...row, project_sub_type_description: 'Material Only' }, 'Fort Worth', NOW)).toBeNull();
    expect(txdotBid({ ...row, bid_received_until_date_and: undefined }, 'Fort Worth', NOW)).toBeNull();
  });

  it('keeps each market\'s soonest bids once', () => {
    const bid = (title: string, due: string, city: Bid['city'] = 'Dallas'): Bid => ({ city, title, agency: 'TxDOT', due, county: 'Dallas', csj: title, url: '' });
    const picked = pickBids([bid('c', '2026-10-20T10:00'), bid('a', '2026-10-10T10:00'), bid('a', '2026-10-10T10:00'), bid('b', '2026-10-12T10:00'), bid('x', '2026-10-09T10:00', 'Austin')], 2);
    expect(picked.map((b) => `${b.city}:${b.title}`)).toEqual(['Austin:x', 'Dallas:a', 'Dallas:b']);
  });

  it('asks the portal for open bids only and keeps the source link', async () => {
    let asked = '';
    const fetchImpl = (async (url: string) => {
      asked = url;
      return new Response(JSON.stringify([row, { ...row, county: 'Bexar' }]), { status: 200, headers: { 'content-type': 'application/json' } });
    }) as unknown as typeof fetch;
    const result = await fetchBids(['Fort Worth'], { now: NOW, fetchImpl });
    expect(decodeURIComponent(asked)).toContain("bid_received_until_date_and >= '2026-10-07T16:00:00'");
    expect(result.bids).toHaveLength(1);
    expect(result.source).toBe(TXDOT_PROJECTS_PAGE);
  });
});

describe('contractor role', () => {
  it('matches a firm that is the general contractor on a project', () => {
    expect(rolesOn('Harvey-Cleary Builders', { city: 'Austin', cost: 1, contractor: 'Harvey-Cleary Builders' })).toEqual(['Contractor']);
  });
});
