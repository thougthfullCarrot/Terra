import { fetchJson, fetchText } from '../lib/http.js';
import { decodeXml } from '../news/googleNews.js';
import { CITIES, type City } from '../types.js';

/**
 * Real estate networking and industry events for each Terra city, read from
 * chapter calendars that publish machine-readable listings and whose
 * robots.txt allows it. Only title, date, venue, cost and link are kept; each
 * event opens on the organizer's site. Sites that refuse automated requests
 * (ULI and IREM chapters answer 403) are left out on purpose.
 */

export interface TerraEvent {
  id: string;
  title: string;
  url: string;
  start: string;
  end: string | null;
  city: City;
  organizer: string;
  venue: string | null;
  cost: string | null;
  /** "Added by hand" for rows from the Google Sheet's Events tab; absent for calendar feeds. */
  source?: string;
}

export interface EventSource {
  /** Stable key, used as the id prefix. */
  key: string;
  organizer: string;
  city: City;
  kind: 'tribe' | 'growthzone' | 'jsonld' | 'pages';
  /** Site root, no trailing slash. */
  base: string;
  /** The listing page (default base + /events). */
  page?: string;
  /** pages: path prefix of event detail links on the listing (each detail page carries schema.org Event JSON-LD). */
  detailPath?: string;
  /** Drop titles matching this (internal committee meetings on a public calendar). */
  exclude?: RegExp;
  /** Keep only titles matching RELEVANT (chamber hubs list ribbon cuttings, yoga, etc. next to networking events). */
  relevantOnly?: boolean;
}

/** Business networking and real estate words; used for sources with relevantOnly. */
export const RELEVANT =
  /real estate|\bcre\b|commercial|develop|networking|network\b|luncheon|lunch\b|mixer|breakfast|after[- ]hours|economic|state of the (?:city|county|region)|builder|broker|investor|business alliance|forum|leadership/i;

/** Add a chapter here; the kind picks the parser. */
export const EVENT_SOURCES: EventSource[] = [
  { key: 'creda-houston', organizer: 'CREDA Houston', city: 'Houston', kind: 'tribe', base: 'https://credahouston.org' },
  { key: 'boma-dallas', organizer: 'BOMA Dallas', city: 'Dallas', kind: 'growthzone', base: 'https://members.bomadallas.org' },
  { key: 'boma-houston', organizer: 'Houston BOMA', city: 'Houston', kind: 'pages', base: 'https://www.houstonboma.org', page: 'https://www.houstonboma.org/events/', detailPath: '/events/' },
  { key: 'trec-dallas', organizer: 'The Real Estate Council', city: 'Dallas', kind: 'jsonld', base: 'https://recouncil.com', page: 'https://recouncil.com/calendar/', exclude: /committee|advisory board|board meeting|check-in call|consulting services meeting|core committee/i },
  { key: 'nawic-sa', organizer: 'NAWIC San Antonio', city: 'San Antonio', kind: 'pages', base: 'https://www.nawicsatx.org', page: 'https://www.nawicsatx.org/events', detailPath: '/events-1/' },
  // Chamber calendars (GrowthZone): only networking, real estate and economic events (see RELEVANT).
  { key: 'metro-sa', organizer: 'Metro SA Chamber', city: 'San Antonio', kind: 'growthzone', base: 'https://members.metrosa.com', page: 'https://members.metrosa.com/events/calendar', relevantOnly: true },
  { key: 'sotx-partnership', organizer: 'South Texas Business Partnership', city: 'San Antonio', kind: 'growthzone', base: 'https://business.southtexaspartnership.org', relevantOnly: true },
  { key: 'boerne-chamber', organizer: 'Boerne Chamber', city: 'San Antonio', kind: 'growthzone', base: 'https://business.boerne.org', page: 'https://business.boerne.org/events/calendar', relevantOnly: true },
  { key: 'nb-chamber', organizer: 'New Braunfels Chamber', city: 'New Braunfels', kind: 'growthzone', base: 'https://newbraunfelschamber.growthzoneapp.com', relevantOnly: true },
  { key: 'elpaso-chamber', organizer: 'El Paso Chamber', city: 'El Paso', kind: 'growthzone', base: 'https://members.elpaso.org', relevantOnly: true }
];

