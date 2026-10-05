import { fetchText, type FetchJsonOptions } from '../lib/http.js';
import { CITIES, type City } from '../types.js';

/**
 * Commercial real estate headlines for each Terra city, from Google News
 * search RSS feeds and Yahoo Finance's headline RSS for listed real estate
 * companies (both free, no key). Only the headline, publisher, date and
 * link are kept: the page links out to the article and never copies its text.
 */

/** What the search asks for; the title filter below throws out the rest. */
const TOPICS =
  '("commercial real estate" OR development OR developer OR "office building" OR industrial OR warehouse OR multifamily OR apartments OR "mixed-use" OR "retail center" OR groundbreaking)';

/** Quoted so "Dallas" never matches a person named Dallas mid-word; "Austin" also needs Texas to skip Austin, Minnesota. */
const SEARCH_NAME: Record<City, string> = {
  Dallas: '"Dallas"',
  'Fort Worth': '"Fort Worth"',
  Houston: '"Houston"',
  Austin: '"Austin" Texas',
  'San Antonio': '"San Antonio"',
  'El Paso': '"El Paso"'
};

export function newsSearchUrl(city: City, days = 30): string {
  const q = `${SEARCH_NAME[city]} ${TOPICS} when:${days}d`;
  return `https://news.google.com/rss/search?${new URLSearchParams({ q, hl: 'en-US', gl: 'US', ceid: 'US:en' })}`;
}

/** The affordable-housing search: its own query so CRE headlines don't crowd it out. */
const AFFORDABLE_TOPICS = '("affordable housing" OR LIHTC OR "housing tax credit" OR "workforce housing" OR "housing authority")';

export function affordableSearchUrl(city: City, days = 30): string {
  const q = `${SEARCH_NAME[city]} ${AFFORDABLE_TOPICS} when:${days}d`;
  return `https://news.google.com/rss/search?${new URLSearchParams({ q, hl: 'en-US', gl: 'US', ceid: 'US:en' })}`;
}

export interface RssItem {
  title: string;
  link: string;
  source: string;
  sourceUrl: string | null;
  publishedAt: string | null;
  /** The feed's description, read only to tell which city a story is about; never published. */
  summary?: string;
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

export function decodeXml(text: string): string {
  return text
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, code: string) => {
      if (code[0] === '#') {
        const n = code[1] === 'x' || code[1] === 'X' ? parseInt(code.slice(2), 16) : Number(code.slice(1));
        return Number.isFinite(n) && n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : whole;
      }
      return ENTITIES[code.toLowerCase()] ?? whole;
    })
    .replace(/\s+/g, ' ')
    .trim();
}

function tag(block: string, name: string): { text: string; attrs: string } | null {
  const match = new RegExp(`<${name}(\\s[^>]*)?>([\\s\\S]*?)</${name}>`, 'i').exec(block);
  return match ? { attrs: match[1] ?? '', text: decodeXml(match[2] ?? '') } : null;
}

