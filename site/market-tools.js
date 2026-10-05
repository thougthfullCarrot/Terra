// market-tools.js — the two tools on the Market data tab: cities side by side
// and the deal calculator. markets-view.js decides when each shows; the math
// lives in market.js and deal.js.
import { compareRows, formatValue, KEY_METRICS, MAX_COMPARE, writeMarketHash } from './market.js';
import { analyzeDeal, DEAL_FIELDS, DEFAULT_DEAL, DEFAULT_SPREAD, readDeal, suggestedRate, writeDeal } from './deal.js';

/**
 * Two to four cities side by side: the key figures first, then every figure
 * in the chosen topic. The best value in each row is marked where a metric
 * has a better end.
 */
export function compareView(snapshot, state, update) {
  const frag = document.createDocumentFragment();
  const metricFor = (key) => snapshot.metrics.find((m) => m.key === key);
  const cities = state.compare;

  const pick = el('section', 'card compare-pick');
  pick.append(
    el('h3', 'group-title', 'Cities to compare'),
    el('p', 'group-blurb', `Pick two to ${MAX_COMPARE}. The best figure in each row is marked; growth figures are green or red.`)
  );
  const chips = el('div', 'metric-pills');
  chips.setAttribute('role', 'group');
  chips.setAttribute('aria-label', 'Cities to compare');
  for (const market of snapshot.markets) {
    const on = cities.includes(market.city);
    const chip = el('button', 'chip', market.city);
    chip.type = 'button';
    chip.setAttribute('aria-pressed', String(on));
    // Two is the floor and four the ceiling; the chips that would cross either are greyed out.
    chip.disabled = on ? cities.length <= 2 : cities.length >= MAX_COMPARE;
    chip.addEventListener('click', () =>
      update({ compare: on ? cities.filter((c) => c !== market.city) : [...cities, market.city] })
    );
    chips.append(chip);
  }
  pick.append(chips);
  frag.append(pick);

  const key = KEY_METRICS.map(metricFor).filter(Boolean);
  if (key.length) frag.append(compareTable(snapshot, cities, 'Key figures', 'Jobs, people, rents, new building permits and property taxes.', key, state));

  const group = snapshot.groups.find((g) => g.key === state.focus) ?? snapshot.groups[0];
  const metrics = group.metrics.map(metricFor).filter(Boolean);
  if (metrics.length) frag.append(compareTable(snapshot, cities, group.label, group.blurb ?? '', metrics, state));
  frag.append(el('p', 'market-asof', 'Change the topic above to compare another set of figures. Hover a figure for its period.'));
  return frag;
}

function compareTable(snapshot, cities, title, blurb, metrics, state) {
  const box = el('section', 'compare-block');
  box.append(el('h3', 'group-title', title));
  if (blurb) box.append(el('p', 'group-blurb', blurb));

  const wrap = el('div', 'table-wrap');
  const table = el('table', 'market-table compare-table');
  table.append(el('caption', 'visually-hidden', `${title}: ${cities.join(', ')}`));
  const head = el('tr');
  const corner = el('th', 'city-col', 'Figure');
  corner.scope = 'col';
  head.append(corner);
  for (const city of cities) {
    const th = el('th', 'num');
    th.scope = 'col';
    const link = el('a', 'city-link', city);
    link.href = writeMarketHash({ ...state, tool: '', city });
    th.append(link);
    head.append(th);
  }
  const thead = el('thead');
  thead.append(head);

  const body = el('tbody');
  for (const row of compareRows(snapshot.markets, metrics, cities)) {
    const tr = el('tr');
    const name = el('th', 'city-col', row.metric.label);
    name.scope = 'row';
    if (row.metric.note) name.title = row.metric.note;
    tr.append(name);
    cities.forEach((city, i) => {
      const value = row.values[i];
      const best = row.best.includes(city);
      const td = el('td', `num${best ? ' best' : ''}`);
      const text = el('span', `value ${tone(value, row.metric)}`, formatValue(value, row.metric.unit));
      const period = snapshot.markets.find((m) => m.city === city)?.periods?.[row.metric.key];
      if (period) text.title = period;
      td.append(text);
      if (best) td.append(el('span', 'best-tag', 'Best'));
      tr.append(td);
    });
    body.append(tr);
  }
  table.append(thead, body);
  wrap.append(table);
  box.append(wrap);
  return box;
}

/**
 * The deal calculator: cap rate, loan payment, cash flow and cash-on-cash
 * for a property, with the interest rate started from today's 10-year
 * Treasury and property tax from a city's combined rate. The inputs ride in
 * the hash so a deal can be shared as a link; typing redraws only the results.
 */
