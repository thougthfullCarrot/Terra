import { describe, expect, it } from 'vitest';
import {
  cushmanCities,
  cushmanPdfs,
  fetchResearch,
  keepResearch,
  parseMarketBeat,
  parsePartnersReport,
  partnersLinks,
  type Research
} from '../src/market/research.js';

const index = `
  <a href="https://partnersrealestate.com/research/dallas-office-q2-2026-quarterly-market-report/">x</a>
  <a href="https://partnersrealestate.com/research/dallas-industrial-q1-2026-quarterly-market-report/">x</a>
  <a href="https://partnersrealestate.com/research/dallas-industrial-q2-2026-quarterly-market-report/">x</a>
  <a href="https://partnersrealestate.com/research/san-antonio-retail-q2-2026-quarterly-market-report/">x</a>
  <a href="https://partnersrealestate.com/research/atlanta-office-q2-2026-quarterly-market-report/">x</a>`;

const report = (summary: string) => `<html><body><h1>Dallas Office | Q2 2026</h1>
  <a href="https://partnersrealestate.com/wp-content/uploads/2025/03/IABS-DFW-v20250210.pdf">IABS</a>
  <a href="https://partnersrealestate.com/wp-content/uploads/2026/05/Q2-26_DFW_Office_QuarterlyReport.pdf">Download the PDF</a>
  <h2>EXECUTIVE SUMMARY</h2><p>${summary}</p></body></html>`;

const austinOffice =
  '© 2026 Cushman & Wakefield 1 SPACE DEMAND / DELIVERIES OVERALL VACANCY & ASKING RENT MARKET FUNDAMENTALS ECONOMIC INDICATORS YOY Chg Outlook 26.9% Vacancy Rate - 154K YTD Net Absorption, SF $49.27 Asking Rent, PSF (Overall, All Property Classes) 1.4M Austin Employment* M A R K E T B E AT OFFICE Q2 2026 AUSTIN';
const elPaso =
  '10.3% Vacancy Rate 2.2 M YTD Net Absorption, SF $8.25 Asking Rent, PSF (Overall, Net Asking Rent) 364K El Paso Employment INDUSTRIAL Q2 2026 EL PASO, TEXAS';

describe('Partners reports', () => {
  it('keeps the newest Texas report per city and type', () => {
    const links = partnersLinks(index);
    expect(links.map((l) => `${l.city} ${l.type} Q${l.quarter}`).sort()).toEqual(['Dallas industrial Q2', 'Dallas office Q2', 'San Antonio retail Q2']);
  });

  it('reads vacancy and asking rent from the executive summary', () => {
    expect(
      parsePartnersReport(
        report('Net absorption improved. Vacancy edged down to 24.5%, a 80-basis-point decrease from Q1 2026. Rental rates increased 1.8% quarterly to $33.91 per sq. ft.')
      )
    ).toEqual({ vacancy: 24.5, rent: 33.91, pdf: 'https://partnersrealestate.com/wp-content/uploads/2026/05/Q2-26_DFW_Office_QuarterlyReport.pdf' });
    expect(parsePartnersReport(report('The vacancy rate dropped 24 basis points to 7.4%. Rental rates decreased 2.8% quarterly to $9.73 per sq. ft.'))).toMatchObject({
      vacancy: 7.4,
      rent: 9.73
    });
    expect(parsePartnersReport(report('Vacancy held but remains tight at 4.1%. The average asking rental rate was down 0.8% quarter over quarter to $19.27 per square foot.'))).toMatchObject({
      vacancy: 4.1,
      rent: 19.27
    });
    expect(parsePartnersReport('<p>No summary here.</p>')).toEqual({ vacancy: null, rent: null, pdf: null });
  });
});

