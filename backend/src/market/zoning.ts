import { fetchJson, fetchText, type FetchJsonOptions } from '../lib/http.js';
import type { City } from '../types.js';

/**
 * Zoning change alerts: rezoning requests, planned developments and special
 * use permits on the agendas of Terra's cities' planning commissions and
 * councils. A rezoning is the earliest public sign of a project, months
 * before a building permit or a state filing.
 *
 * Three agenda systems publish their agendas as free, keyless JSON:
 *
 *   Legistar (Granicus)  Dallas, Plano, McKinney, Mesquite, Mansfield,
 *                        Austin, Round Rock, Pflugerville, San Marcos, El Paso,
 *                        New Braunfels, Boerne, League City
 *   CivicClerk           College Station, Midland, Galveston
 *   PrimeGov             San Antonio (agendas as HTML pages)
 *
 * Not covered: Houston has no zoning at all (its planning commission rules on
 * plats and variances instead). Fort Worth's Legistar stopped publishing in
 * June 2026 and its new agenda site sits behind a firewall that turns away
 * automated readers, and Lubbock's agenda system has no public feed.
 */

export interface ZoningCase {
  /** Stable id: system, city and item. */
  id: string;
  market: City;
  /** The city whose board hears it ("Plano"). */
  place: string;
  /** The case number when the agenda gives one ("Z245-123", "C14-2026-0042"). */
  file: string | null;
  title: string;
  kind: ZoningKind;
  /** The property types the request points at, from its wording. */
  uses: string[];
  body: string;
  /** YYYY-MM-DD of the hearing. */
  date: string;
  url: string;
}

export type ZoningKind = 'Rezoning' | 'Planned development' | 'Special use permit' | 'Plan amendment' | 'Variance';

/** Agenda wording that marks a zoning request about a property (not a code text change). */
const ZONING = /\b(re-?zon\w*|zoning (case|change|district|request)|change (of|in) zoning|zoned\b|planned development|\bPDD?\b|specific use permit|special use permit|conditional use permit|\bSUP\b|\bCUP\b|comprehensive plan amendment|plan amendment)/i;
/** Housekeeping items: minutes, code text amendments, appointments. */
const NOT_A_CASE =
  /\b(minutes|text amendment|amend(ing)? (chapter|section|article)|appoint|nominat|briefing on|work ?session|election|budget|re-?plat|plat|fence|carport|special exception|certificate of occupancy|right-of-way|abandonment|consultation with the city attorney)\b/i;

export function isZoningItem(title: string): boolean {
  return ZONING.test(title) && !NOT_A_CASE.test(title);
}

export function zoningKind(title: string): ZoningKind {
  if (/\b(variance|board of adjustment)\b/i.test(title)) return 'Variance';
  if (/\b(specific|special|conditional) use permit|\b[SC]UP\b/i.test(title)) return 'Special use permit';
  if (/\bplanned (unit )?development|\bPDD?\b/i.test(title)) return 'Planned development';
  if (/\b(future land use|comprehensive plan|plan amendment)\b/i.test(title)) return 'Plan amendment';
  return 'Rezoning';
}

const USES: [string, RegExp][] = [
  ['Multifamily', /\b(multi-?family|apartments?|MF-?\d+|townhom\w*|residential mixed|dwelling units)\b/i],
  ['Industrial', /\b(industrial|warehouse|distribution|logistics|manufactur\w*|light industrial|\bI-?[12]\b|\bLI\b|\bIR\b|\bIM\b|data cent\w*)\b/i],
  ['Retail', /\b(retail|commercial|shopping|restaurant|\bCR\b|\bGR\b|\bC-?[1-3]\b|\bCS\b|\bCO\b|gas station|convenience)\b/i],
  ['Office', /\boffice\b|\bO-?[12]\b|\bLO\b|\bGO\b/i],
  ['Mixed use', /\bmixed[- ]use\b|\bMU-?\d?\b|\bCBD\b|\bVMU\b/i],
  ['Hotel', /\b(hotel|motel|lodging)\b/i],
  ['Single family', /\b(single[- ]family|SF-?\d|R-?\d+(\.\d)?\(?A?\)?)\b/i]
];

