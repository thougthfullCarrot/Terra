import { fetchJson, fetchText } from '../lib/http.js';
import { decodeXml } from '../news/googleNews.js';
import { CITIES, type City } from '../types.js';
import { addressCity, courseSessions, SERIES_SPAN_DAYS, deadlineIn, eligibilityIn, guessFormat, joinDays, ldDetails, mergeListing, price, shortText, titleStatus, topicOf, type Details } from './enrich.js';

/**
 * Real estate networking and industry events for each Terra city, read from
 * chapter calendars that publish machine-readable listings and whose
 * robots.txt allows it. Only title, date, venue, cost and link are kept; each
 * event opens on the organizer's site. Sites that refuse automated requests
 * (ULI and IREM chapters answer 403) are left out on purpose, and a source that
 * starts refusing is skipped for that run (its earlier events are kept).
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
  /** True when the source gave only dates (no clock time): shown as "Time not listed", not "All day". */
  dateOnly?: boolean;
  /** True when the page says the time is TBD or prints none: shown as "Time not confirmed", never a guessed clock time. */
  timeUnconfirmed?: boolean;
  /** IANA zone of the venue's local times: America/Chicago, or America/Denver for El Paso. */
  timezone?: TimeZone;
  /** Where to register when it differs from the event page (offers.url, ticket links). */
  registrationUrl?: string | null;
  /** Street address when the source gives one; city attribution follows it. */
  address?: string | null;
  /** Absent when the source does not say. Virtual events stay listed under their organizer's market. */
  format?: EventFormat;
  /** True only when the source lists the event as free (price 0 or "Free"). */
  free?: boolean;
  /** Last day/time to register, when the source lists one (never the publishing date). */
  registrationDeadline?: string | null;
  /** Who may attend or a student/member price note, as the source words it. */
  eligibility?: string | null;
  /** Up to 300 characters of the source's own description. */
  description?: string | null;
  topic?: EventTopic;
  /** Absent means scheduled. Cancelled and sold-out events stay listed, marked, until they pass. */
  status?: EventStatus;
  /** The earlier start when the organizer moved the event (schema.org previousStartDate, or a changed start since the last build). */
  rescheduledFrom?: string | null;
  /** One id for every occurrence of a repeating event. */
  seriesId?: string;
  /** EventSource.key, or "manual". */
  sourceKey?: string;
  /** When Terra last read this event from its source. Kept (not refreshed) when the source fails. */
  verifiedAt?: string;
  /** True when the source could not be read this run and the event comes from an earlier build. */
  stale?: boolean;
  /** A course or series sold as one registration: its dated sessions (start/end are the first and last). */
  sessions?: Array<{ start: string; end: string | null }>;
  /** Wording on the organizer's page that disagrees with itself (session counts), shown as a warning. */
  conflicts?: string[];
  /**
   * For a course: open (first session ahead, registration not closed), closed (page says registration is closed),
   * or in-progress (first session has passed; listed until its last session, not as something to sign up for).
   */
  enrollment?: 'open' | 'closed' | 'in-progress';
  /** A listing spans a week or more and its page names no session dates: shown with its range, never exported as one block. */
  spanUnverified?: boolean;
}

export type TimeZone = 'America/Chicago' | 'America/Denver';
export type EventFormat = 'in-person' | 'virtual' | 'hybrid';
export type EventStatus = 'scheduled' | 'cancelled' | 'postponed' | 'rescheduled' | 'sold-out';
export type EventTopic = 'Networking' | 'Property tour' | 'Panel' | 'Career fair' | 'Conference' | 'Education' | 'Luncheon' | 'Social';

/** Every market is on Central time except El Paso (Mountain). */
export function zoneOf(city: City): TimeZone {
  return city === 'El Paso' ? 'America/Denver' : 'America/Chicago';
}

export interface EventSource {
  /** Stable key, used as the id prefix. */
  key: string;
  organizer: string;
  city: City;
  kind: 'tribe' | 'growthzone' | 'jsonld' | 'pages' | 'localist' | 'livewhale' | 'sitemap';
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
  /** sitemap: path prefix of event pages in the sitemap (page is the sitemap). */
  sitemapPath?: string;
  /** Place each event in the market its address names (a group meeting in more than one city); source.city otherwise. */
  cityFromVenue?: boolean;
  /**
   * Venue or group wording that puts an event at a campus in another market (Texas A&M's law school is in
   * Fort Worth, not College Station). Checked after the street address and before the source's own city.
   */
  places?: Array<[RegExp, City]>;
  /** localist, livewhale: the search words (a university calendar lists every event on campus). */
  keyword?: string;
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
  { key: 'aia-sa', organizer: 'AIA San Antonio', city: 'San Antonio', kind: 'pages', base: 'https://aiasa.org', page: 'https://aiasa.org/events/', detailPath: '/events/' },
  // Chamber calendars (GrowthZone): only networking, real estate and economic events (see RELEVANT).
  { key: 'metro-sa', organizer: 'Metro SA Chamber', city: 'San Antonio', kind: 'growthzone', base: 'https://members.metrosa.com', page: 'https://members.metrosa.com/events/calendar', relevantOnly: true },
  { key: 'sotx-partnership', organizer: 'South Texas Business Partnership', city: 'San Antonio', kind: 'growthzone', base: 'https://business.southtexaspartnership.org', relevantOnly: true },
  { key: 'boerne-chamber', organizer: 'Boerne Chamber', city: 'San Antonio', kind: 'growthzone', base: 'https://business.boerne.org', page: 'https://business.boerne.org/events/calendar', relevantOnly: true },
  { key: 'nb-chamber', organizer: 'New Braunfels Chamber', city: 'New Braunfels', kind: 'growthzone', base: 'https://newbraunfelschamber.growthzoneapp.com', relevantOnly: true },
  { key: 'elpaso-chamber', organizer: 'El Paso Chamber', city: 'El Paso', kind: 'growthzone', base: 'https://members.elpaso.org', relevantOnly: true },
  { key: 'fw-chamber', organizer: 'Fort Worth Chamber', city: 'Fort Worth', kind: 'growthzone', base: 'https://business.fortworthchamber.com', relevantOnly: true },
  { key: 'woodlands-chamber', organizer: 'The Woodlands Area Chamber', city: 'Houston', kind: 'growthzone', base: 'https://business.woodlandschamber.org', relevantOnly: true },
  { key: 'bcs-chamber', organizer: 'Bryan-College Station Chamber', city: 'College Station', kind: 'growthzone', base: 'https://business.bcschamber.org', relevantOnly: true },
  { key: 'league-city-chamber', organizer: 'League City Chamber', city: 'Galveston', kind: 'growthzone', base: 'https://business.leaguecitychamber.com', relevantOnly: true },
  { key: 'lubbock-chamber', organizer: 'Lubbock Chamber', city: 'Lubbock', kind: 'growthzone', base: 'https://business.lubbockchamber.com', relevantOnly: true },
  { key: 'midland-chamber', organizer: 'Midland Chamber', city: 'Midland', kind: 'growthzone', base: 'https://business.midlandtxchamber.com', relevantOnly: true },
  // Young professionals and women in CRE: YCRAN (San Antonio and Austin, Wix) and CREW chapters (Next.js pages with
  // startDate microdata); event pages come from each site's sitemap.
  { key: 'ycran', organizer: 'YCRAN', city: 'San Antonio', kind: 'sitemap', base: 'https://www.ycran.org', page: 'https://www.ycran.org/event-pages-sitemap.xml', sitemapPath: '/event-details/', cityFromVenue: true },
  ...['Houston', 'Dallas', 'Austin', 'San Antonio', 'Fort Worth'].map((city) => crew(city as City)),
  // University calendars (Localist's public API), searched for real estate: student CRE clubs, career and industry talks.
  { key: 'unt', organizer: 'UNT', city: 'Dallas', kind: 'localist', base: 'https://calendar.unt.edu', keyword: 'real estate' },
  { key: 'utd', organizer: 'UT Dallas', city: 'Dallas', kind: 'localist', base: 'https://calendar.utdallas.edu', keyword: 'real estate' },
  { key: 'uta', organizer: 'UT Arlington', city: 'Fort Worth', kind: 'localist', base: 'https://events.uta.edu', keyword: 'real estate' },
  // McCombs runs its working-professional MBA classes and alumni events in Dallas, Houston and San Antonio.
  { key: 'ut-austin', organizer: 'UT Austin', city: 'Austin', kind: 'localist', base: 'https://calendar.utexas.edu', keyword: 'real estate', places: [[/\bDallas\b/i, 'Dallas'], [/\bHouston\b/i, 'Houston'], [/San Antonio/i, 'San Antonio']] },
  { key: 'tcu', organizer: 'TCU', city: 'Fort Worth', kind: 'localist', base: 'https://calendar.tcu.edu', keyword: 'real estate' },
  { key: 'trinity', organizer: 'Trinity University', city: 'San Antonio', kind: 'localist', base: 'https://events.trinity.edu', keyword: 'real estate' },
  // LiveWhale university calendars (public JSON search): Texas A&M (College Station) and Rice (Houston).
  {
    key: 'tamu',
    organizer: 'Texas A&M',
    city: 'College Station',
    kind: 'livewhale',
    base: 'https://calendar.tamu.edu',
    keyword: 'real estate',
    // calendar.tamu.edu covers every campus: the School of Law (LEB, Law and Education Building) is downtown
    // Fort Worth, TAMUG is Galveston, and the Health Science Center sites in Houston.
    places: [
      [/\bLEB\b|Law (?:and|&) Education Building|School of Law|· Law$/i, 'Fort Worth'],
      [/\bTAMUG\b|Galveston|Pelican Island/i, 'Galveston'],
      [/Texas Medical Center|\bTMC\b|\bHouston\b/i, 'Houston']
    ]
  },
  { key: 'rice', organizer: 'Rice University', city: 'Houston', kind: 'livewhale', base: 'https://events.rice.edu', keyword: 'real estate' },
  // Architecture chapters on The Events Calendar: only their networking, development and industry events.
  { key: 'aia-dallas', organizer: 'AIA Dallas', city: 'Dallas', kind: 'tribe', base: 'https://www.aiadallas.org', relevantOnly: true },
  { key: 'aia-houston', organizer: 'AIA Houston', city: 'Houston', kind: 'tribe', base: 'https://aiahouston.org', relevantOnly: true }
];

