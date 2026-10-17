import { describe, expect, it } from 'vitest';
import { coverageNote, matchSmaller, reportError, reportRow, reportStatus } from '../../site/devreports.js';

const good = { address: '13735 IH-10 W, San Antonio, TX 78249', name: 'PDL Club', description: 'Club building under construction off IH-10', sourceUrl: 'https://example.com/pdl' };

describe('the report form', () => {
  it('builds a row from an address, or from a dropped pin alone', () => {
    expect(reportRow(good, 'San Antonio').row).toEqual({
      city: 'San Antonio',
      address: good.address,
      lat: null,
      lng: null,
      name: 'PDL Club',
      description: good.description,
      source_url: 'https://example.com/pdl'
    });
    const pinned = reportRow({ description: 'Tilt-wall going up here', pin: { lat: 29.58012345678, lng: -98.6201 } }, 'San Antonio').row;
    expect(pinned).toMatchObject({ address: null, lat: 29.580123, lng: -98.6201, name: null, source_url: null });
  });

  it('asks for a place, a description and a real link', () => {
    expect(reportRow({ description: 'Something big' }, 'Austin').errors).toEqual(['Add an address or drop a pin on the map.']);
    expect(reportRow({ ...good, description: 'short' }, 'Austin').errors[0]).toMatch(/at least 10/);
    expect(reportRow({ ...good, sourceUrl: 'javascript:alert(1)' }, 'Austin').errors[0]).toMatch(/http/);
  });

  it('turns away oversized or non-image photos', () => {
    expect(reportRow({ ...good, photo: { type: 'application/pdf', size: 10 } }, 'Austin').errors).toEqual(['Photos can be JPEG, PNG or WebP.']);
    expect(reportRow({ ...good, photo: { type: 'image/png', size: 6 * 1024 * 1024 } }, 'Austin').errors).toEqual(['Photos can be up to 5 MB.']);
  });

  it('marks a filled honeypot as spam without a row', () => {
    expect(reportRow({ ...good, website: 'http://spam' }, 'Austin')).toEqual({ spam: true, errors: [] });
  });

  it('explains the database refusals and shows each status', () => {
    expect(reportError('You can send 5 reports a day. Try again tomorrow.')).toMatch(/5 reports a day/);
    expect(reportError('duplicate key value violates unique constraint "development_reports_once"')).toBe('You already reported this place.');
    expect(reportStatus({ status: 'pending', possible_duplicate_of: 'x' })).toBe('Waiting for review (someone else reported a project here too)');
    expect(reportStatus({ status: 'approved' })).toBe('Verified and on the map');
  });
});

describe('the coverage note', () => {
  it('names the cap, the cutoff and what the map leaves out', () => {
    const text = coverageNote({ metro: { city: 'San Antonio', filings: 2984, cap: 300, cutoff: 2_769_500, complete: true }, smaller: 600, permits: 'City of San Antonio' });
    expect(text).toMatch(/pins the 300 biggest of the 2,984 current state TABS filings collected/);
    expect(text).toMatch(/under about \$2\.8M get no pin\. The smaller filings list below holds the other 600\./);
    expect(text).toMatch(/City of San Antonio building permits/);
    expect(text).toMatch(/not a complete list/);
  });

  it('says the smaller list is partial when windows below the cutoff were skipped', () => {
    const text = coverageNote({ metro: { filings: 2984, cap: 300, cutoff: 2_769_500, complete: true, reported: 3006, skippedWindows: 12 }, smaller: 600 });
    expect(text).toMatch(/TABS lists 3,006 filings of every status/);
    expect(text).toMatch(/holds only the 600 smaller ones collected along the way: .*12 search windows .* were not read in full, so it is partial/);
  });

  it('separates collected, awaiting-details, approximate and unlocated projects once every filing is listed', () => {
    const text = coverageNote({ metro: { filings: 3006, cap: 300, listed: 3120, exact: 2400, site: 90, approximate: 300, awaiting: 280, unlocated: 50, cutoff: null, complete: true } });
    expect(text).toMatch(/lists all 3,120 current state TABS filings and city permits collected for the metro.*no cost cutoff/);
    expect(text).toMatch(/2,400 are pinned at the filed address, 90 at a point from another permit at the same site, 300 near their ZIP code center \(approximate, drawn dashed\), 50 have no point yet/);
    expect(text).toMatch(/280 still await their project details/);
    expect(text).not.toMatch(/biggest|get no pin/);
  });

  it('still warns on an old snapshot and on a short read', () => {
    expect(coverageNote({})).toMatch(/not a complete list/);
    expect(coverageNote({ metro: { filings: 90, cap: 150, cutoff: null, complete: false } })).toMatch(/all 90 .*came back short/);
  });
});

describe('smaller filings search', () => {
  it('finds a filing by name or TABS number within the metro', () => {
    const list = [
      { id: 'TABS2026006871', city: 'San Antonio', name: 'PDL Club', place: 'San Antonio', cost: 1_200_000 },
      { id: 'TABS1', city: 'Austin', name: 'PDL Annex', place: 'Austin', cost: 2e6 }
    ];
    expect(matchSmaller(list, 'San Antonio', 'pdl').map((s) => s.id)).toEqual(['TABS2026006871']);
    expect(matchSmaller(list, 'San Antonio', '6871')).toHaveLength(1);
  });
});

describe('smaller filings with a page read', () => {
  it('are found by address and owner, and the note counts their pins', () => {
    const list = [{ id: 'TABS2026006871', city: 'San Antonio', name: 'PDL Club', place: 'San Antonio', cost: 1_200_000, address: '13735 IH-10 W, San Antonio, TX 78249', owner: 'PDL Partners LLC' }];
    expect(matchSmaller(list, 'San Antonio', '13735 IH-10')).toHaveLength(1);
    expect(matchSmaller(list, 'San Antonio', 'pdl partners')).toHaveLength(1);
    expect(coverageNote({ metro: { filings: 800, cap: 300, cutoff: 2_769_500, complete: true }, smaller: 500, pinned: 120 })).toMatch(/120 of the smaller filings have a small pin/);
  });
});
