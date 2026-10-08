import { describe, expect, it } from 'vitest';
import { classifySector } from '../src/collector/sector.js';
import { adzunaUrl, DEFAULT_QUERIES, fetchAdzuna, isRealEstate } from '../src/collector/sources/adzuna.js';

describe('the rest of a deal: lending, title, tax, accounting', () => {
  it('files each kind of seat', () => {
    expect(classifySector('Commercial Credit Analyst', 'Underwrite commercial real estate loans.').sector).toBe('Lending');
    expect(classifySector('Construction Loan Administrator').sector).toBe('Lending');
    expect(classifySector('Commercial Escrow Assistant').sector).toBe('Title & Escrow');
    expect(classifySector('Title Examiner Trainee', 'Commercial title commitments.').sector).toBe('Title & Escrow');
    expect(classifySector('Property Tax Consultant', 'Protest values with the appraisal district.').sector).toBe('Property Tax');
    expect(classifySector('Property Accountant', 'CAM reconciliations and month-end close.').sector).toBe('Finance & Accounting');
    expect(classifySector('Fund Accountant').sector).toBe('Finance & Accounting');
  });

  it('leaves the existing sectors alone', () => {
    expect(classifySector('Acquisitions Analyst', 'Underwriting multifamily acquisitions.').sector).toBe('Investment');
    expect(classifySector('Debt Placement Analyst', 'Capital markets debt placement for clients.').sector).toBe('Capital Markets');
    expect(classifySector('Property Manager', 'Class A office property management.').sector).toBe('Property Mgmt');
  });

  it('takes commercial lending, title and tax jobs from Adzuna but not home loans', () => {
    expect(isRealEstate('Commercial Loan Officer', 'CRE loans across Texas')).toBe(true);
    expect(isRealEstate('Commercial Escrow Officer', 'Title company closing office buildings')).toBe(true);
    expect(isRealEstate('Property Tax Analyst', 'Ad valorem protests')).toBe(true);
    expect(isRealEstate('Mortgage Loan Officer', 'Help families buy homes. Real estate.')).toBe(false);
  });

  it('searches them within the same eight calls a pass', async () => {
    const pages = DEFAULT_QUERIES.reduce((n, q) => n + (q.pages ?? 1), 0);
    expect(pages).toBeLessThanOrEqual(8);
    expect(DEFAULT_QUERIES.some((q) => /escrow/.test(q.what_or ?? ''))).toBe(true);
    const url = new URL(adzunaUrl({ appId: 'a', appKey: 'b' }, DEFAULT_QUERIES[0]!, 1, 30));
    expect(url.searchParams.has('pages')).toBe(false);
    let calls = 0;
    const fetchImpl = (async () => {
      calls++;
      return new Response(JSON.stringify({ results: Array.from({ length: 50 }, () => ({})) }), { status: 200 });
    }) as typeof fetch;
    await fetchAdzuna({ appId: 'a', appKey: 'b' }, { fetchImpl });
    expect(calls).toBe(8);
  });
});
