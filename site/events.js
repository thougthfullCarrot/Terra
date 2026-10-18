// events.js — the events section's rules, as plain functions with no DOM.
//
// Kept apart from events-view.js so filtering and grouping are covered by the
// backend's tests. The data file is written by backend/src/bin/export-events.ts.

/** The pseudo-market for virtual events, listed apart from the cities. */
export const ONLINE = 'Online';

/** #events&city=Houston → { open, city }. An unknown city falls back to all; city=Online lists virtual events. */
export function readEventsHash(hash, file) {
  const params = new URLSearchParams(String(hash ?? '').replace(/^#/, ''));
  const cities = [...(file?.cities ?? []).map((c) => c.city), ONLINE];
  return {
    open: params.has('events'),
    city: cities.includes(params.get('city')) ? params.get('city') : ''
  };
}

export function writeEventsHash(state) {
  const params = new URLSearchParams();
  if (state.city) params.set('city', state.city);
  const text = params.toString();
  return `#events${text ? `&${text}` : ''}`;
}

/**
 * Events for one city (or all) that have not ended, soonest first. A city lists the events held there (virtual ones
 * are listed under Online instead); Online lists every virtual event.
 */
export function filterEvents(file, { city = '' } = {}, now = new Date()) {
  const out = [];
  for (const entry of file?.cities ?? []) {
    if (city && city !== ONLINE && entry.city !== city) continue;
    for (const event of entry.events ?? []) {
      if (city === ONLINE ? event.format !== 'virtual' : city && event.format === 'virtual') continue;
      const end = eventEnds(event);
      if (Number.isFinite(end) && end < now.getTime()) continue;
      out.push(event);
    }
  }
  return out.sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime());
}

/**
 * When an event is over, in ms. A midnight end (a date with no clock time) means the whole of that
 * day, so it lasts until the next Texas midnight; no end means the start's day. Same rule as the
 * collector's eventEnds() in backend/src/events/events.ts.
 */
export function eventEnds(event) {
  const last = event.end ?? event.start;
  const d = new Date(last);
  if (Number.isNaN(d.getTime())) return NaN;
  const tz = zoneOf(event);
  if (event.end && !allDay(event.end, tz)) return d.getTime();
  const ymd = dateParts(last, tz).ymd;
  const next = new Date(`${ymd}T12:00:00Z`);
  next.setUTCDate(next.getUTCDate() + 1);
  const day = next.toISOString().slice(0, 10);
  // Local midnight is 05:00-07:00 UTC depending on the zone and daylight time; take the one that reads 12:00 AM.
  for (const h of ['05', '06', '07']) {
    const at = new Date(`${day}T${h}:00:00Z`);
    if (allDay(at.toISOString(), tz)) return at.getTime();
  }
  return new Date(`${day}T06:00:00Z`).getTime();
}

export function eventCounts(file, now = new Date()) {
  const counts = new Map((file?.cities ?? []).map((c) => [c.city, filterEvents(file, { city: c.city }, now).length]));
  counts.set(ONLINE, filterEvents(file, { city: ONLINE }, now).length);
  return counts;
}

const TZ = 'America/Chicago';

/** The event's own zone (El Paso is on Mountain time); Central for older files. */
export function zoneOf(event) {
  return event?.timezone || (event?.city === 'El Paso' ? 'America/Denver' : TZ);
}

/** "CT" or "MT", shown beside a time so an El Paso time is never read as Central. */
export function zoneLabel(tz) {
  return tz === 'America/Denver' ? 'MT' : 'CT';
}

/** [{ month: "October 2026", events }] in start order. */
export function groupByMonth(events) {
  const groups = [];
  for (const event of events) {
    const month = new Date(event.start).toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: zoneOf(event) });
    const last = groups[groups.length - 1];
    if (last?.month === month) last.events.push(event);
    else groups.push({ month, events: [event] });
  }
  return groups;
}

