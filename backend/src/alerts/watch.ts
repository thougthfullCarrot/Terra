import { createHash } from 'node:crypto';
import type { City } from '../types.js';
import { escapeHtml } from './digest.js';
import { STATUS } from '../market/developments.js';
import { isFinished, isTabsNumber, type FollowedDetails } from './followed.js';
import type { HistoryDay, HistoryFigure, HistoryRegistration } from './history.js';

/**
 * What changed for one member's watchlist between two history days, and the
 * digest email that reports it. Pure: send-watch.ts feeds it rows from
 * Supabase, the tests feed it fixtures.
 *
 * Every event has an id that names the change itself (the filing, the
 * project's new status, the figure's new period), not the day it was seen, so
 * the send log (watch_sends) can make sure nobody hears about it twice.
 */

export type WatchKind = 'market' | 'area' | 'project';

export interface WatchFilters {
  /** market items with a metric: tell me when it rises above this. */
  above?: number;
  /** market items with a metric: tell me when it falls below this. */
  below?: number;
  /** area items: only these types of work ("New construction", "Addition", "Other work"). */
  work?: string[];
  /** area items: only filings at least this costly. */
  minCost?: number;
}

export interface WatchItem {
  id: string;
  kind: WatchKind;
  city: string;
  /** market: a metric key or '' for every figure. project: the TABS project number. area: ''. */
  ref: string;
  filters: WatchFilters;
}

export interface WatchEvent {
  id: string;
  kind: WatchKind;
  city: string;
  title: string;
  detail: string;
  url?: string;
}

export interface WatchResult {
  events: WatchEvent[];
  /** Coverage gaps and other caveats the member should read with the events. */
  notes: string[];
}

/** Most events one email lists; the rest are counted. */
export const EMAIL_EVENT_LIMIT = 40;

export const TABS_COVERAGE_NOTE =
  'New filings come from TDLR TABS, the public record of projects registered under the Texas Architectural Barriers Act. Only qualifying projects must register (public buildings, and commercial buildings and places open to the public above the cost threshold), so houses, many industrial buildings and smaller jobs are not included.';

/**
 * Changes between `days[0]` (the last digest's day) and the newest day.
 * Days in between are read for filings, so a gap longer than the
 * registrations window loses nothing that was stored.
 */
export function watchEvents(items: WatchItem[], allDays: HistoryDay[], since?: string): WatchResult {
  const notes = new Set<string>();
  // Project items read every day given (sendWatch starts them a day early);
  // market and area items start at the newest day on or before `since`.
  let first = 0;
  if (since) allDays.forEach((d, i) => d.day <= since && (first = i));
  const days = allDays.slice(first);
  const events = new Map<string, WatchEvent>();
  const add = (event: WatchEvent) => {
    if (!events.has(event.id)) events.set(event.id, event);
  };
  if (allDays.length < 2) {
    return { events: [], notes: ['Changes are measured from your first digest, so they start showing in the next one.'] };
  }
  const before = days[0]!;
  const today = days[days.length - 1]!;

  for (const item of items) {
    const city = item.city as City;
    if (item.kind === 'market') marketEvents(item, city, before, today, add);
    else if (item.kind === 'project') projectEvents(item, allDays, add, notes);
    else areaEvents(item, city, days, add, notes);
  }

  // Sources answering with an old file, once per email.
  if (items.some((i) => i.kind === 'market')) {
    const was = new Set(before.behind.map((b) => `${b.source}|${b.latest}`));
    for (const lag of today.behind) {
      if (was.has(`${lag.source}|${lag.latest}`)) continue;
      add({
        id: `behind:${lag.source}:${lag.latest}`,
        kind: 'market',
        city: '',
        title: `${lag.source} is behind its usual schedule`,
        detail: `Its newest figures are for ${lag.latest}. They stay published with that date until the source updates.`
      });
    }
  }
  if (items.some((i) => i.kind === 'area')) notes.add(TABS_COVERAGE_NOTE);
  return { events: [...events.values()], notes: [...notes] };
}

