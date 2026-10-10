import type { City } from '../types.js';
import { escapeHtml } from './digest.js';
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
export function watchEvents(items: WatchItem[], days: HistoryDay[]): WatchResult {
  const notes = new Set<string>();
  const events = new Map<string, WatchEvent>();
  const add = (event: WatchEvent) => {
    if (!events.has(event.id)) events.set(event.id, event);
  };
  if (days.length < 2) {
    return { events: [], notes: ['Changes are measured from your first digest, so they start showing in the next one.'] };
  }
  const before = days[0]!;
  const today = days[days.length - 1]!;

  for (const item of items) {
    const city = item.city as City;
    if (item.kind === 'market') marketEvents(item, city, before, today, add);
    else if (item.kind === 'project') projectEvents(item, before, today, add);
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

function projectEvents(item: WatchItem, before: HistoryDay, today: HistoryDay, add: (e: WatchEvent) => void) {
  const t = today.projects[item.ref];
  const b = before.projects[item.ref];
  if (!t) {
    if (b) {
      add({
        id: `project:${item.ref}:gone`,
        kind: 'project',
        city: item.city,
        title: `${b.n} is off the development map`,
        detail: 'It was finished or closed, or fell below the map’s size cut for its metro. Its TABS record stays public.',
        url: b.url
      });
    }
    return;
  }
  if (!b) return;
  if (t.st !== b.st) {
    add({ id: `project:${item.ref}:status:${t.st}`, kind: 'project', city: t.c, title: `${t.n}: ${t.st}`, detail: `Status was ${b.st}.`, url: t.url });
  }
  if (t.end !== b.end && t.end) {
    add({
      id: `project:${item.ref}:end:${t.end}`,
      kind: 'project',
      city: t.c,
      title: `${t.n}: new estimated finish ${t.end}`,
      detail: b.end ? `Was ${b.end}.` : 'No finish date was filed before.',
      url: t.url
    });
  }
  if (t.cost !== b.cost && t.cost > 0) {
    add({
      id: `project:${item.ref}:cost:${t.cost}`,
      kind: 'project',
      city: t.c,
      title: `${t.n}: estimated cost now ${formatValue(t.cost, 'usd')}`,
      detail: `Was ${formatValue(b.cost, 'usd')}.`,
      url: t.url
    });
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