/** The source label of events typed into the Google Sheet. */
export const MANUAL_SOURCE = 'Added by hand';

export const WINDOW_DAYS = 120;

const HTML_ENTITIES: Record<string, string> = { ndash: '\u2013', mdash: '\u2014', rsquo: '\u2019', lsquo: '\u2018', rdquo: '\u201d', ldquo: '\u201c', hellip: '\u2026' };

/** Plain text from an HTML fragment, entities decoded. */
export function decodeText(text: string): string {
  return decodeXml(text.replace(/<[^>]*>/g, ' ').replace(/&([a-z]+);/gi, (whole, name: string) => HTML_ENTITIES[name.toLowerCase()] ?? whole));
}

function httpUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : null;
  } catch {
    return null;
  }
}

/** "2026-10-14 11:30:00" (site-local Central time) → ISO with offset. */
export function centralIso(local: string): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?/.exec(local.trim());
  if (!m) return null;
  const [, y, mo, d, h = '00', mi = '00', s = '00'] = m;
  // US Central: CDT (-05:00) from the 2nd Sunday of March to the 1st Sunday of November.
  const year = Number(y);
  const firstSunday = (month: number) => 1 + ((7 - new Date(Date.UTC(year, month, 1)).getUTCDay()) % 7);
  const key = Number(mo) * 100 + Number(d);
  const dst = key >= 300 + firstSunday(2) + 7 && key < 1100 + firstSunday(10);
  return `${y}-${mo}-${d}T${h}:${mi}:${s}${dst ? '-05:00' : '-06:00'}`;
}

// ---- The Events Calendar (WordPress) ----

/** The Events Calendar's iCal exports, tried when the REST API is disabled. */
export function tribeIcalFeeds(base: string): string[] {
  return [`${base}/events/?ical=1`, `${base}/events/list/?ical=1`, `${base}/?post_type=tribe_events&ical=1`];
}

export function tribeUrl(base: string, now: Date): string {
  return `${base}/wp-json/tribe/events/v1/events?${new URLSearchParams({ per_page: '50', start_date: now.toISOString().slice(0, 10) })}`;
}

interface TribeEvent {
  id?: number;
  title?: string;
  url?: string;
  start_date?: string;
  end_date?: string;
  utc_start_date?: string;
  utc_end_date?: string;
  cost?: string;
  venue?: { venue?: string; address?: string; city?: string } | unknown[];
}

export function parseTribe(body: { events?: TribeEvent[] } | null, source: EventSource): TerraEvent[] {
  const out: TerraEvent[] = [];
  for (const e of body?.events ?? []) {
    const url = httpUrl(e.url);
    const title = decodeText(e.title ?? '');
    const start = e.utc_start_date ? `${e.utc_start_date.replace(' ', 'T')}Z` : e.start_date ? centralIso(e.start_date) : null;
    if (!url || !title || !start) continue;
    const end = e.utc_end_date ? `${e.utc_end_date.replace(' ', 'T')}Z` : e.end_date ? centralIso(e.end_date) : null;
    const v = e.venue && !Array.isArray(e.venue) ? e.venue : null;
    const venue = v ? [v.venue, v.city].map((x) => decodeText(x ?? '')).filter(Boolean).join(', ') : '';
    out.push({
      id: `${source.key}-${e.id ?? url}`,
      title,
      url,
      start,
      end,
      city: source.city,
      organizer: source.organizer,
      venue: venue || null,
      cost: decodeText(e.cost ?? '') || null
    });
  }
  return out;
}