function marketEvents(item: WatchItem, city: City, before: HistoryDay, today: HistoryDay, add: (e: WatchEvent) => void) {
  const now = today.metrics[city] ?? {};
  const then = before.metrics[city] ?? {};
  const keys = item.ref ? [item.ref] : Object.keys(now);
  for (const key of keys) {
    const t = now[key];
    if (!t) continue;
    const b = then[key];
    const [label, unit] = today.metricInfo[key] ?? [key, 'count'];
    // A figure another market repeats is one observation: report it once, under the market it comes from.
    const owner = t.sh ?? city;
    const where = t.sh ? `${city} (${t.sh} metro figure)` : city;

    if (t.s === 'expired' && b?.s !== 'expired') {
      add({
        id: `market:${owner}:${key}:expired:${t.p ?? ''}`,
        kind: 'market',
        city,
        title: `${where}: ${label} is no longer published`,
        detail: `Its source has not answered for longer than Terra keeps a figure. The last value was ${formatFigure(t, unit)}.`
      });
      continue;
    }
    if (t.v == null) continue;

    const { above, below } = item.ref ? item.filters : {};
    if (above != null || below != null) {
      const beyond = (f: HistoryFigure | undefined) =>
        f?.v != null && ((above != null && f.v > above) || (below != null && f.v < below));
      if (beyond(t) && !beyond(b)) {
        const dir = above != null && t.v > above ? 'above' : 'below';
        const mark = dir === 'above' ? above! : below!;
        add({
          id: `market:${owner}:${key}:${dir}:${mark}:${t.p ?? ''}`,
          kind: 'market',
          city,
          title: `${where}: ${label} is ${dir} ${formatValue(mark, unit)}`,
          detail: `Now ${formatFigure(t, unit)}${b?.v != null ? `, was ${formatFigure(b, unit)}` : ''}.`
        });
      }
      continue;
    }

    if (b?.v != null && (t.p !== b.p || t.v !== b.v)) {
      add({
        id: `market:${owner}:${key}:${t.p ?? ''}:${t.v}`,
        kind: 'market',
        city,
        title: `${where}: ${label} ${t.v > b.v ? 'rose' : t.v < b.v ? 'fell' : 'updated'}`,
        detail: `${formatFigure(t, unit)}, was ${formatFigure(b, unit)}.${t.s === 'retained' ? ' The newest reading failed a check, so this is the last good figure.' : ''}`
      });
    }
  }
}

/** One day's view of a followed project, from its own TABS check or, failing that, the map. */
interface Observation {
  day: string;
  src: 'followed' | 'map';
  n: string;
  st: string | null;
  code: number | null;
  cost: number | null;
  start: string | null;
  end: string | null;
  url: string;
  checked: string | null;
  details: FollowedDetails | null;
}

type Seen = Observation | 'not_found' | 'error' | null;

function observe(day: HistoryDay, ref: string): Seen {
  const f = day.followed?.[ref];
  if (f) {
    if (f.state === 'error') return 'error';
    if (f.state === 'not_found') return 'not_found';
    return {
      day: day.day,
      src: 'followed',
      n: f.n ?? day.projects[ref]?.n ?? ref,
      st: f.st,
      code: f.code,
      cost: f.cost,
      start: f.start,
      end: f.end,
      url: f.url,
      checked: f.checked,
      details: f.details
    };
  }
  const p = day.projects[ref];
  if (!p) return null;
  return { day: day.day, src: 'map', n: p.n, st: p.st, code: null, cost: p.cost > 0 ? p.cost : null, start: null, end: p.end, url: p.url, checked: null, details: null };
}

/**
 * A short, stable tag for a value, so an event id names the change itself:
 * a different value seen on the same day (a later build) is a new event.
 */
function tag(value: unknown): string {
  const text = String(value ?? '');
  if (/^[\w.-]{1,24}$/.test(text)) return text;
  return createHash('sha256').update(norm(text)).digest('hex').slice(0, 10);
}

const KNOWN_STATUS = new Set(Object.values(STATUS));
const norm = (v: string) => v.replace(/\s+/g, ' ').trim().toLowerCase();

