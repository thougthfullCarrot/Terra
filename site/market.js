// market.js — the market data page's rules, as plain functions with no DOM.
//
// Like feed.js, kept apart from the drawing code so sorting, ranking and
// number formatting are covered by the backend's tests. The data file is
// written by backend/src/bin/export-market.ts.

export const ORDERS = ['desc', 'asc'];

/** The order that puts the better end first, for a metric's default sort. */
export function defaultOrder(metric) {
  return metric?.better === 'low' ? 'asc' : 'desc';
}

/**
 * Markets sorted by one metric. Markets without a value go last whatever the
 * order, so "lowest first" never opens on blanks; city name breaks ties.
 * key 'city' sorts by name.
 */
export function sortMarkets(markets, key, order = 'desc') {
  const dir = order === 'asc' ? 1 : -1;
  return [...markets].sort((a, b) => {
    if (key === 'city') return dir * a.city.localeCompare(b.city);
    const x = a.values?.[key];
    const y = b.values?.[key];
    if (x == null && y == null) return a.city.localeCompare(b.city);
    if (x == null) return 1;
    if (y == null) return -1;
    return dir * (x - y) || a.city.localeCompare(b.city);
  });
}

/**
 * The city whose figure this market repeats for a metric (New Braunfels
 * showing the San Antonio metro's jobs), or null. Files written before
 * version 2 carry no shared map, so nothing reads as shared.
 */
export function sharedWith(market, key) {
  return market?.shared?.[key] ?? null;
}

/**
 * Whether a figure was read on the latest build (fresh), kept from an earlier
 * one because its source did not answer (retained), dropped as too old
 * (expired) or never read (missing). Older files have no status: a value
 * there reads as fresh.
 */
export function valueStatus(market, key) {
  const status = market?.status?.[key];
  if (status) return status;
  return market?.values?.[key] != null ? 'fresh' : 'missing';
}

/** What kind of figure a metric is, as the page names it. */
export const CATEGORY_LABELS = {
  economic: 'Economy',
  residential: 'Residential',
  permits: 'Residential permits',
  appraisal: 'Appraised values',
  taxes: 'Taxes',
  infrastructure: 'Infrastructure',
  commercial: 'Commercial property'
};

/** The area a metric's figure describes, as the page names it. */
export const GEOGRAPHY_LABELS = {
  city: 'city limits',
  metro: 'metro area',
  msa: 'whole metro area',
  district: 'TxDOT district',
  fmrArea: 'HUD rent area'
};

/** "Oct 10, 2026" from an ISO time, in UTC; '' when it does not parse. */
export function formatDate(iso) {
  const time = Date.parse(iso ?? '');
  if (!Number.isFinite(time)) return '';
  return new Date(time).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
}

/**
 * The lines that explain one figure, for its tooltip and detail: the
 * reporting period, the source and area, and whether it was kept from an
 * earlier update, dropped as too old, or repeats another market's figure.
 */
export function valueNotes(market, metric) {
  const key = metric.key;
  const lines = [];
  const period = market?.periods?.[key];
  if (period) lines.push(period);
  const where = GEOGRAPHY_LABELS[metric.geography];
  if (metric.source) lines.push(`${metric.source}${where ? `, ${where}` : ''}`);
  const status = valueStatus(market, key);
  const read = formatDate(market?.fetchedAt?.[key]);
  if (status === 'retained') lines.push(`Not refreshed: kept from an earlier update${read ? ` (read ${read})` : ''}`);
  if (status === 'expired') lines.push(`Removed: the source has not answered since ${read || 'an earlier update'}`);
  const same = sharedWith(market, key);
  if (same) lines.push(`Same figure as ${same} (one ${where ?? 'area'}), counted once in rankings`);
  return lines;
}

/** How many markets are ranked on a metric: those with a figure of their own, not repeating another's. */
export function rankedCount(markets, key) {
  return markets.filter((m) => m.values?.[key] != null && Number.isFinite(m.values[key]) && !sharedWith(m, key)).length;
}

/** Figures across the file kept from an earlier update because their source did not refresh. */
export function retainedCount(snapshot) {
  return (snapshot?.markets ?? []).reduce(
    (sum, market) => sum + Object.keys(market.values ?? {}).filter((key) => valueStatus(market, key) === 'retained').length,
    0
  );
}

/**
 * Each city's place for one metric, 1 = best. Without a better end the
 * highest value is 1st. Cities without a value get no rank, and neither does
 * a city whose figure repeats another's (a shared metro is ranked once).
 */
