// underwrite-xlsx.js — the underwriting model as an Excel workbook with live formulas.
//
// Three sheets: Assumptions (blue cells are inputs), Cash Flow (the yearly
// model, sale and returns) and Sensitivity (levered IRR by rent growth and exit
// cap, worked out row by row underneath so it recalculates too). Change a blue
// cell and every figure follows. Only the hold period is fixed, since it sets
// how many year columns there are; change it on Terra and export again.
import { buildXlsx, col } from './xlsx-writer.js';
import { EXIT_CAP_STEPS, GROWTH_STEPS, sensitivity, underwrite } from './underwrite.js';

const A = 'Assumptions!';
// Assumption cells, by name.
const IN = {
  price: '$B$5',
  income: '$B$6',
  vacancy: '$B$7',
  expenses: '$B$8',
  tax: '$B$9',
  growth: '$B$10',
  expgrowth: '$B$11',
  hold: '$B$12',
  exitcap: '$B$13',
  sellcost: '$B$14',
  down: '$B$15',
  closing: '$B$16',
  rate: '$B$17',
  years: '$B$18',
  loan: '$B$21',
  closingCost: '$B$22',
  equity: '$B$23',
  payment: '$B$24',
  debtService: '$B$25',
  taxAmount: '$B$26'
};
const ref = (key) => `${A}${IN[key]}`;

/** The workbook bytes for one set of inputs. taxRate is the combined tax rate in percent, city its name (may be empty). */
export function underwriteXlsx(uw, taxRate = null, city = '', asOf = new Date()) {
  const m = underwrite(uw, taxRate);
  const sens = sensitivity(uw, taxRate);
  return buildXlsx([assumptions(uw, m, taxRate, city, asOf), cashFlow(m), sensitivitySheet(uw, m, sens, taxRate)]);
}

/** A file name for the download, like terra-underwriting-dallas-2026-10-10.xlsx. */
export function xlsxName(city, asOf = new Date()) {
  const slug = String(city || 'model').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return `terra-underwriting-${slug}-${asOf.toISOString().slice(0, 10)}.xlsx`;
}

function assumptions(uw, m, taxRate, city, asOf) {
  const pct = (v) => ({ v: v / 100, s: 'inPct' });
  const rows = [];
  rows[0] = [{ v: 'Terra underwriting model', s: 'title' }];
  rows[1] = [{ v: `Exported ${asOf.toISOString().slice(0, 10)} from thougthfullcarrot.github.io/Terra. Blue cells are inputs: change them and every sheet recalculates.`, s: 'note' }];
  rows[3] = [{ v: 'Inputs', s: 'header' }, { v: '', s: 'header' }, { v: '', s: 'header' }];
  rows[4] = ['Purchase price', { v: uw.price, s: 'inMoney' }];
  rows[5] = ['Gross rent, year 1', { v: uw.income, s: 'inMoney' }];
  rows[6] = ['Vacancy and credit loss', pct(uw.vacancy)];
  rows[7] = ['Operating expenses, year 1 (before property tax)', { v: uw.expenses, s: 'inMoney' }];
  rows[8] = ['Property tax rate (on purchase price)', pct(taxRate ?? 0), { v: city ? `${city} combined rate, Texas Comptroller` : 'None: include it in expenses', s: 'note' }];
  rows[9] = ['Rent growth a year', pct(uw.growth)];
  rows[10] = ['Expense growth a year', pct(uw.expgrowth)];
  rows[11] = ['Hold period (years)', { v: m.hold, s: 'number' }, { v: 'Fixed in this file: it sets the year columns. Change it on Terra and export again.', s: 'note' }];
  rows[12] = ['Exit cap rate', pct(uw.exitcap)];
  rows[13] = ['Selling costs', pct(uw.sellcost)];
  rows[14] = ['Down payment', pct(uw.down)];
  rows[15] = ['Closing costs', pct(uw.closing)];
  rows[16] = ['Loan interest rate', pct(uw.rate)];
  rows[17] = ['Amortization (years)', { v: uw.years, s: 'inNumber' }];
  rows[19] = [{ v: 'Loan and equity', s: 'header' }, { v: '', s: 'header' }, { v: '', s: 'header' }];
  rows[20] = ['Loan amount', { v: m.loan, f: `${IN.price}*(1-${IN.down})`, s: 'money' }];
  rows[21] = ['Closing costs', { v: m.closingCosts, f: `${IN.price}*${IN.closing}`, s: 'money' }];
  rows[22] = ['Equity invested (down payment + closing)', { v: m.equity, f: `${IN.price}*${IN.down}+${IN.closingCost}`, s: 'boldMoney' }];
  rows[23] = ['Monthly loan payment', { v: m.payment, f: `IF(${IN.loan}>0,PMT(${IN.rate}/12,${IN.years}*12,-${IN.loan}),0)`, s: 'money' }];
  rows[24] = ['Annual debt service', { v: m.debtService, f: `${IN.payment}*12`, s: 'money' }];
  rows[25] = ['Property tax, year 1', { v: m.propertyTax, f: `${IN.price}*${IN.tax}`, s: 'money' }];
  rows[27] = [{ v: 'A screening model for learning and first passes, not investment advice. Texas does not disclose sale prices, so check comps yourself.', s: 'note' }];
  return { name: 'Assumptions', widths: [48, 16, 60], rows };
}