export function shortDate(iso: string): string {
  const d = new Date(iso.length === 10 ? `${iso}T12:00:00Z` : iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'America/Chicago' });
}

/**
 * Every change to a followed project across the whole period, day by day, so
 * a change that is undone before the digest still shows (A to B, then B back
 * to A, is two events). Event ids name the field and the day the change was
 * seen, so a rebuilt digest repeats none and a later change back is new.
 * A day TABS couldn't be read, or a value TABS left blank, is never a change.
 */
function projectEvents(item: WatchItem, days: HistoryDay[], add: (e: WatchEvent) => void, notes: Set<string>) {
  const ref = item.ref;
  let prev: Observation | null = null;
  let missingSince: string | null = null;
  let missingRun = 0;
  let lastSeen: Seen = null;
  let everOnMap = false;

  for (const day of days) {
    const seen = observe(day, ref);
    lastSeen = seen;
    if (seen && seen !== 'error' && seen !== 'not_found' && seen.src === 'map') everOnMap = true;
    if (seen === 'not_found') {
      missingRun++;
      missingSince ??= day.day;
      if (missingRun === 2 && prev) {
        add({
          id: `project:${ref}:notfound:${missingSince}`,
          kind: 'project',
          city: item.city,
          title: `${prev.n} is no longer listed in TDLR TABS`,
          detail: `TABS answered two checks (since ${shortDate(missingSince)}) without this project number. It may have been withdrawn or renumbered; Terra keeps checking.`,
          url: prev.url
        });
      }
      continue;
    }
    if (!seen || seen === 'error') continue;
    missingRun = 0;
    missingSince = null;
    if (prev) compare(ref, item.city, prev, seen, add);
    prev = seen;
  }

  if (lastSeen === 'error') {
    const name = prev?.n ?? ref;
    notes.add(
      `TDLR TABS couldn't be checked for ${name} on the latest build${prev?.checked ? `; it was last checked ${shortDate(prev.checked)}` : ''}. Any change will show once TABS answers.`
    );
  } else if (lastSeen === null && everOnMap && !isTabsNumber(ref)) {
    notes.add(`${prev?.n ?? ref} is no longer on the development map. City permits are read only through the map, so later changes to it can't be reported.`);
  }
}

function compare(ref: string, city: string, b: Observation, t: Observation, add: (e: WatchEvent) => void) {
  const where = t.src === 'followed' ? `TDLR TABS, checked ${shortDate(t.checked ?? t.day)}` : `development map, ${shortDate(t.day)}`;
  const event = (field: string, value: unknown, title: string, detail: string) =>
    add({ id: `project:${ref}:${field}:${t.day}:${tag(value)}`, kind: 'project', city, title: `${t.n}: ${title}`, detail: `${detail} Source: ${where}.`, url: t.url });

  // Labels from two sources only line up when both are known TABS statuses.
  const comparable = b.src === t.src || (b.st != null && t.st != null && KNOWN_STATUS.has(b.st) && KNOWN_STATUS.has(t.st));
  if (b.st && t.st && b.st !== t.st && comparable) {
    if (isFinished(t.code)) event('status', t.st, `TABS lists it as ${t.st}`, `Status was ${b.st}. TABS marks the project finished or closed.`);
    else event('status', t.st, t.st, `Status was ${b.st}.`);
  }
  if (b.cost != null && t.cost != null && b.cost !== t.cost) {
    event('cost', t.cost, `estimated cost now ${formatValue(t.cost, 'usd')}`, `Was ${formatValue(b.cost, 'usd')}.`);
  }
  if (t.end && t.end !== b.end) {
    event('end', t.end, `new estimated finish ${t.end}`, b.end ? `Was ${b.end}.` : 'No finish date was filed before.');
  }
  if (b.start && t.start && b.start !== t.start) {
    event('start', t.start, `new estimated start ${t.start}`, `Was ${b.start}.`);
  }
  if (b.src === 'followed' && t.src === 'followed' && b.n && t.n && norm(b.n) !== norm(t.n)) {
    event('name', t.n, 'renamed in TABS', `Was ${b.n}.`);
  }
  const bd = b.details;
  const td = t.details;
  if (bd && td && bd.checked !== td.checked) {
    const page = `TDLR TABS project page, read ${shortDate(td.checked)}`;
    const detail = (field: string, value: unknown, title: string, text: string) =>
      add({ id: `project:${ref}:${field}:${t.day}:${tag(value)}`, kind: 'project', city, title: `${t.n}: ${title}`, detail: `${text} Source: ${page}.`, url: t.url });
    if (bd.owner && td.owner && norm(bd.owner) !== norm(td.owner)) detail('owner', td.owner, `owner now ${td.owner}`, `Was ${bd.owner}.`);
    if (bd.designFirm && td.designFirm && norm(bd.designFirm) !== norm(td.designFirm)) detail('design', td.designFirm, `design firm now ${td.designFirm}`, `Was ${bd.designFirm}.`);
    if (bd.squareFeet != null && td.squareFeet != null && bd.squareFeet !== td.squareFeet) {
      detail('size', td.squareFeet, `size now ${formatValue(td.squareFeet, 'count')} sq ft`, `Was ${formatValue(bd.squareFeet, 'count')} sq ft.`);
    }
    if (bd.scope && td.scope && norm(bd.scope) !== norm(td.scope)) detail('scope', td.scope, 'scope of work changed', `Now: ${td.scope}`);
  }
}

