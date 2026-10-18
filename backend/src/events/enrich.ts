import { CITIES, type City } from '../types.js';
import type { EventFormat, EventStatus, EventTopic, TerraEvent, TimeZone } from './events.js';

/**
 * The details an event page adds beyond title, date and venue: registration link, address, format, price,
 * deadline, eligibility, status and description. Only what the source states is kept; nothing is guessed
 * beyond reading the organizer's own words (a title that starts "CANCELLED", a venue named "Zoom").
 */

export type Details = Partial<
  Pick<TerraEvent, 'registrationUrl' | 'address' | 'format' | 'free' | 'registrationDeadline' | 'eligibility' | 'description' | 'status' | 'rescheduledFrom' | 'cost'>
>;

function text(value: unknown): string {
  if (typeof value !== 'string') return '';
  return value
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;|&#160;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&#8217;|&rsquo;/gi, '’')
    .replace(/&#8211;|&ndash;/gi, '–')
    .replace(/&quot;/gi, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

function link(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : null;
  } catch {
    return null;
  }
}

/** A description cut at a word near 300 characters. */
export function shortText(value: unknown, max = 300): string | null {
  const t = text(value);
  if (!t) return null;
  if (t.length <= max) return t;
  return `${t.slice(0, max).replace(/\s+\S*$/, '')}…`;
}

/** "$25", "Free", "$0.00", 0 → { cost, free }. */
export function price(value: unknown, currency?: unknown): { cost: string | null; free?: boolean } {
  if (value === null || value === undefined || value === '') return { cost: null };
  if (typeof value === 'number' || /^\s*\$?\d+(?:\.\d+)?\s*$/.test(String(value))) {
    const n = Number(String(value).replace(/[$\s]/g, ''));
    if (!Number.isFinite(n)) return { cost: null };
    if (n === 0) return { cost: 'Free', free: true };
    const sym = !currency || currency === 'USD' ? '$' : `${String(currency)} `;
    return { cost: `${sym}${Number.isInteger(n) ? n : n.toFixed(2)}` };
  }
  const t = text(value);
  if (/^(free|no cost|complimentary)\b/i.test(t)) return { cost: t, free: true };
  return { cost: t || null };
}

const STATUS: Record<string, EventStatus> = {
  eventcancelled: 'cancelled',
  eventpostponed: 'postponed',
  eventrescheduled: 'rescheduled',
  eventmovedonline: 'scheduled'
};

function schemaWord(value: unknown): string {
  return String(value ?? '').replace(/^https?:\/\/schema\.org\//i, '').toLowerCase();
}

interface LdLocation {
  '@type'?: string;
  name?: string;
  url?: string;
  address?: string | { streetAddress?: string; addressLocality?: string; addressRegion?: string; postalCode?: string };
}

interface LdOffer {
  url?: string;
  price?: string | number;
  lowPrice?: string | number;
  priceCurrency?: string;
  availability?: string;
  validThrough?: string;
  eligibleCustomerType?: string;
  name?: string;
}

/** Details from a schema.org Event node. normalize turns a schema date into Terra's ISO form. */
export function ldDetails(node: Record<string, unknown>, normalize: (v: string) => string | null): Details & { locations: LdLocation[] } {
  const out: Details & { locations: LdLocation[] } = { locations: [] };
  const locations = (Array.isArray(node.location) ? node.location : node.location ? [node.location] : []) as Array<LdLocation | string>;
  const physical = locations.filter((l): l is LdLocation => typeof l === 'object' && l !== null && !/VirtualLocation/i.test(String(l['@type'])));
  const virtual = locations.some((l) => typeof l === 'object' && l !== null && /VirtualLocation/i.test(String(l['@type'])));
  out.locations = physical;
  const addr = physical.map((l) => l.address).find(Boolean);
  if (typeof addr === 'string') out.address = text(addr) || null;
  else if (addr) out.address = [addr.streetAddress, addr.addressLocality, [addr.addressRegion, addr.postalCode].filter(Boolean).join(' ')].map(text).filter(Boolean).join(', ') || null;

  const mode = schemaWord(node.eventAttendanceMode);
  if (/mixed/.test(mode)) out.format = 'hybrid';
  else if (/online/.test(mode)) out.format = 'virtual';
  else if (/offline/.test(mode)) out.format = 'in-person';
  else if (virtual) out.format = physical.length ? 'hybrid' : 'virtual';

  const status = STATUS[schemaWord(node.eventStatus)];
  if (status && status !== 'scheduled') out.status = status;
  if (typeof node.previousStartDate === 'string') out.rescheduledFrom = normalize(node.previousStartDate);

  const offers = (Array.isArray(node.offers) ? node.offers : node.offers ? [node.offers] : []) as LdOffer[];
  const offer = offers.find((o) => o && typeof o === 'object');
  if (offer) {
    const p = price(offer.price ?? offer.lowPrice, offer.priceCurrency);
    if (p.cost) out.cost = p.cost;
    if (p.free) out.free = true;
    out.registrationUrl = link(offer.url);
    if (/soldout/i.test(schemaWord(offer.availability)) && !out.status) out.status = 'sold-out';
    if (typeof offer.validThrough === 'string') out.registrationDeadline = normalize(offer.validThrough);
    const who = offers.map((o) => text(o?.eligibleCustomerType ?? (/(student|member)/i.test(String(o?.name ?? '')) ? `${o?.name}: ${price(o?.price, o?.priceCurrency).cost ?? ''}` : ''))).filter(Boolean);
    if (who.length) out.eligibility = who.join('; ');
  }
  if (node.isAccessibleForFree === true && !out.cost) {
    out.cost = 'Free';
    out.free = true;
  }
  out.description = shortText(node.description);
  return out;
}

const VIRTUAL = /\b(virtual|webinar|zoom|online|teams meeting|microsoft teams|livestream|web ?ex)\b/i;
const TBD_PLACE = /^(tbd|tba|to be (?:determined|announced))$/i;

/** Format from the words of the venue and title when the source has no attendance mode. */
export function guessFormat(e: Pick<TerraEvent, 'venue' | 'title' | 'address'>): EventFormat | undefined {
  const where = `${e.venue ?? ''} ${e.address ?? ''}`;
  if (/\bhybrid\b/i.test(`${where} ${e.title}`)) return 'hybrid';
  if (VIRTUAL.test(where) || /^\s*(virtual|webinar|online)\b/i.test(e.title) || /\b(webinar|virtual)\s*$/i.test(e.title)) return 'virtual';
  return undefined;
}

/** "CANCELLED - Luncheon", "POSTPONED: Mixer", "Sold Out! Gala" → status, title without the marker. */
export function titleStatus(title: string): { status?: EventStatus; title: string } {
  const m = /^\s*[[(]?\s*(cancel+ed|postponed|rescheduled|sold[ -]?out)\s*[\])]?\s*[!:–—-]*\s*(.+)$/i.exec(title);
  const tail = /^(.+?)\s*[[(–—-]\s*(cancel+ed|postponed|rescheduled|sold[ -]?out)\s*[\])]?\s*$/i.exec(title);
  const word = (m?.[1] ?? tail?.[2] ?? '').toLowerCase();
  const rest = m?.[2] ?? tail?.[1];
  if (!word || !rest) return { title };
  const status: EventStatus = word.startsWith('cancel') ? 'cancelled' : word === 'postponed' ? 'postponed' : word === 'rescheduled' ? 'rescheduled' : 'sold-out';
  return { status, title: rest.trim() };
}

const TOPICS: Array<[EventTopic, RegExp]> = [
  ['Career fair', /career (?:fair|expo|night|day)|job fair|recruit|internship|hiring event|resume|mentorship/i],
  ['Property tour', /\btours?\b|site visit|walk[- ]?through|bus tour|open house/i],
  ['Conference', /conference|summit|symposium|expo\b|convention|forecast|outlook|state of the|annual meeting/i],
  ['Panel', /panel|fireside|keynote|speaker series|discussion|town hall|roundtable/i],
  ['Education', /\bclass\b|course|seminar|workshop|training|\bce\b|continuing education|certification|webinar|101\b|bootcamp|lunch (?:&|and) learn/i],
  ['Luncheon', /luncheon|lunch\b|breakfast/i],
  ['Networking', /network|mixer|meet[- ]?up|after[- ]hours|happy hour|connect|coffee/i],
  ['Social', /gala|golf|social|party|celebration|awards|tournament|clay shoot/i]
];

/** The kind of event, from its title then description; absent when none fits. */
export function topicOf(title: string, description?: string | null): EventTopic | undefined {
  for (const where of [title, description ?? '']) for (const [topic, re] of TOPICS) if (re.test(where)) return topic;
  return undefined;
}

/** A student or member price/eligibility sentence from a description, quoted as written. */
export function eligibilityIn(description: string | null | undefined): string | null {
  if (!description) return null;
  const m = /[^.!?]*\b(students?|members? only|members?\s+(?:price|rate|\$)|non-?members?|open to (?:the public|all)|young professionals?)\b[^.!?]*[.!?]?/i.exec(description);
  return m ? m[0].trim().slice(0, 160) : null;
}

/** "Sign-up closes Oct 10" style deadlines are left to the structured data; this only reads "register by <Month D>". */
export function deadlineIn(description: string | null | undefined, year: number, zone: TimeZone, toIso: (local: string, zone: TimeZone) => string | null): string | null {
  if (!description) return null;
  const m = /\b(?:register|registration|rsvp|sign[- ]?up)s?\s+(?:by|before|closes?(?: on)?|deadline(?: is)?:?)\s+(?:\w+day,?\s+)?(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s+(\d{4}))?/i.exec(description);
  if (!m) return null;
  const mo = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'].indexOf(m[1]!.toLowerCase().slice(0, 3)) + 1;
  const y = m[3] ? Number(m[3]) : year;
  return toIso(`${y}-${String(mo).padStart(2, '0')}-${m[2]!.padStart(2, '0')}`, zone);
}

/** The market a street address names (", Fort Worth, TX"), longest names first. */
export function addressCity(address: string | null | undefined): City | null {
  if (!address) return null;
  for (const city of [...CITIES].sort((a, b) => b.length - a.length)) if (new RegExp(`\\b${city}\\b(?:,?\\s*(?:TX|Texas)\\b)`, 'i').test(address)) return city;
  return null;
}

/** True when a venue string says nothing about where (TBD, or empty). */
export function placeUnknown(venue: string | null | undefined): boolean {
  return !venue || TBD_PLACE.test(venue.trim());
}

/** Fold the fields of a second listing of the same event into the first: the first wins every field it has. */
export function mergeListing(first: TerraEvent, second: TerraEvent): TerraEvent {
  const out: TerraEvent = { ...first };
  for (const [key, value] of Object.entries(second) as Array<[keyof TerraEvent, unknown]>) {
    if (value === undefined || value === null || value === '') continue;
    const have = out[key];
    if (have === undefined || have === null || have === '') (out as unknown as Record<string, unknown>)[key] = value;
  }
  // The organizer's own calendar is the newer word on a cancellation or a sell-out, even over a hand-typed row.
  if (second.status && second.status !== 'scheduled' && !second.stale) out.status = second.status;
  // A calendar's real clock time fills a hand row that only had a date.
  if (first.dateOnly && !second.dateOnly && second.start.slice(0, 10) === first.start.slice(0, 10)) {
    out.start = second.start;
    out.end = first.end ?? second.end;
    delete out.dateOnly;
  }
  return out;
}

/**
 * Join one all-day event a calendar lists once per day (a 3-day conference as three rows with one page) into a
 * single multi-day event. Repeating events (seriesId) and timed rows are left alone.
 */
export function joinDays(events: TerraEvent[]): TerraEvent[] {
  const out: TerraEvent[] = [];
  const sorted = [...events].sort((a, b) => a.start.localeCompare(b.start));
  for (const e of sorted) {
    const allDay = e.dateOnly || /T00:00:00/.test(e.start);
    const prev = out.find(
      (p) =>
        !p.seriesId &&
        !e.seriesId &&
        allDay &&
        p.url === e.url &&
        p.title === e.title &&
        p.city === e.city &&
        nextDay((p.end ?? p.start).slice(0, 10)) === e.start.slice(0, 10)
    );
    if (prev) prev.end = e.end ?? e.start;
    else out.push({ ...e });
  }
  return out;
}

function nextDay(ymd: string): string {
  const d = new Date(`${ymd}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}