/** The items of an RSS 2.0 feed. Items without a title or an http(s) link are skipped. */
export function parseRss(xml: string): RssItem[] {
  const items: RssItem[] = [];
  for (const [, block = ''] of xml.matchAll(/<item\b[^>]*>([\s\S]*?)<\/item>/gi)) {
    const title = tag(block, 'title')?.text ?? '';
    const link = tag(block, 'link')?.text ?? '';
    if (!title || !/^https?:\/\//i.test(link)) continue;
    const source = tag(block, 'source');
    const summary = (tag(block, 'description')?.text ?? '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
    const sourceUrl = source ? (/url="([^"]+)"/i.exec(source.attrs)?.[1] ?? null) : null;
    const date = tag(block, 'pubDate')?.text;
    const time = date ? Date.parse(date) : NaN;
    items.push({
      title,
      link,
      source: source?.text ?? '',
      sourceUrl: sourceUrl && /^https?:\/\//i.test(sourceUrl) ? decodeXml(sourceUrl) : null,
      publishedAt: Number.isFinite(time) ? new Date(time).toISOString() : null,
      ...(summary ? { summary } : {})
    });
  }
  return items;
}

/** Google News titles end in " - Publisher"; the publisher is shown on its own. */
export function cleanTitle(title: string, source: string): string {
  if (source && title.endsWith(` - ${source}`)) return title.slice(0, -(source.length + 3)).trim();
  return title;
}

/** Topics a headline is tagged with, first match first; the page filters on these. */
export const TOPIC_RULES: Array<{ topic: string; pattern: RegExp }> = [
  {
    topic: 'Development',
    pattern:
      /\b(develop(s|er|ers|ment|ments)?|groundbreaking|breaks? ground|broke ground|under construction|construction|proposed|redevelop\w*|mixed-use|tower|rezon\w*|master-planned|plans? for|to build|will build|project)\b/i
  },
  { topic: 'Office', pattern: /\b(office|offices|headquarters|hq|coworking|cowork\w*)\b/i },
  { topic: 'Industrial', pattern: /\b(industrial|warehouse\w*|logistics|distribution (center|facility)|data cent(er|re)s?|manufactur\w*)\b/i },
  { topic: 'Multifamily', pattern: /\b(multifamily|multi-family|apartments?|residential units|townhomes?|build-to-rent|units)\b/i },
  { topic: 'Retail', pattern: /\b(retail|shopping (center|centre)|mall|grocery|h-e-b|restaurant row|storefront)\b/i },
  { topic: 'Hotel', pattern: /\b(hotels?|hospitality|resort)\b/i },
  {
    topic: 'Affordable housing',
    pattern:
      /\b(affordable (housing|homes|apartments|units)|LIHTC|housing tax credits?|low-income (housing|apartments|families|renters)|income-restricted|workforce housing|housing authority|public housing|section 8|HUD|housing vouchers?|attainable housing)\b/i
  },
  {
    topic: 'Deals',
    pattern:
      /\b(sells?|sold|sale|buys?|bought|acquir\w*|acquisition|purchase[sd]?|leases?|leased|signs? lease|financing|refinanc\w*|loan|investor|portfolio|REIT)\b/i
  }
];

/** True when the headline is about commercial real estate at all, not just the city. */
const CRE_HEADLINE =
  /\b(real estate|commercial|develop\w*|construction|groundbreaking|ground|office|industrial|warehouse|logistics|data cent(er|re)|multifamily|multi-family|apartments?|mixed-use|retail|shopping|tower|hotel|square[- ]f(oo|ee)t|sq\.? ?ft|acres?|lease[sd]?|rezon\w*|zoning|property|properties|redevelop\w*|REIT|broker\w*|tenant|vacancy|units|affordable housing|housing|LIHTC|housing authority)\b/i;

export function topicsFor(title: string): string[] {
  return TOPIC_RULES.filter((rule) => rule.pattern.test(title)).map((rule) => rule.topic);
}

export function isCreHeadline(title: string): boolean {
  return CRE_HEADLINE.test(title);
}

export interface Headline {
  title: string;
  url: string;
  source: string;
  publishedAt: string | null;
  topics: string[];
}

export interface CityNews {
  city: City;
  /** When this city's feed last answered; kept from the previous file when it didn't. */
  fetchedAt: string;
  headlines: Headline[];
}

export interface NewsFile {
  generatedAt: string;
  source: string;
  topics: string[];
  cities: CityNews[];
}

/**
 * Stories that mention a property but aren't about real estate: crime and
 * accidents "at Dallas apartments", sports and weather "developments",
 * and places that share a Terra city's name.
 */
const OFF_TOPIC =
  /\b(shooting|shot|killed|killing|murder\w*|stabb\w*|body found|dead|death|police|arrest\w*|suspect\w*|crash\w*|injur\w*|explosion|fire|burglar\w*|robbery|homicide|cowboys|texans|astros|rangers|mavericks|rockets|longhorns|week \d+|tropical|hurricane|storm|monsoon|flood\w*|power outage|without power|sanctions|ICE|deportation\w*|letters to the editor|opinion)\b|^Letters\b|\b(Houston County|Stewart-Houston|Austin,? (MN|Minn|Minnesota)|San Antonio,? (FL|Fla|Florida))\b/i;

export function isOffTopic(title: string): boolean {
  return OFF_TOPIC.test(title);
}

const STOP_WORDS = new Set('a an and at for in of on the to with by from as is are its it new texas tx'.split(' '));

function words(title: string): Set<string> {
  return new Set(
    title
      .toLowerCase()
      .replace(/[^a-z0-9 ]+/g, ' ')
      .split(' ')
      .filter((w) => w && !STOP_WORDS.has(w))
  );
}

/** Two papers' headlines for one story: most of their words are shared. */
export function sameStory(a: string, b: string): boolean {
  const x = words(a);
  const y = words(b);
  if (!x.size || !y.size) return false;
  let shared = 0;
  for (const w of x) if (y.has(w)) shared++;
  return shared / Math.min(x.size, y.size) >= 0.6;
}

/**
 * One city's headlines: about CRE, within maxAgeDays, one per story (the
 * same wire story runs in several papers), newest first.
 */
export function headlinesFrom(items: RssItem[], now: Date, options: { maxAgeDays?: number; limit?: number } = {}): Headline[] {
  const { maxAgeDays = 30, limit = 25 } = options;
  const oldest = now.getTime() - maxAgeDays * 86_400_000;
  const out: Headline[] = [];
  const sorted = [...items].sort((a, b) => (b.publishedAt ?? '').localeCompare(a.publishedAt ?? ''));
  for (const item of sorted) {
    const title = cleanTitle(item.title, item.source);
    if (!isCreHeadline(title) || isOffTopic(title)) continue;
    if (item.publishedAt && Date.parse(item.publishedAt) < oldest) continue;
    if (out.some((kept) => sameStory(kept.title, title))) continue;
    out.push({ title, url: item.link, source: item.source, publishedAt: item.publishedAt, topics: topicsFor(title) });
    if (out.length >= limit) break;
  }
  return out;
}

export async function fetchCityNews(city: City, options: FetchJsonOptions = {}): Promise<RssItem[]> {
  const xml = await fetchText(newsSearchUrl(city), { timeoutMs: 30_000, ...options, accept: 'application/rss+xml, application/xml, text/xml' });
  return parseRss(xml);
}

export async function fetchCityAffordable(city: City, options: FetchJsonOptions = {}): Promise<RssItem[]> {
  const xml = await fetchText(affordableSearchUrl(city), { timeoutMs: 30_000, ...options, accept: 'application/rss+xml, application/xml, text/xml' });
  return parseRss(xml);
}

/** Affordable-housing headlines added to a city's list, up to `limit`, skipping stories already there. */
export function mergeAffordable(headlines: Headline[], items: RssItem[], now: Date, limit = 10): Headline[] {
  const extra = headlinesFrom(items, now, { limit: 50 })
    .filter((h) => h.topics.includes('Affordable housing'))
    .filter((h) => !headlines.some((kept) => kept.url === h.url || sameStory(kept.title, h.title)))
    .slice(0, limit);
  return [...headlines, ...extra].sort((a, b) => (b.publishedAt ?? '').localeCompare(a.publishedAt ?? ''));
}

export interface NewsSources {
  /** One city's affordable-housing search; a failure only costs those stories. */
  fetchAffordable?: (city: City) => Promise<RssItem[]>;
  /** One city's Google News search results. */
  fetchCity?: (city: City) => Promise<RssItem[]>;
  /** Stories not searched by city (Yahoo Finance); each goes to the cities it names. */
  fetchShared?: () => Promise<RssItem[]>;
  log?: (line: string) => void;
}

/**
 * Every city's headlines. A city whose search fails, or answers with
 * nothing, keeps its headlines from the previous file so one bad run doesn't
 * blank it. A shared source that fails only costs its own stories.
 */
export async function buildNewsFile(now: Date, previous: NewsFile | null, sources: NewsSources = {}): Promise<NewsFile> {
  const { fetchCity = (city) => fetchCityNews(city), fetchAffordable = sources.fetchCity ? async () => [] : (city) => fetchCityAffordable(city), fetchShared = () => fetchYahooFinance(), log = console.log } = sources;
  const shared = await fetchShared().catch((error: unknown) => {
    log(`Yahoo Finance: ${error instanceof Error ? error.message : String(error)}`);
    return [] as RssItem[];
  });
  log(`Yahoo Finance: ${shared.length} stories.`);

  const cities: CityNews[] = [];
  for (const city of CITIES) {
    const before = previous?.cities.find((c) => c.city === city) ?? null;
    const named = shared.filter((item) => citiesNamedIn(`${item.title} ${item.summary ?? ''}`).includes(city));
    let searched: RssItem[] | null = null;
    try {
      searched = await fetchCity(city);
    } catch (error) {
      log(`${city}: ${error instanceof Error ? error.message : String(error)}`);
    }
    const affordable = await fetchAffordable(city).catch((error: unknown) => {
      log(`${city} affordable housing: ${error instanceof Error ? error.message : String(error)}`);
      return [] as RssItem[];
    });
    const headlines = mergeAffordable(headlinesFrom([...(searched ?? []), ...named], now), affordable, now);
    if (searched === null || (headlines.length === 0 && before?.headlines.length)) {
      if (before) {
        log(`${city}: keeping ${before.headlines.length} headlines from ${before.fetchedAt}.`);
        cities.push(before);
      } else if (headlines.length) {
        cities.push({ city, fetchedAt: now.toISOString(), headlines });
      }
      continue;
    }
    log(`${city}: ${headlines.length} headlines (${named.length} Yahoo Finance stories name it).`);
    cities.push({ city, fetchedAt: now.toISOString(), headlines });
  }
  return {
    generatedAt: now.toISOString(),
    source: 'Google News and Yahoo Finance',
    topics: TOPIC_RULES.map((rule) => rule.topic),
    cities
  };
}

/**
 * Yahoo Finance headline RSS for listed real estate companies with big Texas
 * footprints: brokerages, industrial and apartment REITs, and Texas-based
 * developers. Free, no key. Its stories aren't sorted by city, so only those
 * naming a Terra city are kept.
 */
export const YAHOO_TICKERS = [
  'CBRE', // CBRE Group, Dallas
  'JLL', // JLL
  'CWK', // Cushman & Wakefield
  'NMRK', // Newmark
  'MMI', // Marcus & Millichap
  'PLD', // Prologis
  'EGP', // EastGroup Properties, heavy in Texas
  'CPT', // Camden Property Trust, Houston
  'MAA', // Mid-America Apartment Communities
  'HHH', // Howard Hughes, The Woodlands
  'HR', // Healthcare Realty
  'O' // Realty Income
] as const;

export function yahooFinanceUrl(tickers: readonly string[] = YAHOO_TICKERS): string {
  return `https://feeds.finance.yahoo.com/rss/2.0/headline?${new URLSearchParams({ s: tickers.join(','), region: 'US', lang: 'en-US' })}`;
}

export async function fetchYahooFinance(options: FetchJsonOptions = {}): Promise<RssItem[]> {
  const xml = await fetchText(yahooFinanceUrl(), { timeoutMs: 30_000, ...options, accept: 'application/rss+xml, application/xml, text/xml' });
  return parseRss(xml).map((item) => ({ ...item, source: item.source || 'Yahoo Finance' }));
}

const CITY_NAMES: Array<{ city: City; pattern: RegExp }> = [
  { city: 'Dallas', pattern: /\b(Dallas|DFW|Dallas-Fort Worth)\b/ },
  { city: 'Fort Worth', pattern: /\b(Fort Worth|Ft\.? Worth|DFW|Dallas-Fort Worth)\b/ },
  { city: 'Houston', pattern: /\bHouston\b/ },
  { city: 'Austin', pattern: /\bAustin\b/ },
  { city: 'San Antonio', pattern: /\bSan Antonio\b/ },
  { city: 'El Paso', pattern: /\bEl Paso\b/ }
];

/** The Terra cities a story names. */
export function citiesNamedIn(text: string): City[] {
  return CITY_NAMES.filter((c) => c.pattern.test(text)).map((c) => c.city);
}
