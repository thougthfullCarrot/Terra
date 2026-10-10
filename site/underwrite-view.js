// underwrite-view.js — the underwriting model on the Market data tab: a
// yearly cash flow, a sale, IRR and a sensitivity grid, with an Excel download
// that keeps its formulas. The math is in underwrite.js, the workbook in
// underwrite-xlsx.js.
import { formatValue } from './market.js';
import { suggestedRate } from './deal.js';
import { DEFAULT_UW, readUw, sensitivity, underwrite, UW_FIELDS, writeUw } from './underwrite.js';
import { underwriteXlsx, xlsxName } from './underwrite-xlsx.js';

const HASH_KEYS = new RegExp(`^(${[...UW_FIELDS.map((f) => f.key), 'taxcity'].join('|')})=`);

export function underwriteView(snapshot) {
  const taxFor = (city) => snapshot.markets.find((m) => m.city === city)?.values?.taxRate ?? null;
  const taxCities = snapshot.markets.filter((m) => m.values?.taxRate != null).map((m) => m.city);
  const defaults = { ...DEFAULT_UW, rate: suggestedRate(snapshot.rates) ?? DEFAULT_UW.rate, city: taxCities.includes('Dallas') ? 'Dallas' : (taxCities[0] ?? '') };
  const uw = readUw(location.hash, defaults, taxCities);

  const frag = document.createDocumentFragment();
  const card = el('section', 'card calc-card');
  card.setAttribute('aria-labelledby', 'uw-title');
  const title = el('h3', 'group-title', 'Underwriting model');
  title.id = 'uw-title';
  card.append(
    title,
    el('p', 'group-blurb', 'A yearly cash flow over the hold, a sale at the exit cap rate, and the returns an investment committee asks for. Download it to Excel with every formula live.')
  );

  const form = el('form', 'calc-form');
  form.addEventListener('submit', (e) => e.preventDefault());
  const inputs = {};
  for (const field of UW_FIELDS) {
    const label = el('label', 'calc-field');
    const input = el('input');
    input.type = 'number';
    input.inputMode = 'decimal';
    input.min = String(field.min);
    if (field.max != null) input.max = String(field.max);
    input.step = String(field.step);
    input.value = String(uw[field.key]);
    input.name = field.key;
    inputs[field.key] = input;
    const box = el('span', 'calc-input');
    if (field.unit === 'usd') box.append(el('span', 'calc-affix', '$'));
    box.append(input);
    if (field.unit !== 'usd') box.append(el('span', 'calc-affix', field.unit === 'pct' ? '%' : 'yrs'));
    label.append(el('span', 'eyebrow', field.label.toUpperCase()), box);
    form.append(label);
  }
  const taxLabel = el('label', 'calc-field');
  const taxSelect = el('select');
  taxSelect.name = 'taxcity';
  taxSelect.append(new Option('None (include it in expenses)', ''));
  for (const city of taxCities) taxSelect.append(new Option(`${city}: ${formatValue(taxFor(city), 'taxRate')}`, city));
  taxSelect.value = uw.city;
  taxLabel.append(el('span', 'eyebrow', 'PROPERTY TAX FROM CITY'), taxSelect);
  form.append(taxLabel);
  card.append(form);

  const actions = el('div', 'calc-fills');
  const download = el('button', 'chip uw-download', 'Download to Excel (.xlsx)');
  download.type = 'button';
  download.addEventListener('click', () => {
    const now = current();
    const bytes = underwriteXlsx(now, now.city ? taxFor(now.city) : null, now.city);
    const url = URL.createObjectURL(new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
    const a = el('a');
    a.href = url;
    a.download = xlsxName(now.city);
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  });
  actions.append(download, el('span', 'calc-note', 'Three sheets: assumptions, cash flow and sensitivity. Blue cells are inputs.'));
  card.append(actions);

  const results = el('div', 'calc-results');
  results.setAttribute('aria-live', 'polite');
  const grid = el('section', 'card uw-block');
  const flows = el('section', 'card uw-block');
  card.append(results);
  frag.append(card, grid, flows);

  function current() {
    const out = { city: taxSelect.value };
    for (const field of UW_FIELDS) {
      const value = Number(inputs[field.key].value);
      out[field.key] = Number.isFinite(value) ? value : 0;
    }
    return out;
  }

  function refresh() {
    const now = current();
    const base = location.hash.split('&').filter((part) => !HASH_KEYS.test(part));
    history.replaceState(null, '', `${location.pathname}${location.search}${base.join('&')}&${writeUw(now)}`);
    const tax = now.city ? taxFor(now.city) : null;
    const m = underwrite(now, tax);
    results.replaceChildren(...tiles(m));
    grid.replaceChildren(...sensitivityTable(sensitivity(now, tax)));
    flows.replaceChildren(...cashFlowTable(m));
  }

  form.addEventListener('input', refresh);
  form.addEventListener('change', refresh);
  refresh();
  return frag;
}

const money = (v) => (v == null || !Number.isFinite(v) ? '—' : `${v < 0 ? '−' : ''}$${Math.round(Math.abs(v)).toLocaleString('en-US')}`);
const pct = (v) => (v == null || !Number.isFinite(v) ? '—' : `${v < 0 ? '−' : ''}${Math.abs(v).toFixed(2)}%`);

function tiles(m) {
  const list = [
    ['Levered IRR', pct(m.leveredIrr), 'Yearly return on your equity, sale included.', m.leveredIrr == null ? '' : m.leveredIrr < 0 ? 'bad' : 'good'],
    ['Unlevered IRR', pct(m.unleveredIrr), 'The same, as if bought with all cash.', ''],
    ['Equity multiple', m.equityMultiple == null ? '—' : `${m.equityMultiple.toFixed(2)}x`, `Total cash back ÷ ${money(m.equity)} invested.`, m.equityMultiple != null && m.equityMultiple < 1 ? 'bad' : ''],
    ['Profit to equity', money(m.profit), `Over ${m.hold} years, after the loan payoff.`, m.profit < 0 ? 'bad' : ''],
    ['Going-in cap rate', pct(m.goingInCap), 'Year 1 NOI ÷ price.', ''],
    ['Sale price', money(m.salePrice), `Year ${m.hold + 1} NOI ÷ exit cap.`, ''],
    ['Debt service coverage', m.dscr == null ? '—' : `${m.dscr.toFixed(2)}x`, 'Year 1 NOI ÷ debt service. Lenders want 1.25x+.', m.dscr == null ? '' : m.dscr < 1 ? 'bad' : m.dscr < 1.25 ? 'warn' : 'good'],
    ['Debt yield', pct(m.debtYield), 'Year 1 NOI ÷ loan. Lenders often want 8–10%+.', m.debtYield != null && m.debtYield < 8 ? 'warn' : '']
  ];
  return list.map(([label, value, note, mood]) => {
    const tile = el('div', `rate-tile calc-tile${mood ? ` ${mood}` : ''}`);
    tile.append(el('span', 'rate-label', label), el('span', 'rate-value', value), el('span', 'calc-note', note));
    return tile;
  });
}

function sensitivityTable(s) {
  const wrap = el('div', 'table-wrap');
  const table = el('table', 'market-table uw-table');
  table.append(el('caption', 'visually-hidden', 'Levered IRR by rent growth and exit cap rate'));
  const head = el('tr');
  head.append(th('Rent growth ↓ / Exit cap →', 'city-col'));
  for (const cap of s.caps) head.append(th(pct(cap), 'num'));
  const thead = el('thead');
  thead.append(head);
  const body = el('tbody');
  s.grid.forEach((row, i) => {
    const tr = el('tr');
    const name = th(pct(s.growths[i]), 'city-col');
    name.scope = 'row';
    tr.append(name);
    row.forEach((v, j) => {
      const td = el('td', `num${i === 2 && j === 2 ? ' uw-base' : ''}${v != null && v < 0 ? ' uw-neg' : ''}`, pct(v));
      tr.append(td);
    });
    body.append(tr);
  });
  table.append(thead, body);
  wrap.append(table);
  return [el('h3', 'group-title', 'Sensitivity: levered IRR'), el('p', 'group-blurb', 'How the return moves if rents grow faster or slower, or the buyer at exit pays a higher or lower cap rate. The outlined cell is your base case.'), wrap];
}

function cashFlowTable(m) {
  const wrap = el('div', 'table-wrap');
  const table = el('table', 'market-table uw-table');
  table.append(el('caption', 'visually-hidden', 'Yearly cash flow'));
  const head = el('tr');
  head.append(th('Year', 'city-col'));
  for (let t = 1; t <= m.hold; t++) head.append(th(String(t), 'num'));
  const thead = el('thead');
  thead.append(head);
  const body = el('tbody');
  const held = m.years.slice(0, m.hold);
  const rows = [
    ['Gross rent', held.map((y) => y.gross)],
    ['Vacancy', held.map((y) => -y.vacancyLoss)],
    ['Expenses', held.map((y) => -y.expenses)],
    ['NOI', held.map((y) => y.noi), true],
    ['Debt service', held.map((y) => -y.debtService)],
    ['Cash flow', held.map((y) => y.cashFlow), true],
    ['Sale proceeds', held.map((_, i) => (i === m.hold - 1 ? m.saleProceeds : null))],
    ['To equity', m.levered.slice(1), true]
  ];
  for (const [label, values, bold] of rows) {
    const tr = el('tr', bold ? 'uw-total' : '');
    const name = th(label, 'city-col');
    name.scope = 'row';
    tr.append(name, ...values.map((v) => el('td', 'num', v == null ? '' : money(v))));
    body.append(tr);
  }
  table.append(thead, body);
  wrap.append(table);
  return [el('h3', 'group-title', 'Cash flow'), el('p', 'group-blurb', `Equity in at close: ${money(m.equity)}. Loan: ${money(m.loan)}, paid off from the sale.`), wrap];
}

function th(text, cls) {
  const cell = el('th', cls, text);
  cell.scope = 'col';
  return cell;
}

function el(tag, cls = '', text) {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text != null) node.textContent = text;
  return node;
}