export function ranks(markets, metric) {
  const ranked = sortMarkets(markets, metric.key, defaultOrder(metric)).filter(
    (m) => m.values?.[metric.key] != null && !sharedWith(m, metric.key)
  );
  const out = new Map();
  let place = 0;
  let last;
  ranked.forEach((market, index) => {
    const value = market.values[metric.key];
    if (value !== last) place = index + 1;
    last = value;
    out.set(market.city, place);
  });
  return out;
}

export function ordinal(n) {
  const tens = n % 100;
  if (tens >= 11 && tens <= 13) return `${n}th`;
  return `${n}${{ 1: 'st', 2: 'nd', 3: 'rd' }[n % 10] ?? 'th'}`;
}

/** A metric's value as the page shows it; an em dash when there is none. */
export function formatValue(value, unit) {
  if (value == null || !Number.isFinite(value)) return '—';
  switch (unit) {
    case 'usd': {
      // Whole roll values run to billions; $/sq ft figures can be under $10.
      const abs = Math.abs(value);
      if (abs >= 1e9) return `$${trim(value / 1e9, 1)}B`;
      if (abs >= 1e7) return `$${trim(value / 1e6, 1)}M`;
      if (abs < 10) return `$${value.toFixed(2)}`;
      return `$${Math.round(value).toLocaleString('en-US')}`;
    }
    case 'change': {
      const rounded = Math.round(value * 10) / 10;
      const sign = rounded > 0 ? '+' : rounded < 0 ? '−' : '';
      return `${sign}${Math.abs(rounded).toFixed(1)}%`;
    }
    case 'rate':
      return `${(Math.round(value * 10) / 10).toFixed(1)}%`;
    case 'taxRate':
      return `${value.toFixed(2)}%`;
    default:
      return compactCount(value);
  }
}

/** A change in a rate, in percentage points: +0.25 pts. */
export function formatPoints(value) {
  if (value == null || !Number.isFinite(value)) return '—';
  const rounded = Math.round(value * 100) / 100;
  const sign = rounded > 0 ? '+' : rounded < 0 ? '−' : '';
  return `${sign}${Math.abs(rounded).toFixed(2)} pts`;
}

function compactCount(value) {
  const abs = Math.abs(value);
  if (abs >= 1e6) return `${trim(value / 1e6, 2)}M`;
  if (abs >= 1e4) return `${trim(value / 1e3, 0)}K`;
  if (abs >= 1e3) return `${trim(value / 1e3, 1)}K`;
  return String(Math.round(value));
}

function trim(value, digits) {
  return value.toFixed(digits).replace(/\.0+$|(\.\d*?)0+$/, '$1');
}

/**
 * Bar length, 0-100, for a value among the others in its column. Levels are
 * drawn from zero; changes from the column's lowest value, so small
 * differences in growth stay visible.
 */
export function barPercent(value, values, unit) {
  const present = values.filter((v) => v != null && Number.isFinite(v));
  if (value == null || !present.length) return 0;
  const max = Math.max(...present);
  const min = unit === 'change' ? Math.min(...present) : Math.min(0, ...present);
  if (max === min) return 100;
  return Math.max(4, Math.round(((value - min) / (max - min)) * 100));
}

export const TOOLS = ['compare', 'calc', 'uw', 'leases', 'reports', 'sites', 'pay', 'zoning', 'growth'];

/** The most cities the comparison puts side by side; fewer than two is filled up from the list. */
export const MAX_COMPARE = 4;

/**
 * The view state lives in the URL hash (#markets&city=Houston&focus=office), leaving the query string to the job filters.
 * tool=compare (with cities=Dallas,Houston), calc, leases, reports and sites open the comparison, the deal calculator,
 * broker lease rates, the market reports list, the site finder, the salary check, zoning alerts and who's hiring vs.
 * who's building; city= narrows all but the first two.
 */
