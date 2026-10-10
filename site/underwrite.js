// underwrite.js — the underwriting model's math, as plain functions with no DOM.
//
// A yearly cash flow over a hold period, a sale at an exit cap rate, levered
// and unlevered IRR, and a sensitivity grid. Kept apart from the drawing code
// (underwrite-view.js) so the backend's tests cover it. Rates are percents
// (6.5 means 6.5%), money is dollars a year.
import { monthlyPayment } from './deal.js';

/** The model's inputs and the URL hash key each one is saved under. Keys shared with the deal calculator carry over between the two. */
export const UW_FIELDS = [
  { key: 'price', label: 'Purchase price', unit: 'usd', min: 0, step: 10000 },
  { key: 'income', label: 'Gross rent, year 1', unit: 'usd', min: 0, step: 1000 },
  { key: 'vacancy', label: 'Vacancy and credit loss', unit: 'pct', min: 0, max: 100, step: 0.5 },
  { key: 'expenses', label: 'Operating expenses, year 1 (before property tax)', unit: 'usd', min: 0, step: 1000 },
  { key: 'growth', label: 'Rent growth a year', unit: 'pct', min: -20, max: 30, step: 0.25 },
  { key: 'expgrowth', label: 'Expense growth a year', unit: 'pct', min: -20, max: 30, step: 0.25 },
  { key: 'hold', label: 'Hold period', unit: 'years', min: 1, max: 15, step: 1 },
  { key: 'exitcap', label: 'Exit cap rate', unit: 'pct', min: 0.5, max: 25, step: 0.05 },
  { key: 'sellcost', label: 'Selling costs', unit: 'pct', min: 0, max: 20, step: 0.25 },
  { key: 'down', label: 'Down payment', unit: 'pct', min: 0, max: 100, step: 1 },
  { key: 'closing', label: 'Closing costs', unit: 'pct', min: 0, max: 100, step: 0.25 },
  { key: 'rate', label: 'Loan interest rate', unit: 'pct', min: 0, max: 30, step: 0.05 },
  { key: 'years', label: 'Amortization (years)', unit: 'years', min: 1, max: 40, step: 1 }
];

export const DEFAULT_UW = {
  price: 1500000,
  income: 180000,
  vacancy: 5,
  expenses: 45000,
  growth: 3,
  expgrowth: 3,
  hold: 10,
  exitcap: 7,
  sellcost: 2,
  down: 30,
  closing: 2,
  rate: 6.5,
  years: 25,
  city: ''
};

/** How far each sensitivity axis steps from the base case, in points. */
export const EXIT_CAP_STEPS = [-0.5, -0.25, 0, 0.25, 0.5];
export const GROWTH_STEPS = [-2, -1, 0, 1, 2];

/**
 * The full model for one set of inputs. taxRate is the combined property tax
 * rate in percent, applied to the purchase price and grown with expenses.
 * years[] holds hold+1 rows: the last is only the forward NOI the sale is priced on.
 */
export function underwrite(uw, taxRate = null) {
  const price = Math.max(0, num(uw.price));
  const hold = Math.round(clamp(num(uw.hold), 1, 15));
  const vacancy = clamp(num(uw.vacancy), 0, 100) / 100;
  const growth = num(uw.growth) / 100;
  const expGrowth = num(uw.expgrowth) / 100;
  const propertyTax = taxRate != null && Number.isFinite(taxRate) ? (price * taxRate) / 100 : 0;
  const baseExpenses = Math.max(0, num(uw.expenses)) + propertyTax;

  const downPayment = (price * clamp(num(uw.down), 0, 100)) / 100;
  const loan = price - downPayment;
  const closingCosts = (price * Math.max(0, num(uw.closing))) / 100;
  const equity = downPayment + closingCosts;
  const payment = monthlyPayment(loan, num(uw.rate), num(uw.years));
  const debtService = payment * 12;

  const years = [];
  for (let t = 1; t <= hold + 1; t++) {
    const gross = Math.max(0, num(uw.income)) * (1 + growth) ** (t - 1);
    const vacancyLoss = gross * vacancy;
    const expenses = baseExpenses * (1 + expGrowth) ** (t - 1);
    const noi = gross - vacancyLoss - expenses;
    const balance = loanBalance(loan, num(uw.rate), num(uw.years), t);
    years.push({ year: t, gross, vacancyLoss, expenses, noi, debtService, cashFlow: noi - debtService, balance });
  }

  const exitCap = Math.max(0.01, num(uw.exitcap));
  const salePrice = (years[hold].noi / exitCap) * 100;
  const sellingCosts = (salePrice * Math.max(0, num(uw.sellcost))) / 100;
  const loanPayoff = years[hold - 1].balance;
  const saleProceeds = salePrice - sellingCosts - loanPayoff;

  const levered = [-equity, ...years.slice(0, hold).map((y) => y.cashFlow)];
  levered[hold] += saleProceeds;
  const unlevered = [-(price + closingCosts), ...years.slice(0, hold).map((y) => y.noi)];
  unlevered[hold] += salePrice - sellingCosts;

  const distributions = levered.slice(1).reduce((a, b) => a + b, 0);
  const first = years[0];
  return {
    hold,
    propertyTax,
    loan,
    equity,
    closingCosts,
    payment,
    debtService,
    years,
    salePrice,
    sellingCosts,
    loanPayoff,
    saleProceeds,
    levered,
    unlevered,
    leveredIrr: irr(levered),
    unleveredIrr: irr(unlevered),
    equityMultiple: equity > 0 ? distributions / equity : null,
    profit: distributions - equity,
    goingInCap: price > 0 ? (first.noi / price) * 100 : null,
    avgCashOnCash: equity > 0 ? (years.slice(0, hold).reduce((a, y) => a + y.cashFlow, 0) / hold / equity) * 100 : null,
    dscr: debtService > 0 ? first.noi / debtService : null,
    debtYield: loan > 0 ? (first.noi / loan) * 100 : null
  };
}