/** A CREW Network chapter site: <city>.crewnetwork.org. */
function crew(city: City): EventSource {
  const slug = city.toLowerCase().replace(/\s+/g, '-');
  return { key: `crew-${slug}`, organizer: `CREW ${city}`, city, kind: 'sitemap', base: `https://${slug}.crewnetwork.org`, page: `https://${slug}.crewnetwork.org/sitemap.xml`, sitemapPath: '/events/' };
}

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

/**
 * The zone floating local times are read in while one source is parsed (fetchSource sets it; sources are read one at a
 * time). Central unless the source's market is El Paso.
 */
let parseZone: TimeZone = 'America/Chicago';

/** "2026-10-14 11:30:00" (the venue's local time; Central unless a Mountain zone is given or being parsed) → ISO with offset. */
export function centralIso(local: string, zone: TimeZone = parseZone): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?/.exec(local.trim());
  if (!m) return null;
  const [, y, mo, d, h = '00', mi = '00', s = '00'] = m;
  // US Central: CDT (-05:00) from the 2nd Sunday of March to the 1st Sunday of November.
  const year = Number(y);
  const firstSunday = (month: number) => 1 + ((7 - new Date(Date.UTC(year, month, 1)).getUTCDay()) % 7);
  const key = Number(mo) * 100 + Number(d);
  const springDay = 300 + firstSunday(2) + 7;
  const fallDay = 1100 + firstSunday(10);
  // The clocks change at 2:00 AM local: the early hours of the change day still keep the old offset.
  const early = Number(h) < 2;
  const dst = (key > springDay || (key === springDay && !early)) && (key < fallDay || (key === fallDay && early));
  // US Mountain (El Paso) follows the same daylight dates one hour behind.
  const offset = zone === 'America/Denver' ? (dst ? '-06:00' : '-07:00') : dst ? '-05:00' : '-06:00';
  return `${y}-${mo}-${d}T${h}:${mi}:${s}${offset}`;
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
  all_day?: boolean;
  website?: string;
  description?: string;
  is_virtual?: boolean;
  cost_details?: { values?: string[] };
  venue?: { venue?: string; address?: string; city?: string; state?: string; zip?: string } | unknown[];
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
    const address = v ? [v.address, v.city, [v.state, v.zip].filter(Boolean).join(' ')].map((x) => decodeText(x ?? '')).filter(Boolean).join(', ') : '';
    const cost = price(e.cost_details?.values?.length === 1 ? e.cost_details.values[0] : e.cost);
    // An all-day event: its local dates, not the UTC instants (which fall on the evening before).
    const allDay = e.all_day === true && e.start_date;
    out.push({
      id: `${source.key}-${e.id ?? url}`,
      title,
      url,
      start: allDay ? centralIso(e.start_date!.slice(0, 10))! : start,
      end: allDay ? (e.end_date && e.end_date.slice(0, 10) > e.start_date!.slice(0, 10) ? centralIso(e.end_date.slice(0, 10)) : null) : end,
      city: source.city,
      organizer: source.organizer,
      venue: venue || null,
      cost: decodeText(cost.cost ?? '') || null,
      ...(cost.free ? { free: true } : {}),
      ...(address ? { address } : {}),
      ...(httpUrl(e.website) && httpUrl(e.website) !== url ? { registrationUrl: httpUrl(e.website) } : {}),
      ...(e.is_virtual ? { format: v ? 'hybrid' : 'virtual' } : {}),
      ...(e.description ? { description: shortText(decodeText(e.description)) } : {})
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

/** The day before an ISO date's calendar day, at Central midnight. */
function dayBefore(iso: string): string | null {
  const d = new Date(`${iso.slice(0, 10)}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return centralIso(d.toISOString().slice(0, 10));
}

/** True when an iCal date value carries no clock time (VALUE=DATE). */
function icsDateOnly(value: string): boolean {
  return /^\d{8}$/.test(value.trim());
}

function icsText(value: string): string {
  return value.replace(/\\n/gi, ' ').replace(/\\([,;\\])/g, '$1').replace(/\s+/g, ' ').trim();
}

/** Events in an iCal (or vCalendar 1.0) file; fallbackUrl stands in when an event has no URL line. */
export function parseIcs(text: string, source: EventSource, fallbackUrl?: string, now?: Date): TerraEvent[] {
  if (!/BEGIN:VCALENDAR/.test(text)) return [];
  const unfolded = text.replace(/\r?\n[ \t]/g, '');
  const out: TerraEvent[] = [];
  const overrides = new Map<string, TerraEvent>();
  for (const [, block = ''] of unfolded.matchAll(/BEGIN:VEVENT([\s\S]*?)END:VEVENT/g)) {
    const field = (name: string) => {
      const m = new RegExp(`^${name}(?:;[^:\\r\\n]*)?:(.*)$`, 'mi').exec(block);
      return m ? (m[1] ?? '').trim() : '';
    };
    const title = icsText(field('SUMMARY'));
    const url = httpUrl(field('URL')) ?? httpUrl(fallbackUrl);
    const start = icsDate(field('DTSTART'));
    if (!title || !url || !start) continue;
    const dateOnly = icsDateOnly(field('DTSTART'));
    let end = icsDate(field('DTEND'));
    // An iCal all-day DTEND is exclusive (the day after the last day); store the last day itself,
    // as every other source does, so calendar exports add exactly one day back.
    if (end && icsDateOnly(field('DTEND'))) {
      const last = dayBefore(end);
      end = last && last.slice(0, 10) > start.slice(0, 10) ? last : null;
    }
    const status = /^cancel+ed$/i.test(field('STATUS')) ? ({ status: 'cancelled' } as const) : {};
    const description = shortText(icsText(field('DESCRIPTION')));
    const base: TerraEvent = {
      id: `${source.key}-${field('UID') || url}`,
      title,
      url,
      start,
      end,
      ...(dateOnly ? { dateOnly: true } : {}),
      city: source.city,
      organizer: source.organizer,
      venue: icsText(field('LOCATION')) || null,
      cost: null,
      ...status,
      ...(description ? { description } : {})
    };
    const rrule = field('RRULE');
    const recurrenceId = icsDate(field('RECURRENCE-ID'));
    if (recurrenceId) {
      // One changed occurrence of a series: replaces the generated one at that time (below).
      overrides.set(`${field('UID')}|${recurrenceId}`, { ...base, id: `${base.id}-${start.slice(0, 10)}`, seriesId: base.id });
      continue;
    }
    if (rrule) {
      const exdates = new Set([...block.matchAll(/^EXDATE(?:;[^:\r\n]*)?:(.*)$/gim)].flatMap((m) => (m[1] ?? '').split(',')).map((v) => icsDate(v)).filter(Boolean));
      for (const at of expandRrule(start, rrule, now ?? new Date())) {
        if (exdates.has(at)) continue;
        const shift = end ? new Date(end).getTime() - new Date(start).getTime() : 0;
        const occEnd = end ? shiftIso(at, shift) : null;
        out.push({ ...base, id: `${base.id}-${at.slice(0, 10)}`, seriesId: base.id, start: at, end: occEnd, _key: `${field('UID')}|${at}` } as TerraEvent);
      }
      continue;
    }
    out.push(base);
  }
  // Apply single-occurrence changes (a moved or cancelled meeting of a series).
  const final = out.map((e) => {
    const key = (e as TerraEvent & { _key?: string })._key;
    const { _key: _drop, ...rest } = e as TerraEvent & { _key?: string };
    const o = key ? overrides.get(key) : undefined;
    if (key) overrides.delete(key);
    return o ? { ...o, ...(o.start !== rest.start ? { rescheduledFrom: rest.start } : {}) } : rest;
  });
  return [...final, ...overrides.values()];
}

/** The same wall-clock instant moved by ms, keeping the source's offset form (Z or ±hh:mm). */
function shiftIso(iso: string, ms: number): string {
  const t = new Date(new Date(iso).getTime() + ms);
  if (/Z$/.test(iso)) return t.toISOString().replace(/\.\d{3}Z$/, 'Z');
  const local = new Date(t.getTime() + offsetMs(iso));
  return centralIso(local.toISOString().slice(0, 19).replace('T', ' '))!;
}

function offsetMs(iso: string): number {
  const m = /([+-])(\d{2}):(\d{2})$/.exec(iso);
  return m ? (m[1] === '-' ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3])) * 60_000 : 0;
}

const WEEKDAYS = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];

/**
 * The occurrences of an iCal RRULE from now through the event window: DAILY, WEEKLY (BYDAY list) and MONTHLY (BYDAY
 * with an ordinal such as 2TU or -1FR, or the start's day of month), with INTERVAL, COUNT and UNTIL. Times keep the
 * series' local clock time across daylight-time changes. At most 60 occurrences; other rules give just the first.
 */
export function expandRrule(start: string, rule: string, now: Date, days = WINDOW_DAYS): string[] {
  const parts = Object.fromEntries(rule.split(';').map((p) => p.split('=') as [string, string]));
  const freq = parts.FREQ;
  const interval = Math.max(1, Number(parts.INTERVAL ?? 1) || 1);
  const count = parts.COUNT ? Number(parts.COUNT) : Infinity;
  const until = parts.UNTIL ? new Date(icsDate(parts.UNTIL) ?? '').getTime() : Infinity;
  const limit = Math.min(until, now.getTime() + days * 86_400_000);
  const utc = /Z$/.test(start);
  const local = utc ? start.slice(11, 19) : start.slice(11, 19);
  const at = (ymd: string) => (utc ? `${ymd}T${local}Z` : centralIso(`${ymd} ${local}`)!);
  const first = start.slice(0, 10);
  const byday = (parts.BYDAY ?? '').split(',').filter(Boolean);
  if (!['DAILY', 'WEEKLY', 'MONTHLY'].includes(freq ?? '')) return [start];
  const out: string[] = [];
  let made = 0;
  const day = new Date(`${first}T12:00:00Z`);
  for (let guard = 0; guard < 3000 && out.length < 60; guard++) {
    const ymd = day.toISOString().slice(0, 10);
    const when = at(ymd);
    if (new Date(when).getTime() > limit || made >= count) break;
    if (matches(day)) {
      made++;
      if (new Date(when).getTime() >= now.getTime() - 86_400_000) out.push(when);
    }
    day.setUTCDate(day.getUTCDate() + 1);
  }
  return out;

  function matches(d: Date): boolean {
    const startDay = new Date(`${first}T12:00:00Z`);
    const diffDays = Math.round((d.getTime() - startDay.getTime()) / 86_400_000);
    if (freq === 'DAILY') return diffDays % interval === 0;
    if (freq === 'WEEKLY') {
      const week = Math.floor((diffDays + startDay.getUTCDay()) / 7);
      if (week % interval) return false;
      return byday.length ? byday.some((b) => b.slice(-2) === WEEKDAYS[d.getUTCDay()]) : d.getUTCDay() === startDay.getUTCDay();
    }
    const months = (d.getUTCFullYear() - startDay.getUTCFullYear()) * 12 + d.getUTCMonth() - startDay.getUTCMonth();
    if (months % interval) return false;
    if (!byday.length) return d.getUTCDate() === startDay.getUTCDate();
    return byday.some((b) => {
      const m = /^([+-]?\d)?([A-Z]{2})$/.exec(b);
      if (!m || m[2] !== WEEKDAYS[d.getUTCDay()]) return false;
      if (!m[1]) return true;
      const n = Number(m[1]);
      const dom = d.getUTCDate();
      const dim = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
      return n > 0 ? Math.ceil(dom / 7) === n : Math.ceil((dim - dom + 1) / 7) === -n;
    });
  }
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

/** True when an ISO time is midnight on its own (Central) calendar day: a date with no clock time. */
export function isMidnight(iso: string | null | undefined): boolean {
  if (!iso) return false;
  const m = /T00:00(?::00)?(?:\.0+)?(-0[567]:00)$/.exec(String(iso));
  // Midnight in Central (-05/-06) or, for El Paso, Mountain (-06/-07) on that date.
  const day = String(iso).slice(0, 10);
  return Boolean(m) && [centralIso(day, 'America/Chicago'), centralIso(day, 'America/Denver')].some((x) => x!.endsWith(m![1]!));
}

function clock(h: string, m: string | undefined, meridian: string): string {
  let hour = Number(h) % 12;
  if (/p/i.test(meridian)) hour += 12;
  return `${String(hour).padStart(2, '0')}:${m ?? '00'}:00`;
}

/**
 * The clock times printed next to the event's date on its page ("October 15, 2026 5:30 PM - 7:30 PM"),
 * for pages whose structured data gives only midnight. Only text right after the event's own date is
 * read, so a chamber's office hours elsewhere on the page are never taken for the event's time.
 */
export function visibleTimes(html: string, day: string): { start: string; end: string | null } | null {
  const text = decodeText(html.replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, ' ')).replace(/\s+/g, ' ');
  const [y, mo, d] = day.split('-').map(Number) as [number, number, number];
  const month = MONTHS[mo - 1]!; // lowercase; the pattern ignores case
  const dates = [new RegExp(`\\b(${month}|${month.slice(0, 3)}\\.?)\\s+${d}(st|nd|rd|th)?,?\\s+${y}\\b`, 'i'), new RegExp(`\\b0?${mo}/0?${d}/${y}\\b`)];
  for (const pattern of dates) {
    const at = pattern.exec(text);
    if (!at) continue;
    const near = text.slice(at.index, at.index + at[0].length + 120);
    const range = /\b(\d{1,2})(?::(\d{2}))?\s*([ap])?\.?\s*m?\.?\s*(?:-|–|—|to)\s*(\d{1,2})(?::(\d{2}))?\s*([ap])\.?\s*m\b\.?/i.exec(near.slice(at[0].length));
    if (range) {
      const [, h1, m1, ap1, h2, m2, ap2] = range;
      const startClock = clock(h1!, m1, ap1 ?? ap2!);
      const endClock = clock(h2!, m2, ap2!);
      return { start: centralIso(`${day} ${startClock}`)!, end: centralIso(`${day} ${endClock}`)! };
    }
    const single = /\b(\d{1,2})(?::(\d{2}))?\s*([ap])\.?\s*m\b/i.exec(near.slice(at[0].length));
    if (single) return { start: centralIso(`${day} ${clock(single[1]!, single[2], single[3]!)}`)!, end: null };
  }
  return null;
}

/**
 * Start/end/venue from a GrowthZone details page: schema.org JSON-LD first, then itemprop microdata.
 * When those give only midnight, the times printed beside the date are used; dateOnly is true when
 * the page lists no clock time at all.
 */
export function parseGrowthZoneDetail(html: string): { title?: string; start: string | null; end: string | null; venue: string | null; dateOnly: boolean } {
  const found = structuredDetail(html);
  if (!found.start || !isMidnight(found.start)) return { ...found, dateOnly: false };
  const times = visibleTimes(html, found.start.slice(0, 10));
  if (times) return { ...found, start: times.start, end: times.end, dateOnly: false };
  return { ...found, dateOnly: true };
}

function structuredDetail(html: string): { title?: string; start: string | null; end: string | null; venue: string | null } {
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
  itemListElement?: unknown[];
  item?: unknown;
  name?: string;
  url?: string;
  startDate?: string;
  endDate?: string;
  location?: { name?: string; '@type'?: string } | Array<{ name?: string }> | string;
  offers?: { price?: string | number } | Array<{ price?: string | number }>;
}

function ldNodes(data: unknown): LdEvent[] {
  if (Array.isArray(data)) return data.flatMap(ldNodes);
  if (!data || typeof data !== 'object') return [];
  const n = data as LdEvent;
  // Search and listing pages can wrap their events in an ItemList of ListItems.
  return [n, ...(n['@graph'] ? ldNodes(n['@graph']) : []), ...(n.itemListElement ? ldNodes(n.itemListElement) : []), ...(n.item ? ldNodes(n.item) : [])];
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
      const details = ldDetails(n as Record<string, unknown>, normalizeDate);
      const { locations, ...extra } = details;
      const place = locations[0] ?? (typeof loc === 'object' && !/Virtual/i.test(String((loc as { '@type'?: string })['@type'])) ? loc : undefined);
      const venue = typeof loc === 'string' ? loc : place?.name;
      out.push({
        ...clean(extra),
        id: `${source.key}-${url}`,
        title,
        url,
        start,
        end: n.endDate ? normalizeDate(n.endDate) : null,
        city: source.city,
        organizer: source.organizer,
        venue: venue ? decodeText(venue) || null : null,
        cost: extra.cost ?? null
      });
    }
  }
  return out;
}

/** Details without the undefined and null keys (so they never overwrite a value when spread). */
function clean(details: Details): Details {
  return Object.fromEntries(Object.entries(details).filter(([, v]) => v !== undefined && v !== null && v !== '')) as Details;
}

/** The schema.org details of the first Event on a detail page (registration, price, format, status...). */
export function pageDetails(html: string): Details {
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
      const { locations: _l, ...extra } = ldDetails(n as Record<string, unknown>, normalizeDate);
      return clean(extra);
    }
  }
  return {};
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

// ---- Localist (university calendars) ----

export function localistUrl(source: EventSource): string {
  return `${source.base}/api/2/events?${new URLSearchParams({ days: String(WINDOW_DAYS), pp: '100', keyword: source.keyword ?? 'real estate' })}`;
}

interface LocalistEvent {
  id?: number;
  title?: string;
  localist_url?: string;
  location_name?: string;
  ticket_cost?: string;
  ticket_url?: string;
  free?: boolean;
  address?: string;
  description_text?: string;
  experience?: string;
  status?: string;
  event_instances?: Array<{ event_instance?: { start?: string; end?: string | null } }>;
}

/** One event per instance (the API returns instances from today on); a repeating listing's instances share a seriesId. */
export function parseLocalist(body: { events?: Array<{ event?: LocalistEvent }> } | null, source: EventSource): TerraEvent[] {
  const out: TerraEvent[] = [];
  for (const { event: e } of body?.events ?? []) {
    const url = httpUrl(e?.localist_url);
    const title = decodeText(e?.title ?? '');
    const instances = (e?.event_instances ?? []).map((i) => i.event_instance).filter((i) => i?.start).slice(0, 30);
    for (const at of instances) {
    const start = at?.start ? normalizeDate(at.start) : null;
    if (!e || !url || !title || !start) continue;
    const many = instances.length > 1;
    out.push({
      id: many ? `${source.key}-${e.id ?? url}-${start.slice(0, 10)}` : `${source.key}-${e.id ?? url}`,
      ...(many ? { seriesId: `${source.key}-${e.id ?? url}` } : {}),
      title,
      url,
      start,
      end: at?.end ? normalizeDate(at.end) : null,
      city: source.city,
      organizer: source.organizer,
      venue: decodeText(e.location_name ?? '') || null,
      cost: e.free ? 'Free' : decodeText(e.ticket_cost ?? '') || null,
      ...(e.free ? { free: true } : {}),
      ...(httpUrl(e.ticket_url) && httpUrl(e.ticket_url) !== url ? { registrationUrl: httpUrl(e.ticket_url) } : {}),
      ...(e.address ? { address: decodeText(e.address) } : {}),
      ...(e.experience === 'virtual' ? { format: 'virtual' as const } : e.experience === 'hybrid' ? { format: 'hybrid' as const } : e.experience === 'inperson' ? { format: 'in-person' as const } : {}),
      ...(e.status === 'cancelled' ? { status: 'cancelled' as const } : {}),
      ...(e.description_text ? { description: shortText(e.description_text) } : {})
    });
    }
  }
  return out;
}

// ---- LiveWhale (university calendars) ----

export function liveWhaleUrl(source: EventSource): string {
  return `${source.base}/live/json/events/search/${encodeURIComponent(source.keyword ?? 'real estate')}/max/50`;
}

interface LiveWhaleEvent {
  id?: number;
  title?: string;
  url?: string;
  date_iso?: string;
  date2_iso?: string;
  is_all_day?: boolean | number;
  location?: string;
  location_title?: string;
  cost?: string;
  summary?: string;
  description?: string;
  registration?: string;
  online_type?: string;
  is_canceled?: boolean | number;
  group_title?: string;
  repeats?: string | null;
}

/** Events from a LiveWhale JSON search (an array; each repeat of a series is its own row with its own date). */
export function parseLiveWhale(body: LiveWhaleEvent[] | { data?: LiveWhaleEvent[] } | null, source: EventSource): TerraEvent[] {
  const rows = Array.isArray(body) ? body : (body?.data ?? []);
  const seen = new Map<string, number>();
  for (const e of rows) if (e?.url) seen.set(e.url, (seen.get(e.url) ?? 0) + 1);
  const out: TerraEvent[] = [];
  for (const e of rows) {
    const url = httpUrl(e?.url);
    const title = decodeText(e?.title ?? '');
    const allDay = e?.is_all_day === true || e?.is_all_day === 1;
    const start = e?.date_iso ? (allDay ? centralIso(e.date_iso.slice(0, 10)) : normalizeDate(e.date_iso)) : null;
    if (!url || !title || !start) continue;
    const end = e.date2_iso ? (allDay ? (e.date2_iso.slice(0, 10) > start.slice(0, 10) ? centralIso(e.date2_iso.slice(0, 10)) : null) : normalizeDate(e.date2_iso)) : null;
    const repeat = (seen.get(e.url!) ?? 0) > 1 || Boolean(e.repeats);
    const cost = price(e.cost);
    const online = String(e.online_type ?? '').toLowerCase();
    out.push({
      id: `${source.key}-${e.id ?? url}-${start.slice(0, 10)}`,
      ...(repeat ? { seriesId: `${source.key}-${url}` } : {}),
      title,
      url,
      start,
      end,
      city: source.city,
      organizer: e.group_title ? `${source.organizer} \u00b7 ${decodeText(e.group_title)}` : source.organizer,
      venue: decodeText(e.location_title ?? e.location ?? '') || null,
      cost: cost.cost,
      ...(cost.free ? { free: true } : {}),
      ...(online === 'online' ? { format: 'virtual' as const } : online === 'hybrid' ? { format: 'hybrid' as const } : {}),
      ...(e.is_canceled ? { status: 'cancelled' as const } : {}),
      ...(httpUrl(e.registration) ? { registrationUrl: httpUrl(e.registration) } : {}),
      ...((e.summary || e.description) ? { description: shortText(decodeText(e.summary || e.description || '')) } : {})
    });
  }
  return out;
}

/** A page's own iCal export link (Modern Events Calendar: ?method=ical&id=123). */
export function icalLink(html: string, page: string): string | null {
  const href = /href="([^"]*[?&](?:amp;|#038;)?method=ical(?:&|&amp;|&#038;)id=\d+)"/i.exec(html)?.[1];
  if (!href) return null;
  try {
    return new URL(decodeXml(href.replace(/&#038;/g, '&')), page).href;
  } catch {
    return null;
  }
}

// ---- Sitemaps ----

/**
 * Event page urls from a sitemap, newest first: pages under a year folder (/events/2026/...) from this year on, else
 * pages modified in the last 200 days (a Wix sitemap keeps every past event).
 */
export function sitemapEventUrls(xml: string, base: string, path: string, now: Date, limit = 30): string[] {
  const year = now.getUTCFullYear();
  const cutoff = now.getTime() - 200 * 86_400_000;
  const out: Array<{ url: string; mod: number }> = [];
  for (const m of xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>(?:\s*<lastmod>\s*([^<\s]+)\s*<\/lastmod>)?/gi)) {
    let url: URL;
    try {
      url = new URL(/^https?:/i.test(m[1]!) ? decodeXml(m[1]!) : `https://${decodeXml(m[1]!)}`);
    } catch {
      continue;
    }
    if (url.origin !== new URL(base).origin || !url.pathname.startsWith(path)) continue;
    const yearDir = /\/((?:19|20)\d{2})\//.exec(url.pathname.slice(path.length - 1))?.[1];
    const mod = m[2] ? Date.parse(m[2]) : NaN;
    if (yearDir ? Number(yearDir) < year : !(mod >= cutoff)) continue;
    out.push({ url: url.href, mod: Number.isFinite(mod) ? mod : 0 });
  }
  return out.sort((a, b) => b.mod - a.mod).slice(0, limit).map((e) => e.url);
}

/** Title, start and venue from schema.org microdata (CREW: <time itemProp="startDate" dateTime="...">). */
export function parseMicrodataEvent(html: string): { title: string; start: string; venue: string | null; dateOnly?: true; timeUnconfirmed?: true } | null {
  const dt = /itemprop="startDate"[^>]*datetime="([^"]+)"/i.exec(html)?.[1] ?? /datetime="([^"]+)"[^>]*itemprop="startDate"/i.exec(html)?.[1];
  const start = dt ? normalizeDate(dt.replace(/\.\d+(?=[+-]\d{2}:?\d{2}$|Z$)/, '')) : null;
  const title = decodeText(/<meta[^>]*property="og:title"[^>]*content="([^"]+)"/i.exec(html)?.[1] ?? /<h1[^>]*>([\s\S]*?)<\/h1>/i.exec(html)?.[1] ?? '');
  if (!start || !title) return null;
  // The meta row after the date: time, then the venue name.
  const items = [...html.matchAll(/class="event--meta-item"[^>]*>([\s\S]*?)<\/span>(?=<span|<\/div)/gi)].map((m) => decodeText(m[1] ?? ''));
  const venue = items.find((t) => t && !/\d{1,2}:\d{2}|\bTBD\b|^\w{3} \d{1,2}, \d{4}$/i.test(t)) ?? null;
  // A page that prints "TBD" (or no clock time) still carries a startDate stamp, which is not the event's time
  // (CREW Austin's 2026 Holiday Party: "Dec 3, 2026 from TBD" with a 10:50 AM stamp). Keep only its date.
  if (!items.some((t) => /\d{1,2}:\d{2}\s*[AP]M/i.test(t))) {
    const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago' }).format(new Date(start));
    const midnight = centralIso(day);
    if (midnight) return { title, start: midnight, venue, dateOnly: true, timeUnconfirmed: true };
  }
  return { title, start, venue };
}