export function zoningUses(title: string): string[] {
  return USES.filter(([, pattern]) => pattern.test(title)).map(([name]) => name);
}

/**
 * The case number in an item: "Z245-123", "C14-2026-0042", "PZRZ26-00015", "26P-041". District codes
 * ("MF-33") and highways ("IH-35") look alike but carry fewer digits.
 */
export function caseNumber(text: string): string | null {
  for (const match of String(text).matchAll(/\b(\d{0,4}[A-Z]{1,5}\d{0,4}-\d{2,5}(?:-\d{2,5})?(?:\.\d{2})?[A-Z]?)\b/g)) {
    if ((match[1]!.match(/\d/g) ?? []).length >= 4) return match[1]!;
  }
  return null;
}

/** Agenda text squeezed to one readable line. */
export function tidy(text: string, max = 420): string {
  const flat = String(text ?? '')
    .replace(/\s+/g, ' ')
    .trim();
  return flat.length > max ? `${flat.slice(0, max - 1).trimEnd()}…` : flat;
}

function day(iso: string): string {
  return String(iso).slice(0, 10);
}

/** How far back and ahead of today the alerts look. */
export const PAST_DAYS = 30;
export const AHEAD_DAYS = 60;

/* ------------------------------------------------------------ Legistar */

export interface LegistarClient {
  client: string;
  place: string;
  market: City;
}

export const LEGISTAR: LegistarClient[] = [
  { client: 'cityofdallas', place: 'Dallas', market: 'Dallas' },
  { client: 'plano', place: 'Plano', market: 'Dallas' },
  { client: 'mckinney', place: 'McKinney', market: 'Dallas' },
  { client: 'mesquite', place: 'Mesquite', market: 'Dallas' },
  { client: 'mansfield', place: 'Mansfield', market: 'Fort Worth' },
  { client: 'austintexas', place: 'Austin', market: 'Austin' },
  { client: 'roundrock', place: 'Round Rock', market: 'Austin' },
  { client: 'pflugerville', place: 'Pflugerville', market: 'Austin' },
  { client: 'sanmarcos', place: 'San Marcos', market: 'Austin' },
  { client: 'elpasotexas', place: 'El Paso', market: 'El Paso' },
  { client: 'newbraunfels', place: 'New Braunfels', market: 'New Braunfels' },
  { client: 'boerne', place: 'Boerne', market: 'San Antonio' },
  { client: 'leaguecity', place: 'League City', market: 'Galveston' }
];

/** The boards that hear zoning cases. */
const ZONING_BODY = /\b(plan|planning|zoning|council)\b/i;
/** Boards of adjustment hear fences and setbacks on single houses; landmark boards hear paint colors. */
const NOT_ZONING_BODY = /\b(adjustment|landmark|historic|appeals|steering|workshop)\b/i;

interface LegistarEvent {
  EventId: number;
  EventBodyName: string;
  EventDate: string;
  EventInSiteURL: string | null;
}

interface LegistarItem {
  EventItemId: number;
  EventItemTitle: string | null;
  EventItemMatterFile: string | null;
  EventItemMatterName: string | null;
  EventItemMatterType: string | null;
}

