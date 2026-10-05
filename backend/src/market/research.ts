import type { City } from '../types.js';

/**
 * Broker research: the free quarterly market reports brokerages publish for
 * each Texas city, and the two headline figures in them a reader looks for
 * first, vacancy and average asking rent, by property type.
 *
 * Only two firms are read automatically, both checked for robots.txt and for
 * reports anyone can open without a form:
 *
 *   Partners Real Estate   HTML report pages per city and type (Dallas, Houston, Austin, San Antonio)
 *   Cushman & Wakefield    MarketBeat PDFs per city and type (Austin, San Antonio, El Paso, and DFW/Houston when posted)
 *
 * Terra keeps only the two figures, the period and a link to the report, and
 * names the firm next to them. The other big firms (CBRE, JLL, Colliers,
 * Marcus & Millichap, Newmark) are linked, not read: Colliers' robots.txt
 * shuts out crawlers and the rest put their city reports behind a form.
 */

export type SpaceType = 'office' | 'industrial' | 'retail' | 'multifamily';
export const LEASE_TYPES: SpaceType[] = ['office', 'industrial', 'retail'];

export interface LeaseReading {
  city: City;
  type: SpaceType;
  broker: string;
  /** Percent. */
  vacancy: number | null;
  /** Dollars per square foot per year. */
  rent: number | null;
  /** How the firm quotes the rent: "full service", "net", or '' when it does not say. */
  rentBasis: string;
  /** "Q2 2026". */
  period: string;
  url: string;
}

export interface ReportLink {
  city: City;
  broker: string;
  type: SpaceType | 'all';
  /** "Q2 2026", or '' for a landing page that always holds the latest. */
  period: string;
  title: string;
  url: string;
}

export interface Research {
  leases: LeaseReading[];
  reports: ReportLink[];
}

/* ------------------------------------------------------------ Partners */

export const PARTNERS_INDEX = 'https://partnersrealestate.com/research/';

/** The cities in Partners' report slugs (dallas-office-q2-2026-quarterly-market-report). */
const PARTNERS_CITIES: Record<string, City> = {
  dallas: 'Dallas',
  'fort-worth': 'Fort Worth',
  houston: 'Houston',
  austin: 'Austin',
  'san-antonio': 'San Antonio'
};

export interface PartnersLink {
  city: City;
  type: SpaceType;
  year: number;
  quarter: number;
  url: string;
}

/** The newest report link for each city and type on Partners' research index. */
export function partnersLinks(html: string): PartnersLink[] {
  const best = new Map<string, PartnersLink>();
  const pattern = /https:\/\/partnersrealestate\.com\/research\/([a-z-]+?)-(office|industrial|retail|multifamily)-q([1-4])-(\d{4})-quarterly-market-report\/?/g;
  for (const match of html.matchAll(pattern)) {
    const city = PARTNERS_CITIES[match[1]!];
    if (!city) continue;
    const link: PartnersLink = { city, type: match[2] as SpaceType, quarter: Number(match[3]), year: Number(match[4]), url: match[0] };
    const key = `${city}|${link.type}`;
    const seen = best.get(key);
    if (!seen || link.year * 4 + link.quarter > seen.year * 4 + seen.quarter) best.set(key, link);
  }
  return [...best.values()];
}

/** Page text with tags, scripts and entities gone, on one line. */
export function pageText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;|&#160;/g, ' ')
    .replace(/&#8217;|&rsquo;/g, '’')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ');
}

/**
 * Vacancy and asking rent from a Partners report's executive summary, which
 * states both in a sentence: "Vacancy edged down to 24.5%", "Rental rates
 * increased 1.8% quarterly to $33.91 per sq. ft.".
 */