/** The market an address names, if any (longest names first, so "Fort Worth" wins over a street named Worth). */
export function cityIn(text: string): City | null {
  for (const city of [...CITIES].sort((a, b) => b.length - a.length)) if (new RegExp(`\\b${city}\\b`, 'i').test(text)) return city;
  return null;
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
  parseZone = zoneOf(source.city);
  try {
    const events = await withSessions(tidy(await fetchRaw(source, now, fetcher, log)), fetcher, log);
    const kept = events.filter((e) => (!source.relevantOnly || RELEVANT.test(e.title)) && !source.exclude?.test(e.title));
    return joinDays(kept.map((e) => finalize(e, source, now)));
  } finally {
    parseZone = 'America/Chicago';
  }
}

/**
 * The fields every event carries once read: status and format from the organizer's own words, the market of the
 * venue's address (not the organizer's office), topic, free, eligibility and deadline from the description, and
 * when it was verified.
 */
export function finalize(e: TerraEvent, source: Pick<EventSource, 'key' | 'city'> & { places?: EventSource['places'] }, now: Date): TerraEvent {
  const marked = titleStatus(e.title);
  const format = e.format ?? guessFormat(e);
  // A physical event goes to the market its street address names; a virtual one stays with its organizer's market.
  const city = format === 'virtual' ? e.city : (addressCity(e.address) ?? addressCity(e.venue) ?? placeCity(e, source.places) ?? e.city);
  const timezone = zoneOf(city);
  const description = e.description ?? null;
  const out: TerraEvent = {
    ...e,
    title: marked.title,
    city,
    timezone,
    sourceKey: e.sourceKey ?? source.key,
    verifiedAt: now.toISOString()
  };
  const status = e.status ?? marked.status;
  if (status && status !== 'scheduled') out.status = status;
  if (format) out.format = format;
  const topic = topicOf(out.title, description);
  if (topic) out.topic = topic;
  if (!out.free && e.cost && /^\s*(free|\$0(?:\.00)?)\s*$/i.test(e.cost)) out.free = true;
  const who = e.eligibility ?? eligibilityIn(description);
  if (who) out.eligibility = who;
  const deadline = e.registrationDeadline ?? deadlineIn(description, Number(e.start.slice(0, 4)), timezone, centralIso);
  // A deadline after the event starts is a publishing or listing date, not a registration deadline.
  if (deadline && new Date(deadline).getTime() <= new Date(e.start).getTime()) out.registrationDeadline = deadline;
  else delete out.registrationDeadline;
  if (out.registrationUrl && urlKey(out.registrationUrl) === urlKey(out.url)) delete out.registrationUrl;
  if (out.sessions?.length) {
    // A course whose first session has passed is in progress: listed until its last session, not as open to join.
    if (new Date(out.sessions[0]!.start).getTime() < now.getTime()) out.enrollment = 'in-progress';
    else if (out.enrollment !== 'closed') out.enrollment = 'open';
  }
  for (const key of Object.keys(out) as Array<keyof TerraEvent>) if (out[key] === null && !['end', 'venue', 'cost'].includes(key)) delete out[key];
  return out;
}