export function readMarketHash(hash, snapshot) {
  const params = new URLSearchParams(String(hash ?? '').replace(/^#/, ''));
  const groups = snapshot?.groups ?? [];
  const metrics = snapshot?.metrics ?? [];
  const cities = (snapshot?.markets ?? []).map((m) => m.city);

  const focus = groups.some((g) => g.key === params.get('focus')) ? params.get('focus') : (groups[0]?.key ?? '');
  const group = groups.find((g) => g.key === focus);
  const sortable = ['city', ...(group?.metrics ?? [])];
  const sort = sortable.includes(params.get('sort')) ? params.get('sort') : (group?.metrics[0] ?? 'city');
  const metric = metrics.find((m) => m.key === sort);
  const order = ORDERS.includes(params.get('order')) ? params.get('order') : sort === 'city' ? 'asc' : defaultOrder(metric);

  const city = cities.includes(params.get('city')) ? params.get('city') : '';
  const tool = TOOLS.includes(params.get('tool')) ? params.get('tool') : '';
  let compare = [];
  if (tool === 'compare') {
    const picked = (params.get('cities') ?? '').split(',').filter((c) => cities.includes(c));
    compare = [...new Set(picked)].slice(0, MAX_COMPARE);
    // A comparison needs two: the open city first, then the list's order.
    for (const c of [city, ...cities]) if (compare.length < 2 && c && !compare.includes(c)) compare.push(c);
  }

  return { open: params.has('markets'), city, focus, sort, order, tool, compare };
}

export function writeMarketHash(state) {
  const params = new URLSearchParams();
  if (state.city) params.set('city', state.city);
  if (state.focus) params.set('focus', state.focus);
  if (state.sort) params.set('sort', state.sort);
  if (state.order) params.set('order', state.order);
  if (state.tool) params.set('tool', state.tool);
  if (state.tool === 'compare' && state.compare?.length) params.set('cities', state.compare.join(','));
  const text = params.toString();
  return `#markets${text ? `&${text}` : ''}`;
}

/** The figures the comparison opens on: jobs, people, rents, building and taxes. */
export const KEY_METRICS = [
  'jobsGrowth',
  'unemployment',
  'populationGrowth',
  'medianIncome',
  'medianRent',
  'rentGrowth',
  'zoriGrowth',
  'permitUnits',
  'permitGrowth',
  'taxRate',
  'taxOnMillion'
];

/**
 * One row per metric for the cities compared, in their order, with the city
 * that comes out best. No best where the metric has no better end or fewer
 * than two of the cities have a figure; ties name every city tied.
 */
export function compareRows(markets, metrics, cities) {
  const picked = cities.map((city) => markets.find((m) => m.city === city)).filter(Boolean);
  return metrics.map((metric) => {
    const values = picked.map((m) => m.values?.[metric.key] ?? null);
    const present = values.filter((v) => v != null && Number.isFinite(v));
    let best = [];
    if (metric.better && present.length >= 2) {
      const top = metric.better === 'low' ? Math.min(...present) : Math.max(...present);
      if (present.some((v) => v !== top)) best = picked.filter((_, i) => values[i] === top).map((m) => m.city);
    }
    return { metric, values, best };
  });
}

/**
 * Drop metrics no market has a value for, and groups left empty, so a source
 * that has not answered yet (say the Census, before its key is set) hides its
 * columns instead of showing a row of dashes.
 */
export function pruneSnapshot(snapshot) {
  const has = (key) => snapshot.markets.some((m) => m.values?.[key] != null);
  const metrics = snapshot.metrics.filter((m) => has(m.key));
  const keys = new Set(metrics.map((m) => m.key));
  const groups = snapshot.groups
    .map((g) => ({ ...g, metrics: g.metrics.filter((key) => keys.has(key)) }))
    .filter((g) => g.metrics.length);
  return { ...snapshot, metrics, groups };
}

/**
 * One metro's development projects for the map (p.city is the market, p.place the town), biggest first; with
 * privateOnly, just the ones built with private money.
 */
export function cityProjects(projects, city, { privateOnly = false } = {}) {
  return (projects ?? [])
    .filter((p) => p.city === city && (!privateOnly || !p.isPublic))
    .sort((a, b) => b.cost - a.cost);
}

/** A map pin's radius in pixels: area grows with cost, from 6 for the smallest to 20 for the biggest. */
export function markerRadius(cost, maxCost) {
  if (!(cost > 0) || !(maxCost > 0)) return 6;
  return Math.round(6 + 14 * Math.sqrt(Math.min(cost, maxCost) / maxCost));
}

/** "Aug 2026 – Feb 2028", "Starts Aug 2026", or '' with no dates. */
export function projectDates(start, end) {
  const month = (iso) => {
    const match = /^(\d{4})-(\d{2})/.exec(iso ?? '');
    if (!match) return null;
    const names = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return `${names[Number(match[2]) - 1]} ${match[1]}`;
  };
  const from = month(start);
  const to = month(end);
  if (from && to && end >= start) return `${from} – ${to}`;
  if (from) return `Starts ${from}`;
  if (to) return `Finishes ${to}`;
  return '';
}