// ---- GrowthZone (ChamberMaster) ----

/** Calendar feeds GrowthZone sites commonly serve, tried in order. */
export function growthZoneFeeds(base: string): string[] {
  return [`${base}/events/ical`, `${base}/events/calendarical`];
}

function icsDate(value: string): string | null {
  const m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z)?)?$/.exec(value.trim());
  if (!m) return null;
  const [, y, mo, d, h, mi, s, z] = m;
  if (!h) return `${y}-${mo}-${d}T00:00:00${centralIso(`${y}-${mo}-${d}`)!.slice(-6)}`;
  return z ? `${y}-${mo}-${d}T${h}:${mi}:${s}Z` : centralIso(`${y}-${mo}-${d} ${h}:${mi}:${s}`);
}

function icsText(value: string): string {
  return value.replace(/\\n/gi, ' ').replace(/\\([,;\\])/g, '$1').replace(/\s+/g, ' ').trim();
}

export function parseIcs(text: string, source: EventSource): TerraEvent[] {
  if (!/BEGIN:VCALENDAR/.test(text)) return [];
  const unfolded = text.replace(/\r?\n[ \t]/g, '');
  const out: TerraEvent[] = [];
  for (const [, block = ''] of unfolded.matchAll(/BEGIN:VEVENT([\s\S]*?)END:VEVENT/g)) {
    const field = (name: string) => {
      const m = new RegExp(`^${name}(?:;[^:\\r\\n]*)?:(.*)$`, 'mi').exec(block);
      return m ? (m[1] ?? '').trim() : '';
    };
    const title = icsText(field('SUMMARY'));
    const url = httpUrl(field('URL'));
    const start = icsDate(field('DTSTART'));
    if (!title || !url || !start) continue;
    out.push({
      id: `${source.key}-${field('UID') || url}`,
      title,
      url,
      start,
      end: icsDate(field('DTEND')),
      city: source.city,
      organizer: source.organizer,
      venue: icsText(field('LOCATION')) || null,
      cost: null
    });
  }
  return out;
}

/** Event links on a GrowthZone listing page: /events/Details/<slug>-<id>. */
export function growthZoneLinks(html: string, base: string): Array<{ url: string; title: string }> {
  const seen = new Map<string, string>();
  for (const m of html.matchAll(/<a\b[^>]*href="([^"]*\/events\/Details\/[^"#?]+-\d+)[^"]*"[^>]*>([\s\S]*?)<\/a>/gi)) {
    const url = new URL(decodeXml(m[1] ?? ''), `${base}/`).href;
    const text = decodeText(m[2] ?? '');
    if (!seen.get(url)) seen.set(url, text);
  }
  return [...seen].map(([url, text]) => ({
    url,
    title: text || slugTitle(url)
  }));
}

export function slugTitle(url: string): string {
  const slug = /\/Details\/(.+)-\d+\/?$/i.exec(new URL(url).pathname)?.[1] ?? '';
  return slug.split('-').filter(Boolean).map((w) => w[0]!.toUpperCase() + w.slice(1)).join(' ');
}

/** Start/end/venue from a GrowthZone details page: schema.org JSON-LD first, then itemprop microdata. */
export function parseGrowthZoneDetail(html: string): { title?: string; start: string | null; end: string | null; venue: string | null } {
  for (const [, json = ''] of html.matchAll(/<script[^>]*application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      const data = JSON.parse(json) as unknown;
      for (const node of Array.isArray(data) ? data : [data]) {
        const n = node as { '@type'?: string; name?: string; startDate?: string; endDate?: string; location?: { name?: string } };
        if (n?.['@type'] === 'Event' && n.startDate) {
          return { title: n.name ? decodeText(n.name) : undefined, start: normalizeDate(n.startDate), end: n.endDate ? normalizeDate(n.endDate) : null, venue: n.location?.name ? decodeText(n.location.name) : null };
        }
      }
    } catch {
      /* not JSON */
    }
  }
  const prop = (name: string) =>
    new RegExp(`itemprop="${name}"[^>]*content="([^"]+)"`, 'i').exec(html)?.[1] ?? new RegExp(`content="([^"]+)"[^>]*itemprop="${name}"`, 'i').exec(html)?.[1] ?? null;
  const start = prop('startDate');
  const end = prop('endDate');
  const venue = /itemprop="location"[\s\S]*?itemprop="name"[^>]*>([^<]+)</i.exec(html)?.[1];
  return { start: start ? normalizeDate(start) : null, end: end ? normalizeDate(end) : null, venue: venue ? decodeText(venue) : null };
}