/** The market a source's campus wording names for this venue or organizer group, if any. */
export function placeCity(e: Pick<TerraEvent, 'venue' | 'organizer' | 'address'>, places: EventSource['places']): City | null {
  // A venue written "Hotel Ella, Austin" names its city even without ", TX".
  const tail = e.venue ? [...CITIES].find((c) => new RegExp(`,\\s*${c}\\s*$`, 'i').test(e.venue!)) : undefined;
  if (tail) return tail;
  if (!places) return null;
  for (const text of [e.venue, e.address, e.organizer]) {
    if (!text) continue;
    for (const [pattern, city] of places) if (pattern.test(text)) return city;
  }
  return null;
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
        const events = parseIcs(text, source, undefined, now);
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

  if (source.kind === 'localist') {
    const events = parseLocalist((await fetcher.json(localistUrl(source))) as { events?: Array<{ event?: LocalistEvent }> }, source);
    log(`${source.organizer}: ${events.length} events matching "${source.keyword ?? 'real estate'}".`);
    return events;
  }

  if (source.kind === 'livewhale') {
    const events = parseLiveWhale((await fetcher.json(liveWhaleUrl(source))) as LiveWhaleEvent[], source);
    log(`${source.organizer}: ${events.length} events matching "${source.keyword ?? 'real estate'}".`);
    return events;
  }

  if (source.kind === 'sitemap') {
    const urls = sitemapEventUrls(await fetcher.text(source.page ?? `${source.base}/sitemap.xml`), source.base, source.sitemapPath ?? '/events/', now);
    log(`${source.organizer}: reading ${urls.length} event pages from the sitemap.`);
    const out: TerraEvent[] = [];
    for (const url of urls) {
      try {
        const html = await fetcher.text(url);
        const ld = parseJsonLdEvents(html, source, url)[0];
        const md = ld ? null : parseMicrodataEvent(html);
        const e: TerraEvent | null = ld
          ? { ...ld, url, id: `${source.key}-${url}` }
          : md
            ? { id: `${source.key}-${url}`, url, end: null, city: source.city, organizer: source.organizer, cost: null, ...md }
            : null;
        if (!e) continue;
        // YCRAN's JSON-LD names the address ("10127 Morocco St, San Antonio, TX"), the venue only its place name.
        const ldText = [...html.matchAll(/<script[^>]*application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)].map((m) => m[1] ?? '').find((t) => /"Event"/.test(t)) ?? '';
        const where = source.cityFromVenue ? cityIn(`${e.venue ?? ''} ${/"address"\s*:\s*"([^"]+)"/.exec(ldText)?.[1] ?? ''} ${e.title}`) : null;
        out.push(where ? { ...e, city: where } : e);
      } catch (error) {
        log(`${url}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    return out;
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
        const ical = ld || novi ? null : icalLink(html, link);
        if (ld) out.push({ ...ld, url: link, id: `${source.key}-${link}` });
        else if (novi) out.push({ id: `${source.key}-${link}`, url: link, end: null, city: source.city, organizer: source.organizer, venue: null, cost: null, ...novi });
        // No readable JSON-LD (AIA San Antonio's has raw line breaks): the page's own iCal export.
        else if (ical) for (const e of parseIcs(await fetcher.text(ical), source, link).slice(0, 1)) out.push({ ...e, url: link, id: `${source.key}-${link}` });
      } catch (error) {
        log(`${link}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    return out;
  }

  for (const feed of growthZoneFeeds(source.base)) {
    try {
      const events = parseIcs(await fetcher.text(feed), source, undefined, now);
      if (events.length) {
        log(`${source.organizer}: ${events.length} events from ${feed}`);
        return withDetailTimes(events, fetcher, log);
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
      const html = await fetcher.text(link.url);
      const detail = parseGrowthZoneDetail(html);
      if (!detail.start) continue;
      out.push({
        ...pageDetails(html),
        id: `${source.key}-${/-(\d+)\/?$/.exec(link.url)?.[1] ?? link.url}`,
        title: detail.title || (/-->/.test(link.title) ? slugTitle(link.url) : link.title),
        url: link.url,
        start: detail.start,
        end: detail.end,
        city: source.city,
        organizer: source.organizer,
        venue: detail.venue,
        cost: null,
        ...(detail.dateOnly ? { dateOnly: true } : {})
      });
    } catch (error) {
      log(`${link.url}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return out;
}

function spanDays(e: Pick<TerraEvent, 'start' | 'end'>): number {
  if (!e.end) return 0;
  return Math.round((Date.parse(`${e.end.slice(0, 10)}T12:00:00Z`) - Date.parse(`${e.start.slice(0, 10)}T12:00:00Z`)) / 86_400_000);
}

/**
 * A listing that spans a week or more (a designation course "Oct 2 – Nov 6") is read from its own page: when the
 * page lists the session dates, the event carries those sessions (and any wording that contradicts them);
 * otherwise it is marked spanUnverified so no calendar export blocks out the whole range.
 */
export async function withSessions(events: TerraEvent[], fetcher: Fetcher, log: (m: string) => void, limit = 10): Promise<TerraEvent[]> {
  let read = 0;
  const out: TerraEvent[] = [];
  for (const e of events) {
    if (e.sessions || spanDays(e) < SERIES_SPAN_DAYS) {
      out.push(e);
      continue;
    }
    let found: ReturnType<typeof courseSessions> = null;
    if (read < limit) {
      read++;
      try {
        found = courseSessions(await fetcher.text(e.url), e.start.slice(0, 10), e.end!.slice(0, 10));
      } catch (error) {
        log(`${e.url}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    if (!found) {
      out.push({ ...e, spanUnverified: true });
      continue;
    }
    const sessions = found.sessions.map((s) => ({ start: centralIso(s.start)!, end: s.end ? centralIso(s.end) : null }));
    const timed = found.sessions[0]!.start.length > 10;
    const { dateOnly: _d, ...rest } = e;
    out.push({
      ...rest,
      ...(timed ? {} : { dateOnly: true }),
      start: sessions[0]!.start,
      end: sessions.at(-1)!.end ?? sessions.at(-1)!.start,
      sessions,
      ...(found.conflicts.length ? { conflicts: found.conflicts } : {}),
      ...(found.registrationClosed ? { enrollment: 'closed' as const } : {})
    });
  }
  return out;
}

/**
 * Chamber iCal feeds often list an evening mixer as a date with no time. For those, read the
 * event's own page (at most `limit` of them) and take its clock times when it lists them.
 */
export async function withDetailTimes(events: TerraEvent[], fetcher: Fetcher, log: (m: string) => void, limit = 30): Promise<TerraEvent[]> {
  let read = 0;
  const out: TerraEvent[] = [];
  for (const e of events) {
    if (!e.dateOnly || read >= limit) {
      out.push(e);
      continue;
    }
    read++;
    try {
      const html = await fetcher.text(e.url);
      const detail = parseGrowthZoneDetail(html);
      const extra = pageDetails(html);
      const timed = detail.start && !detail.dateOnly && detail.start.slice(0, 10) === e.start.slice(0, 10);
      if (timed) {
        const { dateOnly: _drop, ...rest } = e;
        out.push({ ...extra, ...rest, start: detail.start!, end: detail.end && new Date(detail.end).getTime() > new Date(detail.start!).getTime() ? detail.end : null, venue: e.venue ?? detail.venue });
        continue;
      }
    } catch (error) {
      log(`${e.url}: ${error instanceof Error ? error.message : String(error)}`);
    }
    out.push(e);
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

/**
 * When an event is over, in ms. A date with no clock time (midnight) means the whole of that
 * day, so it ends at the next midnight in Texas, DST included; no end means the start's day.
 */
export function eventEnds(e: Pick<TerraEvent, 'start' | 'end' | 'timezone'>): number {
  const last = e.end ?? e.start;
  if (!e.end || isMidnight(last)) {
    const next = new Date(`${last.slice(0, 10)}T12:00:00Z`);
    next.setUTCDate(next.getUTCDate() + 1);
    return new Date(centralIso(next.toISOString().slice(0, 10), e.timezone ?? 'America/Chicago')!).getTime();
  }
  return new Date(last).getTime();
}

/**
 * Upcoming (not yet ended, starting within the window), one per url and day, by start. The day is part of the key so
 * the occurrences of a repeating event that share one page (a monthly luncheon) are all kept.
 */
export function upcoming(events: TerraEvent[], now: Date, days = WINDOW_DAYS): TerraEvent[] {
  const limit = now.getTime() + days * 86_400_000;
  const byUrl = new Map<string, TerraEvent>();
  for (const e of events) {
    const key = `${e.url ? urlKey(e.url) : e.id}|${e.start.slice(0, 10)}`;
    const start = new Date(e.start).getTime();
    const end = eventEnds(e);
    if (!Number.isFinite(start) || start > limit || end < now.getTime()) continue;
    if (!byUrl.has(key)) byUrl.set(key, e);
  }
  return [...byUrl.values()].sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime());
}

const FILLER = new Set(['the', 'a', 'an', 'and', 'of', 'at', 'in', 'on', 'for', 'with', 'to', 'by', 'sa', 'san', 'antonio', 'event', 'events', 'annual', 'jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'sept', 'oct', 'nov', 'dec', 'january', 'february', 'march', 'april', 'june', 'july', 'august', 'september', 'october', 'november', 'december']);

/** The words that name an event: lowercase, no years, months, ordinals or filler. */
export function titleWords(title: string): Set<string> {
  return new Set(
    title
      .toLowerCase()
      .replace(/&/g, ' and ')
      .split(/[^a-z0-9]+/)
      .filter((w) => w && !FILLER.has(w) && !/^\d{4}$/.test(w) && !/^\d+(st|nd|rd|th)$/.test(w))
  );
}

/** Two listings of one event: same city and day, and nearly all the shorter title's words in the other. */
export function sameEvent(a: TerraEvent, b: TerraEvent): boolean {
  if (a.city !== b.city || a.start.slice(0, 10) !== b.start.slice(0, 10)) return false;
  const [x, y] = [titleWords(a.title), titleWords(b.title)].sort((p, q) => p.size - q.size) as [Set<string>, Set<string>];
  if (!x.size) return false;
  const shared = [...x].filter((w) => y.has(w)).length;
  return shared / x.size >= 0.75 && shared >= Math.min(2, x.size);
}

/**
 * Drop repeats of one event listed by several sources (or by hand and a calendar). The first listing wins every field
 * it has; later copies fill its blanks, and a later copy's cancellation or sell-out is kept (see mergeListing).
 */
export function dedupe(events: TerraEvent[]): TerraEvent[] {
  return dedupeCounted(events).events;
}

export function dedupeCounted(events: TerraEvent[]): { events: TerraEvent[]; removed: Map<City, number> } {
  const out: TerraEvent[] = [];
  const removed = new Map<City, number>();
  for (const e of events) {
    const at = out.findIndex((kept) => sameEvent(kept, e) || (kept.url && kept.url === e.url && kept.start === e.start && kept.city === e.city));
    if (at < 0) out.push(e);
    else {
      out[at] = mergeListing(out[at]!, e);
      removed.set(e.city, (removed.get(e.city) ?? 0) + 1);
    }
  }
  return { events: out, removed };
}

export interface SourceStatus {
  /** Absent in files written before the collection report. */
  key?: string;
  organizer: string;
  city: City | null;
  url: string;
  /** This run's read time, or the last good one when it failed. */
  fetchedAt: string;
  /** Upcoming events this source contributes (from the earlier build when it failed). */
  count: number;
  ok?: boolean;
  /** Why it could not be read this run (HTTP status, timeout...). */
  error?: string;
  /** When the source was last read successfully; null when never. */
  lastSuccessAt?: string | null;
}

export interface MarketReport {
  city: City;
  /**
   * events: upcoming events listed; none-found: the sources were read and list nothing upcoming; unreadable: no source
   * could be read; no-sources: no calendar is configured for the market (hand-typed rows only).
   */
  state: 'events' | 'none-found' | 'unreadable' | 'no-sources';
  sourcesChecked: number;
  sourcesOk: number;
  sourcesFailed: number;
  upcoming: number;
  virtual: number;
  duplicatesRemoved: number;
  /** Events kept from an earlier build because their source failed. */
  stale: number;
  /** The newest successful read of any source in this market. */
  lastVerifiedAt: string | null;
}

export interface EventsFile {
  generatedAt: string;
  sources: SourceStatus[];
  cities: Array<{ city: City; events: TerraEvent[] }>;
  report?: MarketReport[];
}

/** Build events.json. A source that fails keeps its events from the previous file, marked stale with their old verification time. */
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
  const meta: SourceStatus[] = [];
  const previousEvents = (previous?.cities ?? []).flatMap((c) => c.events);
  const previousById = new Map(previousEvents.map((e) => [e.id, e]));
  for (const source of sources) {
    // Matched by key (older files: organizer and city), so one organizer can list events in several markets.
    const before = previous?.sources.find((s) => (s.key ? s.key === source.key : s.organizer === source.organizer && s.city === source.city));
    const kept = previousEvents.filter((e) =>
      e.source !== MANUAL_SOURCE && (e.sourceKey ? e.sourceKey === source.key : e.organizer === source.organizer && (source.cityFromVenue || e.city === source.city))
    );
    const url = source.page ?? `${source.base}/events`;
    try {
      const events = upcoming(await fetchSource(source, now, fetcher, log), now).map((e) => withReschedule(e, previousById.get(e.id)));
      log(`${source.organizer}: ${events.length} upcoming events.`);
      all.push(...events);
      meta.push({ key: source.key, organizer: source.organizer, city: source.city, url, fetchedAt: now.toISOString(), count: events.length, ok: true, lastSuccessAt: now.toISOString() });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      log(`${source.organizer}: ${message}; keeping ${kept.length} earlier events.`);
      const still = upcoming(kept, now).map((e) => ({ ...e, stale: true, verifiedAt: e.verifiedAt ?? before?.fetchedAt ?? previous?.generatedAt }) as TerraEvent);
      all.push(...still);
      const last = before ? (before.lastSuccessAt !== undefined ? before.lastSuccessAt : before.fetchedAt) : null;
      meta.push({ key: source.key, organizer: source.organizer, city: source.city, url, fetchedAt: before?.fetchedAt ?? now.toISOString(), count: still.length, ok: false, error: message.slice(0, 120), lastSuccessAt: last ?? null });
    }
  }
  const previousManual = previousEvents.filter((e) => e.source === MANUAL_SOURCE);
  const hand = upcoming((manual ?? previousManual).map((e) => ({ ...e, source: MANUAL_SOURCE, sourceKey: 'manual', timezone: e.timezone ?? zoneOf(e.city), verifiedAt: e.verifiedAt ?? now.toISOString() })), now);
  if (hand.length) {
    meta.push({ key: 'manual', organizer: MANUAL_SOURCE, city: null, url: '', fetchedAt: now.toISOString(), count: hand.length, ok: true, lastSuccessAt: now.toISOString() });
  }
  // Hand-entered rows first, so they win over a calendar's copy of the same event.
  const { events: merged, removed } = dedupeCounted(upcoming([...hand, ...all], now));
  const sorted = linkSeries(merged);
  const cities = CITIES.map((city) => ({ city, events: sorted.filter((e) => e.city === city) }));
  return { generatedAt: now.toISOString(), sources: meta, cities, report: marketReport(cities, meta, sources, removed) };
}

/**
 * Mark the occurrences of a repeating event that a calendar lists as separate entries (a chamber's monthly
 * luncheon with one UID per month): same source, organizer and title on two or more different days.
 */
export function linkSeries(events: TerraEvent[]): TerraEvent[] {
  const key = (e: TerraEvent) => `${e.sourceKey ?? e.organizer}|${e.city}|${e.title.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()}`;
  const days = new Map<string, Set<string>>();
  for (const e of events) if (!e.seriesId) days.set(key(e), (days.get(key(e)) ?? new Set()).add(e.start.slice(0, 10)));
  return events.map((e) => (!e.seriesId && (days.get(key(e))?.size ?? 0) > 1 ? { ...e, seriesId: `series-${key(e)}` } : e));
}

/** A start that moved since the last build, for a source that does not say so itself. */
function withReschedule(e: TerraEvent, before: TerraEvent | undefined): TerraEvent {
  if (!before || e.rescheduledFrom || e.seriesId || before.source === MANUAL_SOURCE) return e;
  // Only a different local day is a move: a listing that gains its clock time (midnight → 8 AM, or a course's
  // first session read from its page) is the same event on the same day.
  const day = (iso: string) => new Intl.DateTimeFormat('en-CA', { timeZone: e.timezone ?? zoneOf(e.city) }).format(new Date(iso));
  // A page that now says its time is TBD has not moved either: the old clock time was never confirmed.
  const moved = (x: string | null | undefined): x is string => Boolean(x) && (day(x!) !== day(e.start) || (!isMidnight(x!) && !e.timeUnconfirmed));
  const from = [before.start !== e.start ? before.start : null, before.rescheduledFrom].find(moved);
  return from ? { ...e, rescheduledFrom: from, status: e.status ?? 'rescheduled' } : e;
}

/** Per market: which of its sources were read, what they list, and when it was last verified. */
export function marketReport(cities: EventsFile['cities'], meta: SourceStatus[], sources: EventSource[], removed: Map<City, number>): MarketReport[] {
  return cities.map(({ city, events }) => {
    const mine = meta.filter((m) => m.city === city || (m.key !== 'manual' && sources.find((s) => s.key === m.key)?.cityFromVenue && events.some((e) => e.sourceKey === m.key)));
    const ok = mine.filter((m) => m.ok);
    const last = mine.map((m) => m.lastSuccessAt).filter((t): t is string => Boolean(t)).sort().pop() ?? null;
    const upcomingCount = events.filter((e) => e.status !== 'cancelled').length;
    return {
      city,
      state: upcomingCount ? 'events' : !mine.length ? 'no-sources' : ok.length ? 'none-found' : 'unreadable',
      sourcesChecked: mine.length,
      sourcesOk: ok.length,
      sourcesFailed: mine.length - ok.length,
      upcoming: upcomingCount,
      virtual: events.filter((e) => e.format === 'virtual').length,
      duplicatesRemoved: removed.get(city) ?? 0,
      stale: events.filter((e) => e.stale).length,
      lastVerifiedAt: last
    };
  });
}

/** The collection report as Markdown (written next to events.json and to the workflow summary). */
export function reportMarkdown(file: EventsFile): string {
  const lines = [`# Events collection report`, '', `Built ${file.generatedAt}.`, '', '| Market | Result | Sources read | Failed | Upcoming | Virtual | Duplicates removed | Kept from earlier build | Last verified |', '|---|---|---|---|---|---|---|---|---|'];
  const label = { events: 'Events listed', 'none-found': 'No upcoming events found', unreadable: 'Sources could not be read', 'no-sources': 'No calendar configured' };
  for (const r of file.report ?? []) {
    lines.push(`| ${r.city} | ${label[r.state]} | ${r.sourcesOk}/${r.sourcesChecked} | ${r.sourcesFailed} | ${r.upcoming} | ${r.virtual} | ${r.duplicatesRemoved} | ${r.stale} | ${r.lastVerifiedAt ?? 'never'} |`);
  }
  lines.push('', '## Sources', '', '| Market | Source | Read this run | Upcoming | Last success | Error |', '|---|---|---|---|---|---|');
  for (const s of file.sources) lines.push(`| ${s.city ?? 'All'} | [${s.organizer}](${s.url || '#'}) | ${s.ok ? 'yes' : 'no'} | ${s.count} | ${s.lastSuccessAt ?? 'never'} | ${(s.error ?? '').replace(/\|/g, '/')} |`);
  return `${lines.join('\n')}\n`;
}