function areaEvents(item: WatchItem, city: City, days: HistoryDay[], add: (e: WatchEvent) => void, notes: Set<string>) {
  const [before, ...after] = days;
  const today = after[after.length - 1]!;
  const fits = (r: { w: string; cost: number }) =>
    (!item.filters.work?.length || item.filters.work.includes(r.w)) && (item.filters.minCost == null || r.cost >= item.filters.minCost);

  const seen = new Set((before!.registrations?.items ?? []).map((r) => r.id));
  const found = new Map<string, HistoryRegistration>();
  for (const day of after) {
    if (!day.registrations) {
      notes.add(`TABS filings could not be read on ${day.day}; anything filed only in that window may be missing.`);
      continue;
    }
    for (const r of day.registrations.items) if (r.cities.includes(city) && !seen.has(r.id)) found.set(r.id, r);
  }
  for (const r of found.values()) {
    if (!fits(r)) continue;
    add({
      id: `tabs:${r.id}`,
      kind: 'area',
      city,
      title: `New filing in ${r.county} County: ${r.n}`,
      detail: [r.w, r.cost ? `${formatValue(r.cost, 'usd')} estimated` : '', `filed ${r.reg}`, r.st].filter(Boolean).join(' · '),
      url: r.url
    });
  }

  // City building permits on the map (San Antonio, Austin, Fort Worth, Arlington) that are new since the last digest.
  for (const [id, p] of Object.entries(today.projects)) {
    if (p.src !== 'city' || p.c !== city || before!.projects[id] || !fits({ w: 'New construction', cost: p.cost })) continue;
    add({
      id: `permit:${id}`,
      kind: 'area',
      city,
      title: `New building permit: ${p.n}`,
      detail: [p.cost ? `${formatValue(p.cost, 'usd')} estimated` : '', p.st].filter(Boolean).join(' · '),
      url: p.url
    });
  }

  for (const c of today.registrations?.coverage ?? []) {
    if (!c.cities.includes(city) || c.complete === true) continue;
    notes.add(
      c.error
        ? `${c.county} County's filings could not be read on the latest build, so some may be missing.`
        : c.complete === false
          ? `Only ${c.read} of ${c.reported ?? 'the'} recent ${c.county} County filings could be read, so some may be missing.`
          : `TABS did not report a total for ${c.county} County, so Terra could not confirm every filing was read.`
    );
  }
}

export function formatValue(value: number, unit: string): string {
  if (!Number.isFinite(value)) return '—';
  switch (unit) {
    case 'usd': {
      const abs = Math.abs(value);
      if (abs >= 1e9) return `$${(value / 1e9).toFixed(1)}B`;
      if (abs >= 1e6) return `$${(value / 1e6).toFixed(1)}M`;
      if (abs < 10) return `$${value.toFixed(2)}`;
      return `$${Math.round(value).toLocaleString('en-US')}`;
    }
    case 'change':
      return `${value > 0 ? '+' : value < 0 ? '−' : ''}${Math.abs(value).toFixed(1)}%`;
    case 'rate':
      return `${value.toFixed(1)}%`;
    case 'taxRate':
      return `${value.toFixed(2)}%`;
    default:
      return Math.round(value).toLocaleString('en-US');
  }
}

