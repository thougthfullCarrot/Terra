import type { SheetsClient } from '../sheets/google.js';
import { tabRange } from '../sheets/google.js';
import { CITIES, type City } from '../types.js';
import { centralIso, MANUAL_SOURCE, type TerraEvent } from './events.js';

/**
 * Events Rod types into the Google Sheet's "Events" tab, for chapters whose
 * calendars cannot be read automatically. Each row shows on the site under
 * its own organizer, marked as added by hand.
 */

export const EVENTS_TAB = 'Events';
export const EVENT_HEADERS = ['Date', 'Time', 'Title', 'City', 'Organizer', 'Venue', 'Link'] as const;
export { MANUAL_SOURCE };

/** "2026-10-14" or "10/14/2026" (or 10/14/26) → "2026-10-14". */
export function sheetDate(value: string): string | null {
  const v = value.trim();
  let y: number, mo: number, d: number;
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(v);
  const us = /^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/.exec(v);
  if (iso) [y, mo, d] = [Number(iso[1]), Number(iso[2]), Number(iso[3])];
  else if (us) [mo, d, y] = [Number(us[1]), Number(us[2]), Number(us[3]!.length === 2 ? `20${us[3]}` : us[3])];
  else return null;
  const date = new Date(Date.UTC(y, mo - 1, d));
  if (date.getUTCMonth() !== mo - 1 || date.getUTCDate() !== d) return null;
  return date.toISOString().slice(0, 10);
}

/** "6:30 PM", "18:30", "7am" → "18:30"; blank or unreadable → null. */
export function sheetTime(value: string): string | null {
  const m = /^(\d{1,2})(?::(\d{2}))?\s*([ap])?\.?\s*m?\.?$/i.exec(value.trim());
  if (!m) return null;
  let h = Number(m[1]);
  const mi = Number(m[2] ?? '0');
  const ap = m[3]?.toLowerCase();
  if (ap) {
    if (h < 1 || h > 12) return null;
    h = (h % 12) + (ap === 'p' ? 12 : 0);
  } else if (!m[2]) return null;
  if (h > 23 || mi > 59) return null;
  return `${String(h).padStart(2, '0')}:${String(mi).padStart(2, '0')}`;
}

function cityOf(value: string): City | null {
  const v = value.trim().toLowerCase().replace(/^ft\.?\s/, 'fort ');
  return CITIES.find((c) => c.toLowerCase() === v) ?? null;
}

/** Rows of the Events tab → events. Past, incomplete and unknown-city rows are skipped (and logged). */
export function parseEventTab(values: string[][], now: Date, log: (m: string) => void = console.log, idPrefix = 'manual', label = EVENTS_TAB): TerraEvent[] {
  const header = (values[0] ?? []).map((c) => c.trim().toLowerCase());
  const at = Object.fromEntries(EVENT_HEADERS.map((h) => [h, header.indexOf(h.toLowerCase())])) as Record<(typeof EVENT_HEADERS)[number], number>;
  if (at.Date < 0 || at.Title < 0 || at.City < 0) {
    if (values.length) log(`${label}: header row needs Date, Title and City; skipping it.`);
    return [];
  }
  const today = now.toISOString().slice(0, 10);
  const out: TerraEvent[] = [];
  values.slice(1).forEach((cells, index) => {
    const get = (h: (typeof EVENT_HEADERS)[number]) => (at[h] >= 0 ? (cells[at[h]] ?? '').trim() : '');
    const row = index + 2;
    const title = get('Title');
    if (!title && !get('Date')) return;
    const date = sheetDate(get('Date'));
    if (!title || !date) return log(`${label} row ${row}: needs a title and a date like 2026-10-14 or 10/14/2026; skipped.`);
    const city = cityOf(get('City'));
    if (!city) return log(`${label} row ${row}: unknown city "${get('City')}" (use one of ${CITIES.join(', ')}); skipped.`);
    if (date < today) return;
    let link = get('Link');
    if (link && !/^https?:\/\//i.test(link)) link = `https://${link}`;
    try {
      link = link ? new URL(link).href : '';
    } catch {
      link = '';
    }
    const time = sheetTime(get('Time'));
    const start = centralIso(time ? `${date} ${time}` : date)!;
    out.push({
      id: `${idPrefix}-${row}-${date}`,
      title,
      url: link,
      start,
      end: null,
      city,
      organizer: get('Organizer') || MANUAL_SOURCE,
      venue: get('Venue') || null,
      cost: null,
      source: MANUAL_SOURCE
    });
  });
  return out;
}

/** Read the Events tab; creates it with headers when writing is allowed. Never throws. */
export async function loadSheetEvents(
  client: SheetsClient | null,
  now: Date,
  options: { write: boolean; log?: (m: string) => void }
): Promise<TerraEvent[] | null> {
  const log = options.log ?? console.log;
  if (!client) return null;
  try {
    if (options.write && (await client.ensureTabs([EVENTS_TAB])).length) {
      await client.write(tabRange(EVENTS_TAB), [[...EVENT_HEADERS]]);
      log(`Created the ${EVENTS_TAB} tab in the Google Sheet.`);
      return [];
    }
    const events = parseEventTab(await client.read(tabRange(EVENTS_TAB)), now, log);
    log(`${EVENTS_TAB} tab: ${events.length} upcoming events added by hand.`);
    return events;
  } catch (error) {
    log(`${EVENTS_TAB} tab: ${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
}

/** The committed hand list (backend/data/events-manual.json): the sheet's columns as JSON keys. */
export function parseManualFile(json: { events?: Array<Record<string, string>> }, now: Date, log: (m: string) => void = console.log): TerraEvent[] {
  const rows = (json.events ?? []).map((e) => EVENT_HEADERS.map((h) => String(e[h.toLowerCase()] ?? '')));
  return parseEventTab([[...EVENT_HEADERS], ...rows], now, log, 'file', 'events-manual.json');
}

/** File rows plus sheet rows; when the sheet could not be read, its rows from the last build stay. */
export function mergeManual(fileEvents: TerraEvent[], sheet: TerraEvent[] | null, previous: TerraEvent[]): TerraEvent[] {
  return [...fileEvents, ...(sheet ?? previous.filter((e) => e.id.startsWith('manual-')))];
}