/** "Tue, Oct 14 · 11:30 AM" in the venue's time (Central unless tz says otherwise); no time for an all-day (midnight) start. */
export function eventDate(iso, tz = TZ) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const day = d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: tz });
  const time = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: tz });
  return time === '12:00 AM' ? day : `${day} · ${time}`;
}

/**
 * The time line of a card: "6:00 PM – 8:00 PM CT", "All day", "Time not listed", or for an event over several days
 * "Oct 20 – Oct 22" (with its start time when it has one).
 */
export function eventWhen(event) {
  const tz = zoneOf(event);
  const start = dateParts(event.start, tz);
  const end = event.end ? dateParts(event.end, tz) : null;
  const clock = (iso) => new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: tz });
  const startTime = allDay(event.start, tz) ? '' : clock(event.start);
  const short = (iso) => new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: tz });
  if (start && end && end.ymd > start.ymd) {
    const range = `${short(event.start)} \u2013 ${short(event.end)}`;
    return startTime ? `${range} · starts ${startTime} ${zoneLabel(tz)}` : range;
  }
  if (!startTime) return event.dateOnly ? 'Time not listed' : 'All day';
  const endTime = event.end && !allDay(event.end, tz) && new Date(event.end) > new Date(event.start) ? clock(event.end) : '';
  return `${startTime}${endTime ? ` \u2013 ${endTime}` : ''} ${zoneLabel(tz)}`;
}

/** The labels a card shows beside the organizer: status first, then format, price and who may attend. */
export function eventBadges(event) {
  const out = [];
  const status = { cancelled: 'Cancelled', postponed: 'Postponed', rescheduled: 'Rescheduled', 'sold-out': 'Sold out' }[event.status];
  if (status) out.push({ text: status, kind: 'status' });
  if (event.format === 'virtual') out.push({ text: 'Virtual', kind: 'format' });
  else if (event.format === 'hybrid') out.push({ text: 'Hybrid', kind: 'format' });
  if (event.free) out.push({ text: 'Free', kind: 'price' });
  else if (event.cost) out.push({ text: event.cost, kind: 'price' });
  if (event.topic) out.push({ text: event.topic, kind: 'topic' });
  if (event.eligibility && /student/i.test(event.eligibility)) out.push({ text: 'Student pricing', kind: 'eligibility', title: event.eligibility });
  return out;
}

/** The market's line in the collection report, and the sentence an empty list shows for it. */
export function marketNote(file, city) {
  const r = (file?.report ?? []).find((x) => x.city === city);
  if (!r) return { report: null, empty: city ? `No events listed yet for ${city}.` : 'No events listed yet.' };
  if (r.state === 'no-sources') return { report: r, empty: `No calendars for ${city} can be read automatically yet, and none were added by hand.` };
  if (r.state === 'unreadable') return { report: r, empty: `Couldn't read ${r.sourcesChecked === 1 ? 'the calendar' : `any of the ${r.sourcesChecked} calendars`} for ${city} this time, so nothing new is listed. We'll try again on the next update.` };
  return { report: r, empty: `No upcoming events found for ${city}. ${r.sourcesOk} of ${r.sourcesChecked} calendars were read.` };
}

/** The pieces of a start date the date block shows, in Texas time: { month: 'OCT', day: '14', weekday: 'Tue', ymd: '2026-10-14' }. */
export function dateParts(iso, tz = TZ) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const part = (options) => d.toLocaleDateString('en-US', { ...options, timeZone: tz });
  const ymd = new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(d);
  return { month: part({ month: 'short' }).toUpperCase(), day: part({ day: 'numeric' }), weekday: part({ weekday: 'short' }), ymd };
}

/** True when a time falls at midnight in the venue's zone, which the sources use for "all day". */
function allDay(iso, tz = TZ) {
  return new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: tz }) === '12:00 AM';
}

