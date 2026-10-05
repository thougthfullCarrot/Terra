import { fetchText, type FetchJsonOptions } from '../lib/http.js';
import { CITIES, type City } from '../types.js';

/**
 * Commercial real estate headlines for each Terra city, from Google News
 * search RSS feeds (free, no key). Only the headline, publisher, date and
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

export interface RssItem {
  title: string;
  link: string;
  source: string;
  sourceUrl: string | null;
  publishedAt: string | null;
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
    const sourceUrl = source ? (/url="([^"]+)"/i.exec(source.attrs)?.[1] ?? null) : null;
    const date = tag(block, 'pubDate')?.text;
    const time = date ? Date.parse(date) : NaN;
    items.push({
      title,
      link,
      source: source?.text ?? '',
      sourceUrl: sourceUrl && /^https?:\/\//i.test(sourceUrl) ? decodeXml(sourceUrl) : null,
      publishedAt: Number.isFinite(time) ? new Date(time).toISOString() : null
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
    topic: 'Deals',
    pattern:
      /\b(sells?|sold|sale|buys?|bought|acquir\w*|acquisition|purchase[sd]?|leases?|leased|signs? lease|financing|refinanc\w*|loan|investor|portfolio|REIT)\b/i
  }
];

/** True when the headline is about commercial real estate at all, not just the city. */
const CRE_HEADLINE =
  /\b(real estate|commercial|develop\w*|construction|groundbreaking|ground|office|industrial|warehouse|logistics|data cent(er|re)|multifamily|multi-family|apartments?|mixed-use|retail|shopping|tower|hotel|square[- ]f(oo|ee)t|sq\.? ?ft|acres?|lease[sd]?|rezon\w*|zoning|property|properties|redevelop\w*|REIT|broker\w*|tenant|vacancy|units)\b/i;

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

function sameStory(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * One city's headlines: about CRE, within maxAgeDays, one per story (the
 * same wire story runs in several papers), newest first.
 */
export function headlinesFrom(items: RssItem[], now: Date, options: { maxAgeDays?: number; limit?: number } = {}): Headline[] {
  const { maxAgeDays = 30, limit = 25 } = options;
  const oldest = now.getTime() - maxAgeDays * 86_400_000;
  const seen = new Set<string>();
  const out: Headline[] = [];
  const sorted = [...items].sort((a, b) => (b.publishedAt ?? '').localeCompare(a.publishedAt ?? ''));
  for (const item of sorted) {
    const title = cleanTitle(item.title, item.source);
    if (!isCreHeadline(title)) continue;
    if (item.publishedAt && Date.parse(item.publishedAt) < oldest) continue;
    const key = sameStory(title);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ title, url: item.link, source: item.source, publishedAt: item.publishedAt, topics: topicsFor(title) });
    if (out.length >= limit) break;
  }
  return out;
}

export async function fetchCityNews(city: City, now: Date, options: FetchJsonOptions = {}): Promise<Headline[]> {
  const xml = await fetchText(newsSearchUrl(city), { timeoutMs: 30_000, ...options, accept: 'application/rss+xml, application/xml, text/xml' });
  return headlinesFrom(parseRss(xml), now);
}

/**
 * Every city's headlines. A city whose feed fails, or answers with nothing,
 * keeps its headlines from the previous file so one bad run doesn't blank it.
 */
export async function buildNewsFile(
  now: Date,
  previous: NewsFile | null,
  fetchCity: (city: City) => Promise<Headline[]> = (city) => fetchCityNews(city, now),
  log: (line: string) => void = console.log
): Promise<NewsFile> {
  const cities: CityNews[] = [];
  for (const city of CITIES) {
    const before = previous?.cities.find((c) => c.city === city) ?? null;
    try {
      const headlines = await fetchCity(city);
      if (headlines.length === 0 && before?.headlines.length) {
        log(`${city}: no headlines this run; keeping ${before.headlines.length} from ${before.fetchedAt}.`);
        cities.push(before);
      } else {
        log(`${city}: ${headlines.length} headlines.`);
        cities.push({ city, fetchedAt: now.toISOString(), headlines });
      }
    } catch (error) {
      log(`${city}: ${error instanceof Error ? error.message : String(error)}${before ? `; keeping ${before.headlines.length} from ${before.fetchedAt}` : ''}`);
      if (before) cities.push(before);
    }
  }
  return {
    generatedAt: now.toISOString(),
    source: 'Google News',
    topics: TOPIC_RULES.map((rule) => rule.topic),
    cities
  };
}