// Cash Flow rows (1-based) the other sheets point at.
const R = { year: 4, gross: 5, vacancy: 6, egi: 7, opex: 8, noi: 9, ds: 10, cf: 11, balance: 12, sale: 15, sellcost: 16, payoff: 17, proceeds: 18, levered: 21, unlevered: 22 };

function cashFlow(m) {
  const hold = m.hold;
  const c = (t) => col(1 + t); // year t lives in column B + t
  const last = c(hold);
  const rows = [];
  const label = (r, text, s = 'text') => {
    rows[r - 1] = rows[r - 1] ?? [];
    rows[r - 1][0] = { v: text, s };
  };
  const put = (r, t, cell) => {
    rows[r - 1] = rows[r - 1] ?? [];
    rows[r - 1][1 + t] = cell;
  };

  rows[0] = [{ v: 'Cash flow', s: 'title' }];
  rows[1] = [{ v: `Year ${hold + 1} is shown only for the forward NOI the sale is priced on.`, s: 'note' }];
  label(R.year, 'Year', 'header');
  for (let t = 0; t <= hold + 1; t++) put(R.year, t, { v: t === 0 ? 'Close' : t, s: 'header' });
  label(R.gross, 'Gross rent');
  label(R.vacancy, 'Vacancy and credit loss');
  label(R.egi, 'Effective gross income', 'bold');
  label(R.opex, 'Operating expenses incl. property tax');
  label(R.noi, 'Net operating income', 'bold');
  label(R.ds, 'Debt service');
  label(R.cf, 'Cash flow after debt service', 'bold');
  label(R.balance, 'Loan balance, end of year');
  m.years.forEach((y, i) => {
    const t = i + 1;
    const x = c(t);
    put(R.gross, t, { v: y.gross, f: `${ref('income')}*(1+${ref('growth')})^(${x}$${R.year}-1)`, s: 'money' });
    put(R.vacancy, t, { v: -y.vacancyLoss, f: `-${x}${R.gross}*${ref('vacancy')}`, s: 'money' });
    put(R.egi, t, { v: y.gross - y.vacancyLoss, f: `${x}${R.gross}+${x}${R.vacancy}`, s: 'boldMoney' });
    put(R.opex, t, { v: -y.expenses, f: `-(${ref('expenses')}+${ref('taxAmount')})*(1+${ref('expgrowth')})^(${x}$${R.year}-1)`, s: 'money' });
    put(R.noi, t, { v: y.noi, f: `${x}${R.egi}+${x}${R.opex}`, s: 'boldMoney' });
    if (t > hold) return;
    put(R.ds, t, { v: -y.debtService, f: `-${ref('debtService')}`, s: 'money' });
    put(R.cf, t, { v: y.cashFlow, f: `${x}${R.noi}+${x}${R.ds}`, s: 'boldMoney' });
    put(R.balance, t, { v: y.balance, f: `IF(${ref('loan')}>0,MAX(0,FV(${ref('rate')}/12,MIN(${x}$${R.year},${ref('years')})*12,${ref('payment')},-${ref('loan')})),0)`, s: 'money' });
  });

  label(R.sale - 1, `Sale at the end of year ${hold}`, 'header');
  put(R.sale - 1, 0, { v: '', s: 'header' });
  label(R.sale, `Sale price (year ${hold + 1} NOI ÷ exit cap)`);
  put(R.sale, hold, { v: m.salePrice, f: `${c(hold + 1)}${R.noi}/${ref('exitcap')}`, s: 'money' });
  label(R.sellcost, 'Selling costs');
  put(R.sellcost, hold, { v: -m.sellingCosts, f: `-${last}${R.sale}*${ref('sellcost')}`, s: 'money' });
  label(R.payoff, 'Loan payoff');
  put(R.payoff, hold, { v: -m.loanPayoff, f: `-${last}${R.balance}`, s: 'money' });
  label(R.proceeds, 'Net sale proceeds to equity', 'bold');
  put(R.proceeds, hold, { v: m.saleProceeds, f: `SUM(${last}${R.sale}:${last}${R.payoff})`, s: 'boldMoney' });

  label(R.levered - 1, 'Cash flows for returns', 'header');
  put(R.levered - 1, 0, { v: '', s: 'header' });
  label(R.levered, 'Levered (to equity)', 'bold');
  label(R.unlevered, 'Unlevered (all cash)', 'bold');
  put(R.levered, 0, { v: m.levered[0], f: `-${ref('equity')}`, s: 'boldMoney' });
  put(R.unlevered, 0, { v: m.unlevered[0], f: `-(${ref('price')}+${ref('closingCost')})`, s: 'boldMoney' });
  for (let t = 1; t <= hold; t++) {
    const x = c(t);
    const atSale = t === hold;
    put(R.levered, t, { v: m.levered[t], f: `${x}${R.cf}${atSale ? `+${x}${R.proceeds}` : ''}`, s: 'money' });
    put(R.unlevered, t, { v: m.unlevered[t], f: `${x}${R.noi}${atSale ? `+${x}${R.sale}+${x}${R.sellcost}` : ''}`, s: 'money' });
  }

  const lev = `B${R.levered}:${last}${R.levered}`;
  const out = [
    ['Levered IRR', m.leveredIrr, `IRR(${lev})`, 'boldPct', 100],
    ['Unlevered IRR', m.unleveredIrr, `IRR(B${R.unlevered}:${last}${R.unlevered})`, 'boldPct', 100],
    ['Equity multiple', m.equityMultiple, `SUM(C${R.levered}:${last}${R.levered})/-B${R.levered}`, 'boldMultiple', 1],
    ['Profit to equity', m.profit, `SUM(${lev})`, 'boldMoney', 1],
    ['Going-in cap rate', m.goingInCap, `C${R.noi}/${ref('price')}`, 'pct', 100],
    ['Average cash-on-cash', m.avgCashOnCash, `AVERAGE(C${R.cf}:${last}${R.cf})/${ref('equity')}`, 'pct', 100],
    ['Debt service coverage, year 1', m.dscr, `IF(C${R.ds}<0,C${R.noi}/-C${R.ds},"")`, 'multiple', 1],
    ['Debt yield, year 1', m.debtYield, `IF(${ref('loan')}>0,C${R.noi}/${ref('loan')},"")`, 'pct', 100]
  ];
  const top = R.unlevered + 2;
  label(top, 'Returns', 'header');
  put(top, 0, { v: '', s: 'header' });
  out.forEach(([name, value, f, s, scale], i) => {
    label(top + 1 + i, name);
    put(top + 1 + i, 0, { v: value == null ? undefined : value / scale, f, s });
  });

  return { name: 'Cash Flow', widths: [40, ...Array(hold + 2).fill(14)], rows, freeze: [1, R.year] };
}

