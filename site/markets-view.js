// markets-view.js — draws the market data section. The rules live in market.js.
//
// The page has two sections, Jobs and Market data, switched by the URL hash
// so a link can open a city's market directly (#markets&city=Houston). The
// data comes from a loader app.js hands over: market.json on the open site,
// or the members-only Supabase row when accounts are on.
import {
  barPercent,
  defaultOrder,
  formatValue,
  ordinal,
  pruneSnapshot,
  ranks,
  readMarketHash,
  sortMarkets,
  writeMarketHash
} from './market.js';

const $ = (id) => document.getElementById(id);

let loader = null;
/** null until loaded; a promise while loading. */
let snapshot = null;
let loading = null;
let state = null;
let bound = false;

/** Set where the data comes from. null (signed out) hides any data already drawn. */
export function setMarketLoader(next) {
  loader = next;
  snapshot = null;
  loading = null;
  $('m-body').replaceChildren();
  if (next && readMarketHash(location.hash, null).open) show();
}

export function startMarkets() {
  if (bound) return;
  bound = true;
  window.addEventListener('hashchange', show);
  $('m-city').addEventListener('change', (e) => update({ city: e.target.value }));
  $('m-focus').addEventListener('change', (e) => {
    const group = snapshot.groups.find((g) => g.key === e.target.value);
    const sort = group?.metrics[0] ?? 'city';
    update({ focus: e.target.value, sort, order: defaultOrder(metricFor(sort)) });
  });
  $('m-sort').addEventListener('change', (e) =>
    update({ sort: e.target.value, order: e.target.value === 'city' ? 'asc' : defaultOrder(metricFor(e.target.value)) })
  );
  $('m-order').addEventListener('change', (e) => update({ order: e.target.value }));
  show();
}

function metricFor(key) {
  return snapshot?.metrics.find((m) => m.key === key);
}

function update(change) {
  state = { ...state, ...change };
  // replaceState: changing a dropdown should not fill the back button's history.
  history.replaceState(null, '', `${location.pathname}${location.search}${writeMarketHash(state)}`);
  render();
}

async function show() {
  const open = readMarketHash(location.hash, null).open;
  $('jobs-view').hidden = open;
  $('markets-view').hidden = !open;
  for (const [id, on] of [['tab-jobs', !open], ['tab-markets', open]]) {
    if (on) $(id).setAttribute('aria-current', 'page');
    else $(id).removeAttribute('aria-current');
  }
  if (!open) return;

  if (!snapshot) {
    if (!loader) return;
    message('Loading market data…');
    loading ??= loader();
    const current = loading;
    try {
      const data = await current;
      if (current !== loading) return; // the loader changed while this was in flight
      if (!data?.markets?.length || !pruneSnapshot(data).groups.length) {
        loading = null;
        message('Market data is being built. Check back in a few minutes.');
        return;
      }
      snapshot = pruneSnapshot(data);
    } catch (error) {
      loading = null;
      message(`Couldn't load market data. ${error instanceof Error ? error.message : ''}`.trim(), true);
      return;
    }
  }
  state = readMarketHash(location.hash, snapshot);
  fillControls();
  render();
}

function fillControls() {
  const city = $('m-city');
  city.replaceChildren(new Option('All markets', ''), ...snapshot.markets.map((m) => new Option(m.city, m.city)));
  city.value = state.city;
  $('m-focus').replaceChildren(...snapshot.groups.map((g) => new Option(g.label, g.key)));
  $('m-focus').value = state.focus;
}

function render() {
  const group = snapshot.groups.find((g) => g.key === state.focus) ?? snapshot.groups[0];
  const sort = $('m-sort');
  sort.replaceChildren(
    ...group.metrics.map((key) => new Option(metricFor(key)?.label ?? key, key)),
    new Option('City name', 'city')
  );
  sort.value = state.sort;
  $('m-order').value = state.order;
  $('m-city').value = state.city;
  $('m-focus').value = state.focus;
  // Sorting means nothing with one market on screen.
  $('m-sort-label').hidden = Boolean(state.city);
  $('m-order-label').hidden = Boolean(state.city);

  $('m-blurb').textContent = group.blurb ?? '';
  $('m-body').replaceChildren(state.city ? cityView(state.city, group) : table(group));
  $('m-sources').replaceChildren(sources());
}

