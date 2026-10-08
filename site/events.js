// events.js — the events section's rules, as plain functions with no DOM.
//
// Kept apart from events-view.js so filtering and grouping are covered by the
// backend's tests. The data file is written by backend/src/bin/export-events.ts.

/** #events&city=Houston → { open, city }. An unknown city falls back to all. */
export function readEventsHash(hash, file) {
  const params = new URLSearchParams(String(hash ?? '').replace(/^#/, ''));
  const cities = (file?.cities ?? []).map((c) => c.city);
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

/** Events for one city (or all) that have not ended, soonest first. */
export function filterEvents(file, { city = '' } = {}, now = new Date()) {
  const out = [];
  for (const entry of file?.cities ?? []) {
    if (city && entry.city !== city) continue;
    for (const event of entry.events ?? []) {
      const end = new Date(event.end ?? event.start).getTime();
      if (Number.isFinite(end) && end + (event.end ? 0 : 86_400_000) < now.getTime()) continue;
      out.push(event);
    }
  }
  return out.sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime());
}

export function eventCounts(file, now = new Date()) {
  return new Map((file?.cities ?? []).map((c) => [c.city, filterEvents(file, { city: c.city }, now).length]));
}

const TZ = 'America/Chicago';

/** [{ month: "October 2026", events }] in start order. */
export function groupByMonth(events) {
  const groups = [];
  for (const event of events) {
    const month = new Date(event.start).toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: TZ });
    const last = groups[groups.length - 1];
    if (last?.month === month) last.events.push(event);
    else groups.push({ month, events: [event] });
  }
  return groups;
}

/** "Tue, Oct 14 · 11:30 AM" in Texas time; no time for an all-day (midnight) start. */
export function eventDate(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const day = d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: TZ });
  const time = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: TZ });
  return time === '12:00 AM' ? day : `${day} · ${time}`;
}

/** The pieces of a start date the date block shows, in Texas time: { month: 'OCT', day: '14', weekday: 'Tue', ymd: '2026-10-14' }. */
export function dateParts(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const part = (options) => d.toLocaleDateString('en-US', { ...options, timeZone: TZ });
  const ymd = new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(d);
  return { month: part({ month: 'short' }).toUpperCase(), day: part({ day: 'numeric' }), weekday: part({ weekday: 'short' }), ymd };
}

/** True when a start falls at midnight Texas time, which the sources use for "all day". */
function allDay(iso) {
  return new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: TZ }) === '12:00 AM';
}

function utcStamp(date) {
  return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

/** Start and end for a calendar file or link: dates for an all-day event, UTC times otherwise (an hour long when no end is listed). */
function calendarRange(event) {
  const start = new Date(event.start);
  if (allDay(event.start)) {
    const first = dateParts(event.start).ymd;
    const last = event.end && !Number.isNaN(new Date(event.end).getTime()) ? dateParts(event.end).ymd : first;
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
  const where = [event.venue, event.city ? `${event.city}, TX` : ''].filter(Boolean).join(', ');
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
    `DESCRIPTION:${icsText([event.organizer, event.url].filter(Boolean).join(' · '))}`,
    event.url ? `URL:${icsText(event.url)}` : '',
    'END:VEVENT',
    'END:VCALENDAR'
  ].filter(Boolean);
  return `${lines.join('\r\n')}\r\n`;
}

/** A Google Calendar "add event" link, prefilled; free and needs no key. */
export function googleCalendarUrl(event) {
  const range = calendarRange(event);
  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text: event.title ?? '',
    dates: `${range.start}/${range.end}`,
    details: [event.organizer, event.url].filter(Boolean).join('\n'),
    location: [event.venue, event.city ? `${event.city}, TX` : ''].filter(Boolean).join(', ')
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
  const on = new Set(events.map((e) => dateParts(e.start)?.ymd).filter(Boolean));
  const cells = Array.from({ length: first.getUTCDay() }, () => null);
  for (let day = 1; day <= days; day++) {
    const ymd = `${month}-${String(day).padStart(2, '0')}`;
    cells.push({ day, ymd, has: on.has(ymd) });
  }
  return cells;
}