function sensitivitySheet(uw, m, sens, taxRate) {
  const hold = m.hold;
  const rows = [];
  rows[0] = [{ v: 'Sensitivity: levered IRR', s: 'title' }];
  rows[1] = [{ v: 'Rent growth down the side, exit cap across the top. Each cell is worked out in the rows below, so it recalculates with the Assumptions sheet.', s: 'note' }];
  const head = 4; // row of exit caps
  rows[head - 1] = [{ v: 'Rent growth ↓  Exit cap →', s: 'header' }];
  EXIT_CAP_STEPS.forEach((d, j) => {
    rows[head - 1][1 + j] = { v: sens.caps[j] / 100, f: `MAX(0.005,${ref('exitcap')}${sign(d / 100)})`, s: 'header' };
  });

  // The working: one row per scenario, cash flows from close to the sale year.
  const work = head + GROWTH_STEPS.length + 4;
  rows[work - 2] = [{ v: 'Scenario cash flows to equity (the grid’s working)', s: 'header' }, { v: 'Rent growth', s: 'header' }, { v: 'Exit cap', s: 'header' }];
  for (let t = 0; t <= hold; t++) rows[work - 2][3 + t] = { v: t === 0 ? 'Close' : `Year ${t}`, s: 'header' };
  const g = (r) => `$B${r}`;
  const cap = (r) => `$C${r}`;
  const noi = (r, t) =>
    `(${ref('income')}*(1+${g(r)})^${t - 1}*(1-${ref('vacancy')})-(${ref('expenses')}+${ref('taxAmount')})*(1+${ref('expgrowth')})^${t - 1})`;

  GROWTH_STEPS.forEach((dg, i) => {
    const gridRow = head + 1 + i;
    rows[gridRow - 1] = [{ v: sens.growths[i] / 100, f: `${ref('growth')}${sign(dg / 100)}`, s: 'header' }];
    EXIT_CAP_STEPS.forEach((dc, j) => {
      const r = work + i * EXIT_CAP_STEPS.length + j;
      const scenario = underwrite({ ...uw, growth: sens.growths[i], exitcap: sens.caps[j] }, taxRate);
      const row = [
        { v: `Growth ${fmtPct(sens.growths[i])}, exit cap ${fmtPct(sens.caps[j])}`, s: 'text' },
        { v: sens.growths[i] / 100, f: `$A$${gridRow}`, s: 'pct' },
        { v: sens.caps[j] / 100, f: `${col(1 + j)}$${head}`, s: 'pct' },
        { v: scenario.levered[0], f: `-${ref('equity')}`, s: 'money' }
      ];
      for (let t = 1; t <= hold; t++) {
        const sale = t === hold ? `+${noi(r, hold + 1)}/${cap(r)}*(1-${ref('sellcost')})-'Cash Flow'!${col(1 + hold)}${R.balance}` : '';
        row.push({ v: scenario.levered[t], f: `${noi(r, t)}-${ref('debtService')}${sale}`, s: 'money' });
      }
      rows[r - 1] = row;
      const irr = sens.grid[i][j];
      rows[gridRow - 1][1 + j] = { v: irr == null ? undefined : irr / 100, f: `IFERROR(IRR(D${r}:${col(3 + hold)}${r}),"")`, s: i === 2 && j === 2 ? 'boldPct' : 'pct' };
    });
  });
  rows[head + GROWTH_STEPS.length] = [{ v: 'The bold cell is the base case from the Assumptions sheet.', s: 'note' }];

  return { name: 'Sensitivity', widths: [34, 14, 14, ...Array(hold + 1).fill(14)], rows };
}

function sign(n) {
  return n < 0 ? `-${Math.abs(n)}` : `+${n}`;
}

function fmtPct(n) {
  return `${Number(n.toFixed(2))}%`;
}
