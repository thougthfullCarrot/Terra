// watch.js — rules for watchlists (migration 0016), kept free of the DOM so
// the backend's tests can run them. watch-view.js draws the buttons and the
// profile list; account.js stores items in Supabase.

/** Must match the trigger in migration 0016. */
export const WATCH_LIMIT = 25;
export const DIGEST_FREQUENCIES = ['weekly', 'daily'];
export const DEFAULT_FREQUENCY = 'weekly';
export const WORK_TYPES = ['New construction', 'Addition', 'Other work'];

/** Follow a market's figures: all of them, or one metric with an optional threshold. */
export function marketItem(city, metric = '', { above, below } = {}) {
  const filters = {};
  if (metric && Number.isFinite(above)) filters.above = above;
  if (metric && Number.isFinite(below)) filters.below = below;
  return { kind: 'market', city: String(city), ref: String(metric ?? ''), filters };
}

/** Follow new project filings in a market's area, optionally only some work types or a minimum cost. */
export function areaItem(city, { work, minCost } = {}) {
  const filters = {};
  const types = Array.isArray(work) ? WORK_TYPES.filter((t) => work.includes(t)) : [];
  if (types.length) filters.work = types;
  if (Number.isFinite(minCost) && minCost > 0) filters.minCost = Math.round(minCost);
  return { kind: 'area', city: String(city), ref: '', filters };
}

/** Follow one TABS project. */
export function projectItem(city, projectId, name = '') {
  const item = { kind: 'project', city: String(city), ref: String(projectId), filters: {} };
  if (name) item.filters.name = String(name).slice(0, 120);
  return item;
}

/** One key per item, matching the table's unique (kind, city, ref). */
export function itemKey(item) {
  return `${item.kind}|${item.city}|${item.ref ?? ''}`;
}

/** How the item reads in the profile list. */
export function itemLabel(item, metricLabel = (key) => key) {
  if (item.kind === 'market') {
    if (!item.ref) return `${item.city} market figures`;
    const name = metricLabel(item.ref);
    const { above, below } = item.filters ?? {};
    if (Number.isFinite(above)) return `${item.city}: ${name} above ${above}`;
    if (Number.isFinite(below)) return `${item.city}: ${name} below ${below}`;
    return `${item.city}: ${name}`;
  }
  if (item.kind === 'area') {
    const bits = [];
    if (item.filters?.work?.length) bits.push(item.filters.work.join(', ').toLowerCase());
    if (item.filters?.minCost) bits.push(`$${item.filters.minCost.toLocaleString('en-US')}+`);
    return `New project filings in the ${item.city} metro${bits.length ? ` (${bits.join(', ')})` : ''}`;
  }
  return `Project: ${item.filters?.name || item.ref} (${item.city})`;
}

/** "3 of 25 followed", or the reason nothing more can be added. */
export function countLine(count) {
  if (count >= WATCH_LIMIT) return `${count} of ${WATCH_LIMIT} followed. Remove one to follow something else.`;
  return `${count} of ${WATCH_LIMIT} followed.`;
}

/** The digest settings as `profiles` columns. Anything unexpected falls back to off and weekly. */
export function digestRow({ watchEmails, digestFrequency }) {
  return {
    watch_emails: Boolean(watchEmails),
    digest_frequency: DIGEST_FREQUENCIES.includes(digestFrequency) ? digestFrequency : DEFAULT_FREQUENCY
  };
}

/** What a failed add means to the member: the limit, lost access, or something else. */
export function addProblem(message) {
  const text = String(message ?? '');
  if (/up to 25 items|watchlist_limit/i.test(text)) return `You can follow up to ${WATCH_LIMIT} items. Remove one in your profile to add another.`;
  if (/row-level security/i.test(text)) return 'Following needs a college email or an active subscription.';
  if (/duplicate key/i.test(text)) return "You're already following this.";
  return `Couldn't follow it: ${text}`;
}

/**
 * The unsubscribe link's parts from the page address, or null when it has
 * none. Matches unsubscribeUrl() in backend/src/alerts/unsubscribe.ts.
 */
export function unsubscribeParams(search) {
  const params = new URLSearchParams(search);
  const kind = params.get('unsubscribe');
  const user = params.get('u') ?? '';
  const token = params.get('t') ?? '';
  if (!['jobs', 'watch'].includes(kind)) return null;
  if (!/^[0-9a-f-]{36}$/i.test(user) || !/^[0-9a-f]{64}$/i.test(token)) return { kind, valid: false };
  return { kind, user, token, valid: true };
}
