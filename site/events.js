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