function formatFigure(f: HistoryFigure, unit: string): string {
  return f.v == null ? '—' : `${formatValue(f.v, unit)}${f.p ? ` (${f.p})` : ''}`;
}

export interface WatchEmail {
  subject: string;
  text: string;
  html: string;
}

/** The digest email. `unsubscribeLink` turns these emails off in one click. */
export function renderWatchEmail(
  result: WatchResult,
  { siteUrl, unsubscribeLink, frequency }: { siteUrl: string; unsubscribeLink: string; frequency: 'daily' | 'weekly' }
): WatchEmail {
  const shown = result.events.slice(0, EMAIL_EVENT_LIMIT);
  const more = result.events.length - shown.length;
  const site = siteUrl.endsWith('/') ? siteUrl : `${siteUrl}/`;
  const first = shown[0];
  const subject =
    result.events.length === 1 && first ? `Terra watchlist: ${first.title}` : `Terra watchlist: ${result.events.length} changes ${frequency === 'daily' ? 'today' : 'this week'}`;
  const footer = `You get this ${frequency} email because watchlist emails are on in your Terra profile.`;

  const text = [
    ...shown.flatMap((e) => [e.title, e.detail, ...(e.url ? [e.url] : []), '']),
    ...(more > 0 ? [`And ${more} more. See your watchlist on Terra: ${site}`, ''] : []),
    ...(result.notes.length ? ['About this data:', ...result.notes.map((n) => `- ${n}`), ''] : []),
    footer,
    `Change it in your profile: ${site}`,
    `Unsubscribe from watchlist emails: ${unsubscribeLink}`
  ].join('\n');

  const row = (e: WatchEvent) => `
    <tr><td style="padding:12px 0;border-bottom:1px solid #e4e0d8">
      ${
        e.url
          ? `<a href="${escapeHtml(e.url)}" style="font:600 15px/1.35 Arial,sans-serif;color:#15171a;text-decoration:none">${escapeHtml(e.title)}</a>`
          : `<div style="font:600 15px/1.35 Arial,sans-serif;color:#15171a">${escapeHtml(e.title)}</div>`
      }
      <div style="font:13px/1.45 Arial,sans-serif;color:#4a4f55;margin-top:2px">${escapeHtml(e.detail)}</div>
    </td></tr>`;

  const html = `<!doctype html><html><head><meta charset="utf-8"></head><body style="margin:0;background:#f4f2ee">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f2ee"><tr><td align="center" style="padding:24px 12px">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:10px;padding:20px 24px">
      <tr><td style="font:700 12px/1 Arial,sans-serif;letter-spacing:.08em;color:#6b7076;padding-bottom:6px">TERRA · WATCHLIST</td></tr>
      ${shown.map(row).join('')}
      ${more > 0 ? `<tr><td style="padding:12px 0;font:14px/1.4 Arial,sans-serif"><a href="${escapeHtml(site)}" style="color:#1f6f50">And ${more} more on Terra</a></td></tr>` : ''}
      ${
        result.notes.length
          ? `<tr><td style="padding-top:14px;font:12px/1.5 Arial,sans-serif;color:#6b7076">${result.notes.map((n) => `<p style="margin:0 0 6px">${escapeHtml(n)}</p>`).join('')}</td></tr>`
          : ''
      }
      <tr><td style="padding-top:12px;font:12px/1.5 Arial,sans-serif;color:#6b7076">${escapeHtml(footer)} <a href="${escapeHtml(site)}" style="color:#6b7076">Change it</a> or <a href="${escapeHtml(unsubscribeLink)}" style="color:#6b7076">unsubscribe</a>.</td></tr>
    </table>
  </td></tr></table></body></html>`;
  return { subject, text, html };
}