function normalizeDate(value: string): string | null {
  // Keep an explicit offset as written so the local (Central) calendar date survives; converting to UTC
  // shifts evening events to the next day.
  const off = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?)(?:\.\d+)?([+-]\d{2}):?(\d{2})$/.exec(value.trim());
  if (off) return `${off[1]!.length === 16 ? `${off[1]}:00` : off[1]}${off[2]}:${off[3]}`;
  if (/^\d{4}-\d{2}-\d{2}T00:00(?::00)?(?:\.0+)?Z$/i.test(value.trim())) return centralIso(value.slice(0, 10)); // date-only serialized as UTC midnight
  if (/[zZ]$/.test(value)) {
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  }
  return centralIso(value);
}

// ---- schema.org JSON-LD on a listing page ----

interface LdEvent {
  '@type'?: string | string[];
  '@graph'?: unknown[];
  name?: string;
  url?: string;
  startDate?: string;
  endDate?: string;
  location?: { name?: string } | Array<{ name?: string }> | string;
  offers?: { price?: string | number } | Array<{ price?: string | number }>;
}

function ldNodes(data: unknown): LdEvent[] {
  if (Array.isArray(data)) return data.flatMap(ldNodes);
  if (!data || typeof data !== 'object') return [];
  const n = data as LdEvent;
  return [n, ...(n['@graph'] ? ldNodes(n['@graph']) : [])];
}

/** Every schema.org Event in a page's JSON-LD blocks. */
export function parseJsonLdEvents(html: string, source: EventSource, pageUrl: string): TerraEvent[] {
  const out: TerraEvent[] = [];
  for (const [, json = ''] of html.matchAll(/<script[^>]*application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)) {
    let data: unknown;
    try {
      data = JSON.parse(json.trim());
    } catch {
      continue;
    }
    for (const n of ldNodes(data)) {
      const types = Array.isArray(n['@type']) ? n['@type'] : [n['@type']];
      if (!types.some((t) => typeof t === 'string' && /Event$/.test(t))) continue;
      const title = decodeText(n.name ?? '');
      const start = n.startDate ? normalizeDate(n.startDate) : null;
      let url: string | null = null;
      try {
        // Without its own url the event links to the listing, made unique per event with a fragment.
        url = httpUrl(new URL(n.url || `#${(start ?? '').slice(0, 10)}-${title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}`, pageUrl).href);
      } catch {
        url = null;
      }
      if (!title || !start || !url) continue;
      const loc = Array.isArray(n.location) ? n.location[0] : n.location;
      const venue = typeof loc === 'string' ? loc : loc?.name;
      out.push({
        id: `${source.key}-${url}`,
        title,
        url,
        start,
        end: n.endDate ? normalizeDate(n.endDate) : null,
        city: source.city,
        organizer: source.organizer,
        venue: venue ? decodeText(venue) || null : null,
        cost: null
      });
    }
  }
  return out;
}

const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];