export function legistarCases(source: LegistarClient, event: LegistarEvent, items: LegistarItem[]): ZoningCase[] {
  const out: ZoningCase[] = [];
  for (const item of items) {
    const text = [item.EventItemMatterName, item.EventItemTitle].filter(Boolean).join(': ');
    const typed = /zoning|planned development|specific use|conditional use/i.test(item.EventItemMatterType ?? '');
    // Items without a file are section headings ("ZONING CASES - CONSENT") and boilerplate.
    if (!text || !item.EventItemMatterFile || !(typed ? !NOT_A_CASE.test(text) : isZoningItem(text))) continue;
    out.push({
      id: `legistar:${source.client}:${item.EventItemId}`,
      market: source.market,
      place: source.place,
      file: item.EventItemMatterFile || caseNumber(text),
      title: tidy(text),
      kind: zoningKind(`${item.EventItemMatterType ?? ''} ${text}`),
      uses: zoningUses(text),
      body: event.EventBodyName,
      date: day(event.EventDate),
      url: event.EventInSiteURL ?? `https://${source.client}.legistar.com/Calendar.aspx`
    });
  }
  return out;
}

async function readLegistar(source: LegistarClient, from: string, to: string, http: FetchJsonOptions): Promise<ZoningCase[]> {
  const base = `https://webapi.legistar.com/v1/${source.client}`;
  const filter = `EventDate ge datetime'${from}' and EventDate le datetime'${to}'`;
  const events = await fetchJson<LegistarEvent[]>(`${base}/events?$filter=${encodeURIComponent(filter)}&$orderby=EventDate`, http);
  const out: ZoningCase[] = [];
  for (const event of events.filter((e) => ZONING_BODY.test(e.EventBodyName) && !NOT_ZONING_BODY.test(e.EventBodyName))) {
    const items = await fetchJson<LegistarItem[]>(`${base}/events/${event.EventId}/eventitems?AgendaNote=1`, http).catch(() => []);
    out.push(...legistarCases(source, event, items));
  }
  return out;
}

/* ------------------------------------------------------------ CivicClerk */

export interface CivicClerkTenant {
  tenant: string;
  place: string;
  market: City;
}

export const CIVICCLERK: CivicClerkTenant[] = [
  { tenant: 'collegestationtx', place: 'College Station', market: 'College Station' },
  { tenant: 'midlandtx', place: 'Midland', market: 'Midland' },
  { tenant: 'galvestontx', place: 'Galveston', market: 'Galveston' }
];

interface CivicClerkEvent {
  id: number;
  eventName: string;
  categoryName?: string | null;
  startDateTime: string;
  agendaId: number;
}

export interface CivicClerkItem {
  id: number;
  agendaObjectItemName?: string | null;
  agendaObjectItemDescription?: string | null;
  agendaObjectItemOutlineNumber?: string | null;
  childItems?: CivicClerkItem[] | null;
  items?: CivicClerkItem[] | null;
}

function flatten(items: CivicClerkItem[] | null | undefined, out: CivicClerkItem[] = []): CivicClerkItem[] {
  for (const item of items ?? []) {
    out.push(item);
    flatten(item.childItems ?? item.items, out);
  }
  return out;
}

export function civicClerkCases(source: CivicClerkTenant, event: CivicClerkEvent, items: CivicClerkItem[]): ZoningCase[] {
  return flatten(items)
    .map((item) => ({ item, text: tidy(stripHtml([item.agendaObjectItemName, item.agendaObjectItemDescription].filter(Boolean).join(': ')), 600) }))
    .filter(({ text }) => text && isZoningItem(text))
    .map(({ item, text }) => ({
      id: `civicclerk:${source.tenant}:${item.id}`,
      market: source.market,
      place: source.place,
      file: caseNumber(text),
      title: tidy(text),
      kind: zoningKind(text),
      uses: zoningUses(text),
      body: event.eventName,
      date: day(event.startDateTime),
      url: `https://${source.tenant}.portal.civicclerk.com/event/${event.id}/overview`
    }));
}

