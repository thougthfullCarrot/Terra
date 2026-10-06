import { fetchJson, fetchText, type FetchJsonOptions } from '../lib/http.js';
import {
  METRO_COUNTIES,
  parseProjectPage,
  placeOf,
  searchForm,
  TABS_SEARCH_URL,
  tabsPermalink,
  tabsProjectUrl,
  type TabsRow
} from '../market/developments.js';
import { CITIES, type City } from '../types.js';

/**
 * The lease radar. Texas doesn't make landlords record leases, so the
 * expiration dates brokers pay CoStar for aren't public. Two free records
 * come close:
 *
 *   Tenant build-outs. Every commercial interior finish-out over $50,000 must
 *   register with TDLR's TABS registry before work starts, with the building,
 *   the square footage, who is paying and when it will be done. A company
 *   building out 60,000 square feet in a new tower is moving, and the space it
 *   leaves comes back to the market around the build-out's completion date.
 *
 *   Public companies' 10-K filings. Item 2 (Properties) and the lease notes
 *   often say when a headquarters or office lease expires. SEC's full-text
 *   search finds the filings; the sentence that names a Texas city and an
 *   expiration year is kept. SEC asks automated visitors to name a contact
 *   email in the User-Agent, so this half runs only when SEC_USER_AGENT is set.
 */

export interface TenantMove {
  /** TABS project number. */
  id: string;
  city: City;
  place: string | null;
  /** Who is moving in: the project name, which is the tenant's name on most build-outs. */
  tenant: string;
  /** The building. */
  building: string | null;
  address: string | null;
  squareFeet: number | null;
  cost: number;
  registered: string;
  start: string | null;
  /** When the build-out should finish: about when the tenant moves. */
  end: string | null;
  landlord: string | null;
  designFirm: string | null;
  scope: string | null;
  url: string;
}

export interface LeaseFiling {
  company: string;
  city: City;
  /** The year the lease expires, as the filing states it. */
  year: number;
  sentence: string;
  filed: string;
  url: string;
}

export interface LeaseRadarFile {
  generatedAt: string;
  moves: TenantMove[];
  filings: LeaseFiling[];
  /** Why the filings half is empty, when it is. */
  filingsNote?: string;
}

const RENOVATION = 9002;
/** Smaller build-outs are mostly store refreshes; 10,000 square feet is a real office or industrial lease. */
export const MIN_SQFT = 10_000;
/** Build-outs per metro kept, biggest first. */
export const MOVES_PER_CITY = 40;