/** Levered IRR for each rent growth (rows) and exit cap (columns) around the base case. */
export function sensitivity(uw, taxRate = null) {
  const growths = GROWTH_STEPS.map((d) => round2(num(uw.growth) + d));
  const caps = EXIT_CAP_STEPS.map((d) => round2(Math.max(0.5, num(uw.exitcap) + d)));
  const grid = growths.map((growth) => caps.map((exitcap) => underwrite({ ...uw, growth, exitcap }, taxRate).leveredIrr));
  return { growths, caps, grid };
}

/** Balance left on a level-payment loan after `year` full years. */
export function loanBalance(principal, annualRate, years, year) {
  if (!(principal > 0)) return 0;
  const months = Math.round(num(years) * 12);
  const paid = Math.min(months, Math.round(year * 12));
  const payment = monthlyPayment(principal, annualRate, years);
  const r = num(annualRate) / 100 / 12;
  if (!(r > 0)) return Math.max(0, principal - payment * paid);
  return Math.max(0, principal * (1 + r) ** paid - (payment * ((1 + r) ** paid - 1)) / r);
}

/**
 * Internal rate of return in percent for yearly cash flows starting at year 0,
 * by bisection so it never diverges. null when the flows never change sign or
 * the rate falls outside −99%…1000%.
 */
export function irr(flows) {
  if (!flows.some((f) => f < 0) || !flows.some((f) => f > 0)) return null;
  const npv = (rate) => flows.reduce((sum, f, t) => sum + f / (1 + rate) ** t, 0);
  let lo = -0.99;
  let hi = 10;
  let fLo = npv(lo);
  if (fLo * npv(hi) > 0) return null;
  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2;
    const fMid = npv(mid);
    if (Math.abs(fMid) < 1e-7) return mid * 100;
    if (fLo * fMid < 0) hi = mid;
    else {
      lo = mid;
      fLo = fMid;
    }
  }
  return ((lo + hi) / 2) * 100;
}

/** The inputs saved in the hash, over the defaults; anything unreadable keeps its default. */
export function readUw(hash, defaults = DEFAULT_UW, cities = []) {
  const params = new URLSearchParams(String(hash ?? '').replace(/^#/, ''));
  const uw = { ...defaults };
  for (const field of UW_FIELDS) {
    const raw = params.get(field.key);
    if (raw == null || raw === '') continue;
    const value = Number(raw);
    if (!Number.isFinite(value)) continue;
    uw[field.key] = clamp(value, field.min, field.max ?? Infinity);
  }
  const city = params.get('taxcity');
  if (city != null && (city === '' || cities.includes(city))) uw.city = city;
  return uw;
}

/** The hash fragment (no leading &) that readUw reads back. */
export function writeUw(uw) {
  const params = new URLSearchParams();
  for (const field of UW_FIELDS) if (Number.isFinite(uw[field.key])) params.set(field.key, String(uw[field.key]));
  params.set('taxcity', uw.city ?? '');
  return params.toString();
}

function round2(n) {
  return Math.round(n * 100) / 100;
}

function num(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}