async function readCivicClerk(source: CivicClerkTenant, from: string, to: string, http: FetchJsonOptions): Promise<ZoningCase[]> {
  const base = `https://${source.tenant}.api.civicclerk.com/v1`;
  const filter = `startDateTime gt ${from}T00:00:00Z and startDateTime lt ${to}T23:59:59Z`;
  const events = await fetchJson<{ value: CivicClerkEvent[] }>(`${base}/Events?$filter=${encodeURIComponent(filter)}&$orderby=startDateTime&$top=200`, http);
  const out: ZoningCase[] = [];
  for (const event of events.value.filter((e) => e.agendaId && ZONING_BODY.test(`${e.eventName} ${e.categoryName ?? ''}`) && !NOT_ZONING_BODY.test(e.eventName))) {
    const meeting = await fetchJson<{ items?: CivicClerkItem[] }>(`${base}/Meetings/${event.agendaId}`, http).catch(() => null);
    out.push(...civicClerkCases(source, event, meeting?.items ?? []));
  }
  return out;
}

/* ------------------------------------------------------------ PrimeGov */

export const PRIMEGOV = { portal: 'https://sanantonio.primegov.com', place: 'San Antonio', market: 'San Antonio' as City };

interface PrimeGovMeeting {
  id: number;
  title: string;
  dateTime: string;
  documentList: { templateId: number; templateName: string }[];
}

export function stripHtml(html: string): string {
  return String(html ?? '')
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<br\s*\/?>|<\/(p|div|td|tr|li)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&rsquo;|&lsquo;/g, "'")
    .replace(/&ldquo;|&rdquo;/g, '"')
    .replace(/&ndash;|&mdash;/g, '-')
    .replace(/&#(\d+);/g, (_, code: string) => (Number(code) === 160 ? ' ' : String.fromCodePoint(Number(code))))
    .replace(/&[a-z]+;/g, ' ')
    // Cloudflare hides email addresses on the page; the placeholder says nothing.
    .replace(/\[email\s*protected\]/gi, '');
}

/**
 * San Antonio's zoning cases from one HTML agenda. Each case is an agenda
 * item whose text carries a case number like "ZONING CASE Z-2026-10700123"
 * or "PLAN AMENDMENT CASE PA-2026-11600045".
 */