/** Title and start from a Novi AMS event page (no JSON-LD): the c-event-details start-date and time spans. */
export function parseNoviDetail(html: string): { title: string; start: string } | null {
  // The text after the marker class (icons and wrappers may come first).
  const span = (cls: string) => {
    const at = html.search(new RegExp(`class="[^"]*${cls}[\\s"]`, 'i'));
    return at < 0 ? undefined : html.slice(at, at + 600).replace(/^[^>]*>/, '');
  };
  const dateText = decodeText(span('c-event-details__start-date') ?? '');
  const d = /([A-Za-z]+)\s+(\d{1,2}),?\s+(\d{4})/.exec(dateText);
  const mo = d ? MONTHS.indexOf(d[1]!.toLowerCase()) : -1;
  if (!d || mo < 0) return null;
  const date = `${d[3]}-${String(mo + 1).padStart(2, '0')}-${d[2]!.padStart(2, '0')}`;
  const t = /(\d{1,2}):(\d{2})\s*([AP])\.?M/i.exec(decodeText(span('c-event-details__time') ?? ''));
  const h = t ? (Number(t[1]) % 12) + (t[3]!.toUpperCase() === 'P' ? 12 : 0) : null;
  const og = /<meta[^>]*property="og:title"[^>]*content="([^"]+)"/i.exec(html)?.[1];
  const h1 = /<h1[^>]*>([\s\S]*?)<\/h1>/i.exec(html)?.[1];
  const title = decodeText(og ?? h1 ?? '').replace(/\s*[|\u2013-]\s*Houston BOMA\s*$/i, '');
  if (!title) return null;
  return { title, start: centralIso(h === null ? date : `${date} ${String(h).padStart(2, '0')}:${t![2]}`)! };
}