function table(group) {
  const metrics = group.metrics.map(metricFor).filter(Boolean);
  const markets = sortMarkets(snapshot.markets, state.sort, state.order);
  const sorted = metricFor(state.sort);
  const placeFor = sorted ? ranks(snapshot.markets, sorted) : null;

  const wrap = el('div', 'table-wrap');
  const tableNode = el('table', 'market-table');
  const caption = el('caption', 'visually-hidden', `${group.label} figures by market`);
  const head = el('tr');
  head.append(headerCell('city', 'Market', 'city-col'));
  for (const metric of metrics) head.append(headerCell(metric.key, metric.label, 'num', metric));

  const body = el('tbody');
  for (const market of markets) {
    const row = el('tr');
    const name = el('th', 'city-col');
    name.scope = 'row';
    if (placeFor?.has(market.city)) name.append(el('span', 'rank', String(placeFor.get(market.city))));
    const link = el('a', 'city-link', market.city);
    link.href = writeMarketHash({ ...state, city: market.city });
    name.append(link, el('span', 'metro', market.metro ?? ''));
    row.append(name);

    for (const metric of metrics) {
      const value = market.values[metric.key];
      const cell = el('td', `num${metric.key === state.sort ? ' sorted' : ''}`);
      const text = el('span', `value ${tone(value, metric)}`, formatValue(value, metric.unit));
      if (market.periods?.[metric.key]) text.title = market.periods[metric.key];
      cell.append(text);
      if (metric.key === state.sort && value != null) {
        const bar = el('span', 'bar');
        const fill = el('i');
        fill.style.width = `${barPercent(value, snapshot.markets.map((m) => m.values[metric.key]), metric.unit)}%`;
        bar.append(fill);
        cell.append(bar);
      }
      row.append(cell);
    }
    body.append(row);
  }

  const thead = el('thead');
  thead.append(head);
  tableNode.append(caption, thead, body);
  wrap.append(tableNode);

  const frag = document.createDocumentFragment();
  frag.append(wrap, asOf(metrics));
  return frag;
}

function headerCell(key, label, cls, metric) {
  const th = el('th', cls);
  th.scope = 'col';
  const active = state.sort === key;
  if (active) th.setAttribute('aria-sort', state.order === 'asc' ? 'ascending' : 'descending');
  const button = el('button', 'sort-button', label);
  button.type = 'button';
  if (metric?.note) button.title = metric.note;
  if (active) button.append(el('span', 'arrow', state.order === 'asc' ? ' ↑' : ' ↓'));
  button.addEventListener('click', () => {
    if (active) update({ order: state.order === 'asc' ? 'desc' : 'asc' });
    else update({ sort: key, order: key === 'city' ? 'asc' : defaultOrder(metric) });
  });
  th.append(button);
  return th;
}

function cityView(city, focus) {
  const market = snapshot.markets.find((m) => m.city === city);
  const frag = document.createDocumentFragment();

  const head = el('div', 'card market-head');
  const back = el('a', 'link', '← All markets');
  back.href = writeMarketHash({ ...state, city: '' });
  head.append(back, el('h2', 'role', market.city), el('p', 'firm', market.metro ?? ''));
  frag.append(head);

  // The chosen property type first, then the rest.
  const groups = [focus, ...snapshot.groups.filter((g) => g.key !== focus.key)];
  const grid = el('div', 'market-groups');
  for (const group of groups) {
    const card = el('section', `card market-group${group.key === focus.key ? ' focus' : ''}`);
    card.append(el('h3', 'group-title', group.label));
    if (group.blurb) card.append(el('p', 'group-blurb', group.blurb));
    const list = el('dl', 'metric-list');
    for (const key of group.metrics) {
      const metric = metricFor(key);
      if (!metric) continue;
      const value = market.values[key];
      const place = ranks(snapshot.markets, metric).get(city);
      const term = el('dt', '', metric.label);
      if (metric.note) term.title = metric.note;
      const detail = el('dd');
      detail.append(el('span', `value ${tone(value, metric)}`, formatValue(value, metric.unit)));
      const bits = [];
      if (place) bits.push(`${ordinal(place)} of ${snapshot.markets.filter((m) => m.values[key] != null).length}`);
      if (market.periods?.[key]) bits.push(market.periods[key]);
      if (bits.length) detail.append(el('span', 'metric-meta', bits.join(' · ')));
      list.append(term, detail);
    }
    card.append(list);
    grid.append(card);
  }
  frag.append(grid);
  return frag;
}

/** Green for a rise, red for a fall, on growth figures only. */
function tone(value, metric) {
  if (metric.unit !== 'change' || value == null) return '';
  const rounded = Math.round(value * 10) / 10;
  return rounded > 0 ? 'up' : rounded < 0 ? 'down' : '';
}

function asOf(metrics) {
  const periods = new Map();
  for (const metric of metrics) {
    const seen = snapshot.markets.map((m) => m.periods?.[metric.key]).filter(Boolean);
    if (!seen.length) continue;
    // The period most markets report; a stale fallback shows on hover in the cell.
    const common = mode(seen);
    const list = periods.get(metric.source) ?? new Set();
    list.add(common);
    periods.set(metric.source, list);
  }
  const parts = [...periods].map(([source, set]) => `${source}: ${[...set].join(', ')}`);
  return el('p', 'market-asof', parts.length ? `As of ${parts.join(' · ')}` : '');
}

function mode(values) {
  const counts = new Map();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  return [...counts].sort((a, b) => b[1] - a[1])[0][0];
}

function sources() {
  const box = el('div');
  const list = el('p', '', 'Sources: ');
  snapshot.sources.forEach((source, index) => {
    const a = el('a', '', source.name);
    a.href = source.url;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    a.title = source.detail;
    list.append(index ? ' · ' : '', a);
  });
  box.append(
    list,
    el(
      'p',
      '',
      'Office, industrial and retail vacancy and asking rents come from brokerage research that is licensed, so Terra shows the public figures that drive them instead: who is hiring in each property type, and how tight the rental market is.'
    )
  );
  return box;
}

function message(text, isError = false) {
  $('m-body').replaceChildren(el('div', isError ? 'state error' : 'state', text));
  $('m-blurb').textContent = '';
}

function el(tag, cls = '', text) {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text != null) node.textContent = text;
  return node;
}