export function primeGovCases(meeting: PrimeGovMeeting, html: string, url: string): ZoningCase[] {
  const text = stripHtml(html);
  const out = new Map<string, ZoningCase>();
  // Headings are upper case; "Zoning Case Z-…" in mixed case is a plan amendment pointing at its companion case.
  const pattern = /((?:ZONING|PLAN AMENDMENT)\s+CASE\s+(?:NUMBER\s+|#\s*)?((?:Z|PA)-?\d{4}-?\d+(?:\s*\([A-Z ]+\))?))([\s\S]{0,700}?)(?=(?:ZONING|PLAN AMENDMENT)\s+CASE|\n\s*\n\s*\d+\.|$)/g;
  for (const match of text.matchAll(pattern)) {
    const file = match[2]!.replace(/\s+/g, ' ').trim();
    if (out.has(file)) continue;
    const title = tidy(`${match[1]} ${match[3]}`);
    out.set(file, {
      id: `primegov:sanantonio:${meeting.id}:${file}`,
      market: PRIMEGOV.market,
      place: PRIMEGOV.place,
      file,
      title,
      kind: /^PA/i.test(file) ? 'Plan amendment' : zoningKind(title),
      uses: zoningUses(title),
      body: meeting.title.trim(),
      date: day(meeting.dateTime),
      url
    });
  }
  return [...out.values()];
}

async function readPrimeGov(from: string, to: string, http: FetchJsonOptions): Promise<ZoningCase[]> {
  const year = Number(from.slice(0, 4));
  const lists = await Promise.all([
    fetchJson<PrimeGovMeeting[]>(`${PRIMEGOV.portal}/api/v2/PublicPortal/ListUpcomingMeetings`, http),
    fetchJson<PrimeGovMeeting[]>(`${PRIMEGOV.portal}/api/v2/PublicPortal/ListArchivedMeetings?year=${year}`, http),
    ...(Number(to.slice(0, 4)) !== year ? [fetchJson<PrimeGovMeeting[]>(`${PRIMEGOV.portal}/api/v2/PublicPortal/ListArchivedMeetings?year=${to.slice(0, 4)}`, http)] : [])
  ]);
  const seen = new Set<number>();
  const meetings = lists
    .flat()
    .filter((m) => !seen.has(m.id) && seen.add(m.id))
    .filter((m) => /zoning commission|planning commission|city council a session|zoning and land use/i.test(m.title))
    .filter((m) => day(m.dateTime) >= from && day(m.dateTime) <= to);
  const out: ZoningCase[] = [];
  for (const meeting of meetings) {
    const doc = meeting.documentList.find((d) => /html (english )?agenda/i.test(d.templateName));
    if (!doc) continue;
    const url = `${PRIMEGOV.portal}/Portal/Meeting?meetingTemplateId=${doc.templateId}`;
    const html = await fetchText(url, http).catch(() => '');
    out.push(...primeGovCases(meeting, html, url));
  }
  return out;
}

/* ------------------------------------------------------------ All */

export interface ZoningResult {
  asOf: string;
  cases: ZoningCase[];
  /** Places that answered, for the page's coverage note. */
  covered: string[];
  failed: string[];
}

export interface FetchZoningOptions extends FetchJsonOptions {
  now?: Date;
  log?: (line: string) => void;
}

export async function fetchZoning(options: FetchZoningOptions = {}): Promise<ZoningResult> {
  const { now = new Date(), log = () => {} } = options;
  const http: FetchJsonOptions = { timeoutMs: 30_000, retries: 1, ...options };
  const from = new Date(now.getTime() - PAST_DAYS * 86_400_000).toISOString().slice(0, 10);
  const to = new Date(now.getTime() + AHEAD_DAYS * 86_400_000).toISOString().slice(0, 10);
  const jobs: [string, () => Promise<ZoningCase[]>][] = [
    ...LEGISTAR.map((s): [string, () => Promise<ZoningCase[]>] => [s.place, () => readLegistar(s, from, to, http)]),
    ...CIVICCLERK.map((s): [string, () => Promise<ZoningCase[]>] => [s.place, () => readCivicClerk(s, from, to, http)]),
    [PRIMEGOV.place, () => readPrimeGov(from, to, http)]
  ];
  const cases: ZoningCase[] = [];
  const covered: string[] = [];
  const failed: string[] = [];
  // A few at a time: these are small city servers.
  for (let i = 0; i < jobs.length; i += 4) {
    const batch = jobs.slice(i, i + 4);
    const results = await Promise.allSettled(batch.map(([, run]) => run()));
    results.forEach((result, n) => {
      const place = batch[n]![0];
      if (result.status === 'fulfilled') {
        covered.push(place);
        cases.push(...result.value);
        log(`${place}: ${result.value.length} zoning items`);
      } else {
        failed.push(place);
        log(`${place}: failed (${result.reason instanceof Error ? result.reason.message : String(result.reason)})`);
      }
    });
  }
  // The same case is often on the commission's and the council's agendas: keep both hearings, drop exact repeats.
  const seen = new Set<string>();
  const unique = cases.filter((c) => {
    const key = `${c.place}|${c.file ?? c.title}|${c.date}|${c.body}`.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  unique.sort((a, b) => a.date.localeCompare(b.date) || a.place.localeCompare(b.place));
  return { asOf: now.toISOString(), cases: unique, covered, failed };
}

/** A failed place keeps its cases from the last build that read it. */
export function keepZoning(next: ZoningResult, previous: ZoningResult | null | undefined): ZoningResult {
  if (!previous || !next.failed.length) return next;
  const kept = previous.cases.filter((c) => next.failed.includes(c.place));
  return { ...next, cases: [...next.cases, ...kept].sort((a, b) => a.date.localeCompare(b.date) || a.place.localeCompare(b.place)) };
}