const NOT_A_LEASE = /\b(remodel|refresh|repair|refrigeration|reconditioning|hotel|inn|suites|resort|walmart|target|sam'?s club|h-?e-?b|kroger|costco|cvs|walgreens|data ?cent(er|re)s?|DC\d*|DFW\d+|DA\d+|IAH\d+|SAT\d+|AUS\d+|MW|colo\w*|cyrusone|vantage|QTS|terminal|medical|clinic|UTMB|health|surgery|MD Anderson|memorial hermann|methodist|ymca|fitness|gym|storm|fire damage|stadium|arena|center court|toyota center|multifamily|units|artisan|appraisal district|municipal|country club|orchestras?|ISD|school|elementary|university|college|hospital|church|baptist|city of|county|airport|lift station|drainage|paving|sewer|water|wastewater|TxDOT|CSJ|apartments?|residential|restroom|parking|roof|fa[cç]ade|elevator|HVAC|chiller|generator|lobby|amenity|common area|spec suite|demising|demo(lition)?)\b/i;
const BUILD_OUT = /\b(tenant|build-?out|finish-?out|interior|fit-?out|TI|office|relocat\w*|suite|floors?|levels?)\b/i;

/** Renovations that could be a company moving into leased space. */
export function buildOutCandidates(rows: TabsRow[]): TabsRow[] {
  return rows.filter((r) => r.TypeOfWork === RENOVATION && r.EstimatedCost > 0 && !NOT_A_LEASE.test(`${r.ProjectName} ${r.FacilityName ?? ''}`));
}

/**
 * One move per tenant and building: a company that files each floor
 * separately ("6 Pines - Beusa - Level 4", "... Level 5") shows once, with the
 * floors' square feet and costs added up and the latest move-in date.
 */
export function mergeMoves(moves: TenantMove[]): TenantMove[] {
  const key = (m: TenantMove) =>
    `${m.city}|${m.tenant.toUpperCase().replace(/[-–,:]?\s*(LEVELS?|FLOORS?|PHASE|PH|SUITE|STE|BUILDING|BLDG)\b.*$/i, '').replace(/[^A-Z0-9]+/g, ' ').trim()}|${/^\s*(\d+)/.exec(m.address ?? '')?.[1] ?? m.building ?? ''}`;
  const out = new Map<string, TenantMove>();
  for (const m of moves) {
    const k = key(m);
    const seen = out.get(k);
    if (!seen) {
      out.set(k, { ...m });
      continue;
    }
    seen.squareFeet = (seen.squareFeet ?? 0) + (m.squareFeet ?? 0) || null;
    seen.cost += m.cost;
    if ((m.end ?? '') > (seen.end ?? '')) seen.end = m.end;
    if ((m.start ?? '9999') < (seen.start ?? '9999')) seen.start = m.start;
  }
  return [...out.values()];
}

/** A project page that reads as a tenant build-out of real size: tenant-funded or described as one. */
export function readBuildOut(page: Map<string, string[]>): {
  address: string | null;
  squareFeet: number | null;
  landlord: string | null;
  designFirm: string | null;
  scope: string | null;
  isBuildOut: boolean;
} {
  const one = (key: string) => {
    const value = page.get(key)?.join(' ').trim();
    return value && !/^not assigned$/i.test(value) ? value : null;
  };
  const feet = /([\d,]+)/.exec(page.get('PROJECT.Square Footage')?.[0] ?? '')?.[1];
  const squareFeet = feet ? Number(feet.replace(/,/g, '')) || null : null;
  const scope = one('PROJECT.Scope of Work');
  const tenantPays = /^yes/i.test(one('PROJECT.Are the private funds provided by the tenant') ?? '');
  const funds = one('PROJECT.Type of Funds') ?? '';
  const isPrivate = /privately funded/i.test(funds) || !/public/i.test(funds);
  return {
    address: page.get('PROJECT.Location Address')?.join(', ') ?? null,
    squareFeet,
    landlord: one('OWNER.Owner Name'),
    designFirm: one('DESIGN FIRM.Design Firm Name'),
    scope: scope && scope.length > 280 ? `${scope.slice(0, 277).trimEnd()}…` : scope,
    isBuildOut: isPrivate && (squareFeet ?? 0) >= MIN_SQFT && (tenantPays || BUILD_OUT.test(scope ?? ''))
  };
}

const isoDate = (value: string | null | undefined) => (value && /^\d{4}-\d{2}-\d{2}/.test(value) ? value.slice(0, 10) : null);
const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export interface RadarOptions extends FetchJsonOptions {
  now?: Date;
  previous?: TenantMove[];
  pauseMs?: number;
  log?: (line: string) => void;
}

/** The biggest tenant build-outs registered in each metro over the last year. */
export async function fetchTenantMoves(cities: readonly City[] = CITIES, options: RadarOptions = {}): Promise<TenantMove[]> {
  const { now = new Date(), previous = [], pauseMs = 300, log = () => {}, ...http } = options;
  const known = new Map(previous.map((m) => [m.id, m]));
  const since = new Date(now.getTime() - 365 * 86_400_000);
  const out: TenantMove[] = [];
  let pages = 0;
  for (const city of cities) {
    const counties = METRO_COUNTIES[city];
    if (!counties) continue;
    const rows = new Map<string, TabsRow>();
    for (const county of counties) {
      try {
        const data = await fetchJson<{ data?: TabsRow[] }>(TABS_SEARCH_URL, {
          timeoutMs: 120_000,
          ...http,
          form: searchForm(county, since, now, 800),
          headers: { 'x-requested-with': 'XMLHttpRequest', referer: 'https://www.tdlr.texas.gov/TABS/Search/' }
        });
        for (const row of buildOutCandidates(data.data ?? [])) rows.set(row.ProjectNumber, row);
      } catch (error) {
        log(`${city} (${county}): ${error instanceof Error ? error.message : error}`);
      }
    }
    // Read the pages of the costliest candidates; cost tracks size closely enough to rank.
    const ranked = [...rows.values()].sort((a, b) => b.EstimatedCost - a.EstimatedCost).slice(0, MOVES_PER_CITY * 2);
    const moves: TenantMove[] = [];
    for (const row of ranked) {
      if (moves.length >= MOVES_PER_CITY) break;
      let move = known.get(row.ProjectNumber) ?? null;
      if (!move) {
        try {
          if (pages++) await pause(pauseMs);
          const details = readBuildOut(parseProjectPage(await fetchText(tabsProjectUrl(row.ProjectNumber), { timeoutMs: 60_000, ...http })));
          if (!details.isBuildOut) continue;
          move = {
            id: row.ProjectNumber,
            city,
            place: placeOf(details.address),
            tenant: row.ProjectName.trim(),
            building: row.FacilityName?.trim() && row.FacilityName.trim() !== row.ProjectName.trim() ? row.FacilityName.trim() : null,
            address: details.address,
            squareFeet: details.squareFeet,
            cost: Math.round(row.EstimatedCost),
            registered: isoDate(row.ProjectCreatedOn) ?? '',
            start: isoDate(row.EstimatedStartDate),
            end: isoDate(row.EstimatedEndDate),
            landlord: details.landlord,
            designFirm: details.designFirm,
            scope: details.scope,
            url: tabsPermalink(row.ProjectNumber)
          };
        } catch (error) {
          log(`${row.ProjectNumber}: ${error instanceof Error ? error.message : error}`);
          continue;
        }
      }
      moves.push(move);
    }
    const merged = mergeMoves(moves);
    log(`${city}: ${merged.length} tenant moves (${moves.length} filings) from ${rows.size} renovations.`);
    // Galveston County sits in two metros' lists; show each move once, under the first.
    out.push(...merged.filter((m) => !out.some((o) => o.id === m.id)));
  }
  return out;
}

// ---------------------------------------------------------------- SEC filings

/** The search: 10-K filings from the last 15 months that say a lease expires and name the city. */
export function edgarSearchUrl(city: City, now: Date): string {
  const start = new Date(now.getTime() - 455 * 86_400_000).toISOString().slice(0, 10);
  const q = `"lease expires" "${city}, Texas"`;
  return `https://efts.sec.gov/LATEST/search-index?${new URLSearchParams({ q, forms: '10-K', dateRange: 'custom', startdt: start, enddt: now.toISOString().slice(0, 10) })}`;
}

interface EdgarHit {
  _id: string;
  _source: { ciks: string[]; display_names: string[]; file_date: string; file_type?: string };
}

/** The filing document's address from a search hit ("0001437749-26-020323:frd10k.htm"). */
export function edgarDocUrl(hit: EdgarHit): string | null {
  const [accession, file] = hit._id.split(':');
  const cik = hit._source.ciks?.[0];
  if (!accession || !file || !cik) return null;
  return `https://www.sec.gov/Archives/edgar/data/${Number(cik)}/${accession.replace(/-/g, '')}/${file}`;
}

/** "FRIEDMAN INDUSTRIES INC  (FRD)  (CIK 0000039092)" → "Friedman Industries Inc". */
export function companyName(display: string): string {
  const name = display.replace(/\s*\(.*$/, '').trim();
  return name
    .toLowerCase()
    .replace(/\b([a-z])/g, (c) => c.toUpperCase())
    .replace(/\b(Llc|Lp|Inc|Corp|Co|Ltd|Reit|Usa)\b/g, (w) => (w.length <= 3 && w !== 'Inc' && w !== 'Co' ? w.toUpperCase() : w));
}

/**
 * Sentences that tie a lease in the city to an expiration year: they mention
 * a lease, an expiration, the city, and a year from now through ten years
 * out. The year kept is the first such year in the sentence.
 */
export function leaseSentences(text: string, city: City, now: Date): { sentence: string; year: number }[] {
  const thisYear = now.getUTCFullYear();
  const out: { sentence: string; year: number }[] = [];
  for (const raw of text.split(/(?<=[.;])\s+(?=[A-Z])/)) {
    const sentence = raw.replace(/\s+/g, ' ').trim();
    if (sentence.length < 40 || sentence.length > 600) continue;
    if (!/\blease/i.test(sentence) || !/\bexpir/i.test(sentence) || !sentence.includes(city)) continue;
    const year = [...sentence.matchAll(/\b(20\d{2})\b/g)].map((m) => Number(m[1])).find((y) => y >= thisYear && y <= thisYear + 10);
    if (year) out.push({ sentence, year });
  }
  return out;
}

const htmlText = (html: string) =>
  html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;|&#160;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&#8217;|&rsquo;/g, "'")
    .replace(/&#\d+;|&[a-z]+;/gi, ' ')
    .replace(/\s+/g, ' ');

/** The cities whose name is distinctive enough to search filings for. */
export const FILING_CITIES: City[] = ['Houston', 'Dallas', 'Austin', 'San Antonio', 'Fort Worth', 'El Paso', 'Midland', 'Lubbock'];

export async function fetchLeaseFilings(userAgent: string, options: RadarOptions & { perCity?: number } = {}): Promise<LeaseFiling[]> {
  const { now = new Date(), log = () => {}, perCity = 12, pauseMs = 250, ...http } = options;
  const headers = { 'user-agent': userAgent };
  const out: LeaseFiling[] = [];
  const seen = new Set<string>();
  for (const city of FILING_CITIES) {
    let found = 0;
    try {
      const body = await fetchJson<{ hits?: { hits?: EdgarHit[] } }>(edgarSearchUrl(city, now), { timeoutMs: 60_000, ...http, headers });
      // The main 10-K document, one per company.
      const hits = (body.hits?.hits ?? []).filter((h) => !h._source.file_type || h._source.file_type === '10-K');
      for (const hit of hits.slice(0, perCity)) {
        const url = edgarDocUrl(hit);
        const company = companyName(hit._source.display_names?.[0] ?? '');
        if (!url || !company || seen.has(`${company}|${city}`)) continue;
        await pause(pauseMs);
        const text = htmlText(await fetchText(url, { timeoutMs: 90_000, ...http, headers }));
        const best = leaseSentences(text, city, now)[0];
        if (!best) continue;
        seen.add(`${company}|${city}`);
        out.push({ company, city, year: best.year, sentence: best.sentence, filed: hit._source.file_date, url });
        found++;
      }
    } catch (error) {
      log(`SEC ${city}: ${error instanceof Error ? error.message : error}`);
    }
    log(`SEC ${city}: ${found} filings with a lease end date.`);
  }
  return out.sort((a, b) => a.year - b.year);
}