function utcStamp(date) {
  return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

/** Start and end for a calendar file or link: dates for an all-day event, UTC times otherwise (an hour long when no end is listed). */
function calendarRange(event) {
  const start = new Date(event.start);
  const tz = zoneOf(event);
  if (allDay(event.start, tz)) {
    const first = dateParts(event.start, tz).ymd;
    const last = event.end && !Number.isNaN(new Date(event.end).getTime()) ? dateParts(event.end, tz).ymd : first;
    const after = new Date(`${last}T00:00:00Z`);
    after.setUTCDate(after.getUTCDate() + 1);
    return { allDay: true, start: first.replace(/-/g, ''), end: after.toISOString().slice(0, 10).replace(/-/g, '') };
  }
  const endDate = event.end && new Date(event.end).getTime() > start.getTime() ? new Date(event.end) : new Date(start.getTime() + 3_600_000);
  return { allDay: false, start: utcStamp(start), end: utcStamp(endDate) };
}

function icsText(value) {
  return String(value ?? '').replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/([,;])/g, '\\$1');
}

/** An .ics file for one event, for any calendar app. */
export function eventIcs(event, now = new Date()) {
  const range = calendarRange(event);
  const where = eventPlace(event);
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Terra//Events//EN',
    'CALSCALE:GREGORIAN',
    'BEGIN:VEVENT',
    `UID:${icsText(event.id || `${event.start}-${event.title}`)}@terra`,
    `DTSTAMP:${utcStamp(now)}`,
    range.allDay ? `DTSTART;VALUE=DATE:${range.start}` : `DTSTART:${range.start}`,
    range.allDay ? `DTEND;VALUE=DATE:${range.end}` : `DTEND:${range.end}`,
    `SUMMARY:${icsText(event.title)}`,
    where ? `LOCATION:${icsText(where)}` : '',
    `DESCRIPTION:${icsText(calendarDetails(event).join(' · '))}`,
    event.status === 'cancelled' ? 'STATUS:CANCELLED' : 'STATUS:CONFIRMED',
    event.url ? `URL:${icsText(event.url)}` : '',
    'END:VEVENT',
    'END:VCALENDAR'
  ].filter(Boolean);
  return `${lines.join('\r\n')}\r\n`;
}

/** Where the event is: address (or venue), city; "Online" for a virtual event with no place. */
function eventPlace(event) {
  if (event.format === 'virtual') return event.venue && !/^(online|virtual)$/i.test(event.venue) ? event.venue : 'Online';
  const street = event.address && event.venue && !event.address.includes(event.venue) ? `${event.venue}, ${event.address}` : event.address || event.venue;
  return [street, street && /\bTX\b|Texas/.test(street) ? '' : event.city ? `${event.city}, TX` : ''].filter(Boolean).join(', ');
}

/** The organizer, the event page and the registration link, for a calendar entry's notes. */
function calendarDetails(event) {
  return [event.organizer, event.url, event.registrationUrl ? `Register: ${event.registrationUrl}` : ''].filter(Boolean);
}

/** A Google Calendar "add event" link, prefilled; free and needs no key. */
export function googleCalendarUrl(event) {
  const range = calendarRange(event);
  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text: event.title ?? '',
    dates: `${range.start}/${range.end}`,
    details: calendarDetails(event).join('\n'),
    location: eventPlace(event),
    // The venue's zone, so the times read right for someone whose calendar is set elsewhere.
    ctz: zoneOf(event)
  });
  return `https://calendar.google.com/calendar/render?${params}`;
}

/**
 * A month grid for the mini calendar: leading blanks for the days before the
 * 1st, then each day with whether an event starts on it. month is 'YYYY-MM'.
 */
export function monthGrid(month, events) {
  const [year, mon] = month.split('-').map(Number);
  const first = new Date(Date.UTC(year, mon - 1, 1));
  const days = new Date(Date.UTC(year, mon, 0)).getUTCDate();
  const on = new Set(events.map((e) => dateParts(e.start, zoneOf(e))?.ymd).filter(Boolean));
  const cells = Array.from({ length: first.getUTCDay() }, () => null);
  for (let day = 1; day <= days; day++) {
    const ymd = `${month}-${String(day).padStart(2, '0')}`;
    cells.push({ day, ymd, has: on.has(ymd) });
  }
  return cells;
}