export function calculatorView(snapshot) {
  const taxFor = (city) => snapshot.markets.find((m) => m.city === city)?.values?.taxRate ?? null;
  const taxCities = snapshot.markets.filter((m) => m.values?.taxRate != null).map((m) => m.city);
  const start = suggestedRate(snapshot.rates);
  const defaults = { ...DEFAULT_DEAL, rate: start ?? DEFAULT_DEAL.rate, city: taxCities.includes('Dallas') ? 'Dallas' : (taxCities[0] ?? '') };
  const deal = readDeal(location.hash, defaults, taxCities);

  const frag = document.createDocumentFragment();
  const card = el('section', 'card calc-card');
  card.setAttribute('aria-labelledby', 'calc-title');
  const title = el('h3', 'group-title', 'Deal calculator');
  title.id = 'calc-title';
  card.append(
    title,
    el('p', 'group-blurb', 'Enter a property and a loan to see its cap rate, payment, cash flow and cash-on-cash return. A first pass for learning and screening, not an underwriting model.')
  );

  const form = el('form', 'calc-form');
  form.addEventListener('submit', (e) => e.preventDefault());
  const inputs = {};
  for (const field of DEAL_FIELDS) {
    const label = el('label', 'calc-field');
    const input = el('input');
    input.type = 'number';
    input.inputMode = 'decimal';
    input.min = String(field.min);
    if (field.max != null) input.max = String(field.max);
    input.step = String(field.step);
    input.value = String(deal[field.key]);
    input.name = field.key;
    inputs[field.key] = input;
    const suffix = field.unit === 'pct' ? '%' : field.unit === 'years' ? 'yrs' : '';
    const prefix = field.unit === 'usd' ? '$' : '';
    const box = el('span', 'calc-input');
    if (prefix) box.append(el('span', 'calc-affix', prefix));
    box.append(input);
    if (suffix) box.append(el('span', 'calc-affix', suffix));
    label.append(el('span', 'eyebrow', field.label.toUpperCase()), box);
    form.append(label);
  }

  const taxLabel = el('label', 'calc-field');
  const taxSelect = el('select');
  taxSelect.name = 'taxcity';
  taxSelect.append(new Option('None (include it in expenses)', ''));
  for (const city of taxCities) taxSelect.append(new Option(`${city}: ${formatValue(taxFor(city), 'taxRate')}`, city));
  taxSelect.value = deal.city;
  taxLabel.append(el('span', 'eyebrow', 'PROPERTY TAX FROM CITY'), taxSelect);
  form.append(taxLabel);
  card.append(form);

  // Quick fills for the interest rate from the live rates on this tab.
  const fills = rateFills(snapshot.rates);
  if (fills.length) {
    const row = el('div', 'calc-fills');
    row.append(el('span', 'eyebrow', 'USE A LIVE RATE'));
    for (const fill of fills) {
      const chip = el('button', 'chip', `${fill.label}: ${fill.value.toFixed(2)}%`);
      chip.type = 'button';
      chip.title = fill.note;
      chip.addEventListener('click', () => {
        inputs.rate.value = String(fill.value);
        refresh();
      });
      row.append(chip);
    }
    card.append(row);
  }

  const results = el('div', 'calc-results');
  results.setAttribute('aria-live', 'polite');
  card.append(results);
  frag.append(card, glossary());

  function current() {
    const out = { city: taxSelect.value };
    for (const field of DEAL_FIELDS) {
      const value = Number(inputs[field.key].value);
      out[field.key] = Number.isFinite(value) ? value : 0;
    }
    return out;
  }

  function refresh() {
    const now = current();
    const base = location.hash.split('&').filter((part) => !/^(price|income|vacancy|expenses|down|closing|rate|years|taxcity)=/.test(part));
    history.replaceState(null, '', `${location.pathname}${location.search}${base.join('&')}&${writeDeal(now)}`);
    results.replaceChildren(...resultTiles(analyzeDeal(now, now.city ? taxFor(now.city) : null), now));
  }

  form.addEventListener('input', refresh);
  form.addEventListener('change', refresh);
  refresh();
  return frag;
}

function rateFills(rates) {
  const find = (key) => (rates ?? []).find((r) => r.key === key && Number.isFinite(r.value));
  const out = [];
  const treasury = find('DGS10');
  if (treasury)
    out.push({
      label: `10-yr Treasury + ${DEFAULT_SPREAD.toFixed(2)}`,
      value: suggestedRate(rates),
      note: `The 10-year Treasury (${treasury.value.toFixed(2)}%, ${treasury.period}) plus a typical ${DEFAULT_SPREAD}-point lender spread for a stabilized property loan.`
    });
  const prime = find('DPRIME');
  if (prime) out.push({ label: 'Prime + 1.00', value: Math.round((prime.value + 1) * 100) / 100, note: `Bank prime (${prime.value.toFixed(2)}%, ${prime.period}) plus a point, like many local bank loans.` });
  const mortgage = find('MORTGAGE30US');
  if (mortgage) out.push({ label: '30-yr home mortgage', value: mortgage.value, note: `Freddie Mac's average 30-year fixed rate, ${mortgage.period}. For one-to-four unit rentals.` });
  return out;
}