export function parsePartnersReport(html: string): { vacancy: number | null; rent: number | null; pdf: string | null } {
  const text = pageText(html);
  const start = text.search(/EXECUTIVE SUMMARY/i);
  const summary = text.slice(start >= 0 ? start : 0, (start >= 0 ? start : 0) + 2500);
  const vacancy = /vacancy[^.%]*?(\d+(?:\.\d+)?)%/i.exec(summary);
  const rent = /(?:rental rate|asking rent)[^$]{0,160}?\$(\d+(?:\.\d+)?)\s*(?:per|\/)\s*(?:sq\.?\s*ft|square foot|sf)/i.exec(summary);
  const pdf = /https:\/\/partnersrealestate\.com\/wp-content\/uploads\/[^"'\s<>]+\.pdf/i.exec(
    html.replace(/https:\/\/partnersrealestate\.com\/wp-content\/uploads\/\d{4}\/\d{2}\/IABS-[^"'\s<>]+\.pdf/gi, '')
  );
  return {
    vacancy: vacancy ? Number(vacancy[1]) : null,
    rent: rent ? Number(rent[1]) : null,
    pdf: pdf?.[0] ?? null
  };
}

/* ------------------------------------------------------------- Cushman */

export const CUSHMAN_BASE = 'https://www.cushmanwakefield.com/en/united-states/insights/us-marketbeats';

/** Cushman's MarketBeat pages per Terra city; DFW's page covers both Dallas and Fort Worth. */
export const CUSHMAN_PAGES: { slug: string; cities: City[] }[] = [
  { slug: 'dallas-ft-worth', cities: ['Dallas', 'Fort Worth'] },
  { slug: 'houston', cities: ['Houston'] },
  { slug: 'austin', cities: ['Austin'] },
  { slug: 'san-antonio', cities: ['San Antonio'] },
  { slug: 'el-paso', cities: ['El Paso'] }
];

export const cushmanPage = (slug: string, type?: SpaceType) => `${CUSHMAN_BASE}/${slug}-marketbeats${type ? `/${type}` : ''}`;

export interface CushmanPdf {
  type: SpaceType;
  year: number;
  quarter: number;
  /** The file name's market, letters only: "austin", "sanantonio", "dallas", "fortworth". */
  market: string;
  url: string;
}

/** MarketBeat PDF links on a page, with type, quarter and market read from the path. */
export function cushmanPdfs(html: string): CushmanPdf[] {
  const out = new Map<string, CushmanPdf>();
  for (const match of html.matchAll(/https:\/\/assets\.cushmanwakefield\.com\/[^"'\s<>?]+\.pdf/gi)) {
    const url = match[0];
    const path = /marketbeat-pdfs\/(\d{4})\/q([1-4])\/us-reports\/(office|industrial|retail|multifamily)\/([^/]+)\.pdf$/i.exec(url);
    if (!path) continue;
    const file = path[4]!.toLowerCase();
    const market = file.split(/_americas|_marketbeat/)[0]!.replace(/[^a-z]/g, '');
    out.set(url, { year: Number(path[1]), quarter: Number(path[2]), type: path[3]!.toLowerCase() as SpaceType, market, url });
  }
  return [...out.values()];
}

/** Which Terra city a MarketBeat file is about; a DFW-wide report counts for both cities. */
export function cushmanCities(pdf: CushmanPdf, page: { cities: City[] }): City[] {
  const m = pdf.market;
  if (/fortworth|ftworth/.test(m)) return ['Fort Worth'];
  if (/dfw|dallasf/.test(m)) return page.cities;
  if (/dallas/.test(m)) return ['Dallas'];
  for (const city of page.cities) if (m.startsWith(city.toLowerCase().replace(/[^a-z]/g, ''))) return [city];
  return page.cities.length === 1 ? page.cities : [];
}

/**
 * The headline box on a MarketBeat's first page: "26.9% Vacancy Rate",
 * "$49.27 Asking Rent, PSF (Overall, All Property Classes)" and
 * "OFFICE Q2 2026". Multifamily MarketBeats quote rent per unit, so only
 * office, industrial and retail are read.
 */
export function parseMarketBeat(text: string): { vacancy: number | null; rent: number | null; rentBasis: string; period: string } {
  const flat = text.replace(/\s+/g, ' ');
  const vacancy = /(\d+(?:\.\d+)?)\s*%\s*Vacancy Rate/i.exec(flat);
  const rent = /\$\s*(\d+(?:\.\d+)?)\s*Asking Rent,?\s*PSF\s*(?:\(([^)]*)\))?/i.exec(flat);
  const period = /\b(?:OFFICE|INDUSTRIAL|RETAIL)\s+(Q[1-4])\s+(\d{4})\b/i.exec(flat);
  const note = rent?.[2] ?? '';
  return {
    vacancy: vacancy ? Number(vacancy[1]) : null,
    rent: rent ? Number(rent[1]) : null,
    rentBasis: /net/i.test(note) ? 'net' : /full|all property classes/i.test(note) ? 'full service' : '',
    period: period ? `${period[1]!.toUpperCase()} ${period[2]}` : ''
  };
}

/* ---------------------------------------------------- Linked, not read */

/** The research pages of firms Terra links to without reading, per city where the firm has one. */
export function landingPages(cities: City[]): ReportLink[] {
  const all = (broker: string, url: string, title: string): ReportLink[] =>
    cities.map((city) => ({ city, broker, type: 'all', period: '', title, url }));
  return [
    ...all('CBRE', 'https://www.cbre.com/insights#market-reports', 'CBRE market reports (pick a city and property type)'),
    ...all('JLL', 'https://www.jll.com/en-us/insights/market-dynamics', 'JLL market dynamics research'),
    ...all('Colliers', 'https://www.colliers.com/en/research', 'Colliers research library'),
    ...all('Marcus & Millichap', 'https://www.marcusmillichap.com/research', 'Marcus & Millichap investment research (free sign-up for full reports)'),
    ...all('Transwestern', 'https://transwestern.com/market-reports', 'Transwestern market reports'),
    ...all('Lee & Associates', 'https://www.lee-associates.com/research/', 'Lee & Associates quarterly market reports')
  ];
}

export const quarterLabel = (year: number, quarter: number) => `Q${quarter} ${year}`;

export const TYPE_LABEL: Record<SpaceType | 'all', string> = {
  office: 'Office',
  industrial: 'Industrial',
  retail: 'Retail',
  multifamily: 'Multifamily',
  all: 'All property types'
};

/* --------------------------------------------------------------- Fetch */

export interface ResearchOptions {
  cities: City[];
  /** Reads a PDF's first page as text; injected in tests. */
  pdfText?: (url: string) => Promise<string>;
  fetchText?: (url: string) => Promise<string>;
  log?: (line: string) => void;
}

/** First page of a PDF as text, with pdf.js (already a dependency for resume reading). */
export async function firstPageText(url: string): Promise<string> {
  const response = await fetch(url, { headers: { 'user-agent': BROWSER }, signal: AbortSignal.timeout(60_000) });
  if (!response.ok) throw new Error(`${response.status} for ${url}`);
  const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const doc = await getDocument({ data: new Uint8Array(await response.arrayBuffer()), verbosity: 0 }).promise;
  const content = await (await doc.getPage(1)).getTextContent();
  await doc.destroy();
  return content.items.map((item) => ('str' in item ? item.str : '')).join(' ');
}

const BROWSER = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36';

async function plainFetch(url: string): Promise<string> {
  const response = await fetch(url, { headers: { 'user-agent': BROWSER, accept: 'text/html' }, signal: AbortSignal.timeout(45_000) });
  if (!response.ok) throw new Error(`${response.status} for ${url}`);
  return response.text();
}

/**
 * Every lease figure and report link the two firms answer with. A firm that
 * fails is logged and skipped; the caller keeps the previous build's figures
 * for anything missing.
 */
export async function fetchResearch(options: ResearchOptions): Promise<Research> {
  const get = options.fetchText ?? plainFetch;
  const pdfText = options.pdfText ?? firstPageText;
  const log = options.log ?? (() => {});
  const wanted = new Set(options.cities);
  const leases: LeaseReading[] = [];
  const reports: ReportLink[] = [];

  try {
    const links = partnersLinks(await get(PARTNERS_INDEX)).filter((l) => wanted.has(l.city));
    for (const link of links) {
      const period = quarterLabel(link.year, link.quarter);
      try {
        const report = parsePartnersReport(await get(link.url));
        const title = `${link.city} ${TYPE_LABEL[link.type].toLowerCase()} quarterly market report`;
        reports.push({ city: link.city, broker: 'Partners', type: link.type, period, title, url: link.url });
        if (LEASE_TYPES.includes(link.type) && (report.vacancy != null || report.rent != null))
          leases.push({ city: link.city, type: link.type, broker: 'Partners', vacancy: report.vacancy, rent: report.rent, rentBasis: '', period, url: link.url });
      } catch (error) {
        log(`Partners: ${link.url}: ${error instanceof Error ? error.message : error}`);
      }
    }
    log(`Partners: ${links.length} reports, ${leases.length} with figures.`);
  } catch (error) {
    log(`Partners: index failed: ${error instanceof Error ? error.message : error}`);
  }

  const before = leases.length;
  for (const page of CUSHMAN_PAGES) {
    if (!page.cities.some((c) => wanted.has(c))) continue;
    const found = new Map<string, CushmanPdf>();
    for (const type of [undefined, ...LEASE_TYPES, 'multifamily' as const]) {
      try {
        for (const pdf of cushmanPdfs(await get(cushmanPage(page.slug, type)))) found.set(pdf.url, pdf);
      } catch {
        // Not every city has every type page.
      }
    }
    // The newest quarter per market and type.
    const newest = new Map<string, CushmanPdf>();
    for (const pdf of found.values()) {
      const key = `${pdf.market}|${pdf.type}`;
      const seen = newest.get(key);
      if (!seen || pdf.year * 4 + pdf.quarter > seen.year * 4 + seen.quarter) newest.set(key, pdf);
    }
    for (const pdf of newest.values()) {
      const cities = cushmanCities(pdf, page).filter((c) => wanted.has(c));
      if (!cities.length) continue;
      const period = quarterLabel(pdf.year, pdf.quarter);
      let figures: ReturnType<typeof parseMarketBeat> | null = null;
      if (LEASE_TYPES.includes(pdf.type)) {
        try {
          figures = parseMarketBeat(await pdfText(pdf.url));
        } catch (error) {
          log(`Cushman & Wakefield: ${pdf.url}: ${error instanceof Error ? error.message : error}`);
        }
      }
      for (const city of cities) {
        reports.push({ city, broker: 'Cushman & Wakefield', type: pdf.type, period, title: `${TYPE_LABEL[pdf.type]} MarketBeat (PDF)`, url: pdf.url });
        if (figures && (figures.vacancy != null || figures.rent != null))
          leases.push({ city, type: pdf.type, broker: 'Cushman & Wakefield', vacancy: figures.vacancy, rent: figures.rent, rentBasis: figures.rentBasis, period: figures.period || period, url: pdf.url });
      }
    }
    for (const city of page.cities.filter((c) => wanted.has(c)))
      reports.push({ city, broker: 'Cushman & Wakefield', type: 'all', period: '', title: 'MarketBeat reports for this market', url: cushmanPage(page.slug) });
  }
  log(`Cushman & Wakefield: ${leases.length - before} figures.`);

  reports.push(...landingPages(options.cities));
  return { leases, reports };
}

/** This build's figures, with any city, type and firm it lost since the last build kept from that one. */
export function keepResearch(current: Research, previous: Research | null | undefined): Research {
  if (!previous) return current;
  const key = (l: LeaseReading) => `${l.city}|${l.type}|${l.broker}`;
  const have = new Set(current.leases.map(key));
  const leases = [...current.leases, ...previous.leases.filter((l) => !have.has(key(l)))];
  const rkey = (r: ReportLink) => `${r.city}|${r.type}|${r.broker}`;
  const haveReports = new Set(current.reports.map(rkey));
  const reports = [...current.reports, ...previous.reports.filter((r) => !haveReports.has(rkey(r)))];
  return { leases, reports };
}