describe('Cushman & Wakefield MarketBeats', () => {
  it('reads type, quarter and market from PDF links', () => {
    const pdfs = cushmanPdfs(`
      <a href="https://assets.cushmanwakefield.com/-/media/cw/marketbeat-pdfs/2026/q2/us-reports/office/austin_americas_marketbeat_office_q22026.pdf?rev=2b6">o</a>
      <a href="https://assets.cushmanwakefield.com/-/media/cw/marketbeat-pdfs/2026/q2/us-reports/industrial/sanantonio_americas_marketbeat_industrial_q22026.pdf">i</a>
      <a href="https://assets.cushmanwakefield.com/-/media/cw/marketbeat-pdfs/2026/q2/us-reports/industrial/el-paso_americas_alliance_marketbeat_industrial_q2-2026.pdf">e</a>`);
    expect(pdfs.map((p) => [p.type, p.year, p.quarter, p.market])).toEqual([
      ['office', 2026, 2, 'austin'],
      ['industrial', 2026, 2, 'sanantonio'],
      ['industrial', 2026, 2, 'elpaso']
    ]);
    expect(cushmanCities(pdfs[1]!, { cities: ['San Antonio'] })).toEqual(['San Antonio']);
    expect(cushmanCities({ ...pdfs[0]!, market: 'fortworth' }, { cities: ['Dallas', 'Fort Worth'] })).toEqual(['Fort Worth']);
    expect(cushmanCities({ ...pdfs[0]!, market: 'dfw' }, { cities: ['Dallas', 'Fort Worth'] })).toEqual(['Dallas', 'Fort Worth']);
  });

  it('reads the headline box', () => {
    expect(parseMarketBeat(austinOffice)).toEqual({ vacancy: 26.9, rent: 49.27, rentBasis: 'full service', period: 'Q2 2026' });
    expect(parseMarketBeat(elPaso)).toEqual({ vacancy: 10.3, rent: 8.25, rentBasis: 'net', period: 'Q2 2026' });
  });
});

describe('fetchResearch', () => {
  it('combines both firms and adds the linked-only pages', async () => {
    const pages: Record<string, string> = {
      'https://partnersrealestate.com/research/': index,
      'https://partnersrealestate.com/research/dallas-office-q2-2026-quarterly-market-report/': report('Vacancy edged down to 24.5%. Rental rates increased 1.8% quarterly to $33.91 per sq. ft.'),
      'https://www.cushmanwakefield.com/en/united-states/insights/us-marketbeats/austin-marketbeats':
        '<a href="https://assets.cushmanwakefield.com/-/media/cw/marketbeat-pdfs/2026/q2/us-reports/office/austin_americas_marketbeat_office_q22026.pdf">o</a>'
    };
    const research = await fetchResearch({
      cities: ['Dallas', 'Austin'],
      fetchText: async (url) => {
        if (pages[url]) return pages[url];
        throw new Error('404');
      },
      pdfText: async () => austinOffice
    });
    expect(research.leases).toEqual([
      expect.objectContaining({ city: 'Dallas', type: 'office', broker: 'Partners', vacancy: 24.5, rent: 33.91, period: 'Q2 2026' }),
      expect.objectContaining({ city: 'Austin', type: 'office', broker: 'Cushman & Wakefield', vacancy: 26.9, rent: 49.27, rentBasis: 'full service' })
    ]);
    expect(research.reports.some((r) => r.broker === 'CBRE' && r.city === 'Austin')).toBe(true);
    expect(research.reports.some((r) => r.broker === 'Partners' && r.type === 'industrial')).toBe(false); // its page failed
  });

  it('keeps last build\'s figures for anything this build lost', () => {
    const lease = { city: 'Dallas', type: 'office', broker: 'Partners', vacancy: 24, rent: 33, rentBasis: '', period: 'Q1 2026', url: 'u' } as const;
    const previous: Research = { leases: [lease, { ...lease, type: 'retail' }], reports: [] };
    const kept = keepResearch({ leases: [{ ...lease, vacancy: 25, period: 'Q2 2026' }], reports: [] }, previous);
    expect(kept.leases.map((l) => `${l.type} ${l.period}`)).toEqual(['office Q2 2026', 'retail Q1 2026']);
  });
});