function resultTiles(r, deal) {
  const money = (v) => (v == null || !Number.isFinite(v) ? '—' : `${v < 0 ? '−' : ''}$${Math.round(Math.abs(v)).toLocaleString('en-US')}`);
  const pct = (v) => (v == null || !Number.isFinite(v) ? '—' : `${v < 0 ? '−' : ''}${Math.abs(v).toFixed(2)}%`);
  const tiles = [
    ['Cap rate', pct(r.capRate), 'Net operating income ÷ price.', r.capRate != null && r.capRate < deal.rate ? 'warn' : ''],
    ['Net operating income', money(r.noi), `Rent after vacancy, less ${money(r.expenses)} of expenses${r.propertyTax ? ` (${money(r.propertyTax)} of it property tax)` : ''}.`, r.noi < 0 ? 'bad' : ''],
    ['Monthly loan payment', money(r.payment), `On a ${money(r.loan)} loan over ${deal.years} years at ${deal.rate}%.`, ''],
    ['Cash flow a year', money(r.cashFlow), `NOI less ${money(r.debtService)} of debt service, before income tax.`, r.cashFlow < 0 ? 'bad' : 'good'],
    ['Cash-on-cash return', pct(r.cashOnCash), `Cash flow ÷ ${money(r.cashInvested)} of down payment and closing costs.`, r.cashOnCash != null && r.cashOnCash < 0 ? 'bad' : ''],
    [
      'Debt service coverage',
      r.dscr == null ? '—' : `${r.dscr.toFixed(2)}x`,
      'NOI ÷ debt service. Most lenders want 1.25x or more.',
      r.dscr == null ? '' : r.dscr < 1 ? 'bad' : r.dscr < 1.25 ? 'warn' : 'good'
    ],
    ['Break-even occupancy', pct(r.breakEven), 'How full the property must be to pay expenses and the loan.', r.breakEven != null && r.breakEven > 100 ? 'bad' : '']
  ];
  const nodes = tiles.map(([label, value, note, mood]) => {
    const tile = el('div', `rate-tile calc-tile${mood ? ` ${mood}` : ''}`);
    tile.append(el('span', 'rate-label', label), el('span', 'rate-value', value), el('span', 'calc-note', note));
    return tile;
  });
  if (r.capRate != null && r.capRate < deal.rate && r.loan > 0)
    nodes.push(el('p', 'calc-warning', `The cap rate is below the loan rate, so borrowing lowers the return (negative leverage). Each dollar borrowed costs ${deal.rate}% and the property earns ${r.capRate.toFixed(2)}%.`));
  return nodes;
}

function glossary() {
  const box = el('details', 'card calc-glossary');
  box.append(el('summary', 'group-title', 'What the terms mean'));
  const list = el('dl', 'metric-list calc-terms');
  for (const [term, text] of [
    ['NOI', 'Net operating income: rent collected less operating costs (taxes, insurance, repairs, management), before the loan.'],
    ['Cap rate', 'NOI ÷ price. The return if you paid all cash. Lower cap rates mean pricier, usually safer property.'],
    ['Cash-on-cash', 'Yearly cash flow after the loan ÷ the cash you put in. What your own money earns.'],
    ['DSCR', 'Debt service coverage ratio: NOI ÷ yearly loan payments. Lenders size loans so this stays above about 1.25.'],
    ['Amortization', 'The years over which the loan is paid off. Longer means smaller payments and more interest.'],
    ['Spread', 'What a lender charges above a benchmark like the 10-year Treasury, set by the property and the borrower.']
  ])
    list.append(el('dt', '', term), el('dd', 'calc-def', text));
  box.append(list);
  return box;
}

/** Green for a change for the better, red for the worse, on growth figures only (as on the city table). */
function tone(value, metric) {
  if (metric.unit !== 'change' || value == null) return '';
  const rounded = Math.round(value * 10) / 10;
  if (!rounded) return '';
  const good = metric.better === 'low' ? rounded < 0 : rounded > 0;
  return good ? 'up' : 'down';
}

function el(tag, cls = '', text) {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text != null) node.textContent = text;
  return node;
}