/** Same-site links under detailPath on a listing page (one level deeper than the prefix, no query). */
export function detailLinks(html: string, page: string, detailPath: string): string[] {
  const origin = new URL(page).origin;
  const out = new Set<string>();
  for (const [, href = ''] of html.matchAll(/<a\b[^>]*href="([^"#]+)"/gi)) {
    let url: URL;
    try {
      url = new URL(decodeXml(href), page);
    } catch {
      continue;
    }
    if (url.origin !== origin || url.search || !url.pathname.startsWith(detailPath)) continue;
    const rest = url.pathname.slice(detailPath.length).replace(/\/$/, '');
    if (!rest || rest.includes('/')) continue;
    out.add(`${url.origin}${url.pathname}`);
  }
  return [...out];
}

/** Housekeeping entries ("BOMA CLOSED - Labor Day", office-closure holidays), not real events. */
export function isClosure(title: string): boolean {
  return /^\s*(?:[\w&.' ]+\s+)?closed(?:\s*[\u2013\u2014:]|\s*-(?!\w))/i.test(title) || /\boffices?\s+(?:will\s+be\s+)?closed\b/i.test(title);
}

/** "10.24.26 Foundation Gala" → { date: '2026-10-24', title: 'Foundation Gala' }. */
export function datePrefix(title: string): { date: string | null; title: string } {
  const m = /^\s*(\d{1,2})\.(\d{1,2})\.(\d{2}|\d{4})\s*[-\u2013:|]?\s*(.*)$/.exec(title);
  if (!m) return { date: null, title };
  const mo = Number(m[1]), d = Number(m[2]);
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return { date: null, title };
  const y = m[3]!.length === 2 ? `20${m[3]}` : m[3]!;
  return { date: `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`, title: m[4]!.trim() || title };
}

/** Apply a title's MM.DD.YY prefix: it wins over a scraped start on a different date. */
export function applyDatePrefix(e: TerraEvent): TerraEvent {
  const p = datePrefix(e.title);
  if (!p.date) return e;
  if (e.start.slice(0, 10) === p.date) return { ...e, title: p.title };
  const start = centralIso(p.date)!;
  const end = e.end && e.end.slice(0, 10) >= p.date ? e.end : null;
  return { ...e, title: p.title, start, end };
}

function tidy(events: TerraEvent[]): TerraEvent[] {
  return events.filter((e) => !isClosure(e.title)).map(applyDatePrefix);
}

export type Fetcher = { json: (url: string) => Promise<unknown>; text: (url: string) => Promise<string> };

const defaultFetcher: Fetcher = {
  json: (url) => fetchJson(url, { retries: 1 }),
  text: (url) => fetchText(url, { retries: 1, accept: 'text/html,text/calendar,*/*' })
};

export async function fetchSource(source: EventSource, now: Date, fetcher: Fetcher = defaultFetcher, log: (m: string) => void = console.log): Promise<TerraEvent[]> {
  const events = tidy(await fetchRaw(source, now, fetcher, log));
  return events.filter((e) => (!source.relevantOnly || RELEVANT.test(e.title)) && !source.exclude?.test(e.title));
}

async function fetchRaw(source: EventSource, now: Date, fetcher: Fetcher, log: (m: string) => void): Promise<TerraEvent[]> {
  if (source.kind === 'tribe') {
    let restError: unknown = null;
    try {
      return parseTribe((await fetcher.json(tribeUrl(source.base, now))) as { events?: TribeEvent[] }, source);
    } catch (error) {
      restError = error;
      log(`${source.organizer}: REST API failed (${error instanceof Error ? error.message : String(error)}); trying iCal export.`);
    }
    for (const feed of tribeIcalFeeds(source.base)) {
      try {
        const text = await fetcher.text(feed);
        if (!/BEGIN:VCALENDAR/.test(text)) continue;
        const events = parseIcs(text, source);
        log(`${source.organizer}: ${events.length} events from ${feed}`);
        return events;
      } catch (error) {
        log(`${source.organizer}: ${feed}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    throw restError instanceof Error ? restError : new Error('no event feed reachable');
  }

  if (source.kind === 'jsonld') {
    const page = source.page ?? `${source.base}/events`;
    const events = parseJsonLdEvents(await fetcher.text(page), source, page);
    log(`${source.organizer}: ${events.length} events from ${page}`);
    return events;
  }

  if (source.kind === 'pages') {
    const page = source.page ?? `${source.base}/events`;
    const links = detailLinks(await fetcher.text(page), page, source.detailPath ?? '/events/').slice(0, 30);
    log(`${source.organizer}: reading ${links.length} event pages.`);
    const out: TerraEvent[] = [];
    for (const link of links) {
      try {
        const html = await fetcher.text(link);
        const ld = parseJsonLdEvents(html, source, link)[0];
        const novi = ld ? null : parseNoviDetail(html);
        if (ld) out.push({ ...ld, url: link, id: `${source.key}-${link}` });
        else if (novi) out.push({ id: `${source.key}-${link}`, url: link, end: null, city: source.city, organizer: source.organizer, venue: null, cost: null, ...novi });
      } catch (error) {
        log(`${link}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    return out;
  }

  for (const feed of growthZoneFeeds(source.base)) {
    try {
      const events = parseIcs(await fetcher.text(feed), source);
      if (events.length) {
        log(`${source.organizer}: ${events.length} events from ${feed}`);
        return events;
      }
    } catch (error) {
      log(`${source.organizer}: ${feed}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  const links = growthZoneLinks(await fetcher.text(source.page ?? `${source.base}/events`), source.base)
    .filter((l) => !source.relevantOnly || !l.title || RELEVANT.test(l.title))
    .slice(0, 30);
  log(`${source.organizer}: no calendar feed; reading ${links.length} event pages.`);
  const out: TerraEvent[] = [];
  for (const link of links) {
    try {
      const detail = parseGrowthZoneDetail(await fetcher.text(link.url));
      if (!detail.start) continue;
      out.push({
        id: `${source.key}-${/-(\d+)\/?$/.exec(link.url)?.[1] ?? link.url}`,
        title: detail.title || (/-->/.test(link.title) ? slugTitle(link.url) : link.title),
        url: link.url,
        start: detail.start,
        end: detail.end,
        city: source.city,
        organizer: source.organizer,
        venue: detail.venue,
        cost: null
      });
    } catch (error) {
      log(`${link.url}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return out;
}

/** A url compared loosely: no tracking params (GrowthZone's sourceTypeId, calendarMonth), case-folded path, no trailing slash. */
export function urlKey(url: string): string {
  try {
    const u = new URL(url);
    for (const p of [...u.searchParams.keys()]) if (/^(sourcetypeid|calendarmonth|utm_\w+)$/i.test(p)) u.searchParams.delete(p);
    return `${u.host.replace(/^www\./, '')}${u.pathname.toLowerCase().replace(/\/$/, '')}${u.search}${u.hash}`;
  } catch {
    return url;
  }
}

/** Upcoming (not yet ended, starting within the window), one per url, by start. */
export function upcoming(events: TerraEvent[], now: Date, days = WINDOW_DAYS): TerraEvent[] {
  const limit = now.getTime() + days * 86_400_000;
  const byUrl = new Map<string, TerraEvent>();
  for (const e of events) {
    const key = e.url ? urlKey(e.url) : e.id;
    const start = new Date(e.start).getTime();
    const end = e.end ? new Date(e.end).getTime() : start + 86_400_000;
    if (!Number.isFinite(start) || start > limit || end < now.getTime()) continue;
    if (!byUrl.has(key)) byUrl.set(key, e);
  }
  return [...byUrl.values()].sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime());
}

export interface EventsFile {
  generatedAt: string;
  sources: Array<{ organizer: string; city: City | null; url: string; fetchedAt: string; count: number }>;
  cities: Array<{ city: City; events: TerraEvent[] }>;
}

/** Build events.json. A source that fails keeps its events from the previous file. */
export async function buildEventsFile(
  now: Date,
  previous: EventsFile | null,
  options: {
    sources?: EventSource[];
    fetcher?: Fetcher;
    log?: (m: string) => void;
    /** Rows from the sheet's Events tab; null when the sheet could not be read (the previous ones are kept). */
    manual?: TerraEvent[] | null;
  } = {}
): Promise<EventsFile> {
  const { sources = EVENT_SOURCES, fetcher = defaultFetcher, log = console.log, manual = null } = options;
  const all: TerraEvent[] = [];
  const meta: EventsFile['sources'] = [];
  for (const source of sources) {
    const before = previous?.sources.find((s) => s.organizer === source.organizer);
    const kept = (previous?.cities ?? []).flatMap((c) => c.events).filter((e) => e.organizer === source.organizer && e.source !== MANUAL_SOURCE);
    try {
      const events = upcoming(await fetchSource(source, now, fetcher, log), now);
      log(`${source.organizer}: ${events.length} upcoming events.`);
      all.push(...events);
      meta.push({ organizer: source.organizer, city: source.city, url: source.page ?? `${source.base}/events`, fetchedAt: now.toISOString(), count: events.length });
    } catch (error) {
      log(`${source.organizer}: ${error instanceof Error ? error.message : String(error)}; keeping ${kept.length} earlier events.`);
      const still = upcoming(kept, now);
      all.push(...still);
      if (before) meta.push({ ...before, count: still.length });
    }
  }
  const previousManual = (previous?.cities ?? []).flatMap((c) => c.events).filter((e) => e.source === MANUAL_SOURCE);
  const hand = upcoming((manual ?? previousManual).map((e) => ({ ...e, source: MANUAL_SOURCE })), now);
  if (hand.length) {
    meta.push({ organizer: MANUAL_SOURCE, city: null, url: '', fetchedAt: now.toISOString(), count: hand.length });
  }
  const sorted = upcoming([...all, ...hand], now);
  return {
    generatedAt: now.toISOString(),
    sources: meta,
    cities: CITIES.map((city) => ({ city, events: sorted.filter((e) => e.city === city) }))
  };
}
