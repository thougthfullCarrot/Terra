// deal.js — the deal calculator's math, as plain functions with no DOM.
//
// Like market.js, kept apart from the drawing code (market-tools.js) so the
// backend's tests cover it. Rates are percents (6.5 means 6.5%), money is
// dollars a year unless a name says monthly.

/** The calculator's inputs and the URL hash key each one is saved under. */
export const DEAL_FIELDS = [
  { key: 'price', label: 'Purchase price', unit: 'usd', min: 0, step: 10000 },
  { key: 'income', label: 'Gross rent a year', unit: 'usd', min: 0, step: 1000 },
  { key: 'vacancy', label: 'Vacancy and credit loss', unit: 'pct', min: 0, max: 100, step: 0.5 },
  { key: 'expenses', label: 'Operating expenses a year (before property tax)', unit: 'usd', min: 0, step: 1000 },
  { key: 'down', label: 'Down payment', unit: 'pct', min: 0, max: 100, step: 1 },
  { key: 'closing', label: 'Closing costs', unit: 'pct', min: 0, max: 100, step: 0.25 },
  { key: 'rate', label: 'Loan interest rate', unit: 'pct', min: 0, max: 30, step: 0.05 },
  { key: 'years', label: 'Amortization (years)', unit: 'years', min: 1, max: 40, step: 1 }
];

/** What a lender adds on top of the 10-year Treasury for a typical stabilized property loan, in points. */
export const DEFAULT_SPREAD = 2;

export const DEFAULT_DEAL = {
  price: 1500000,
  income: 180000,
  vacancy: 5,
  expenses: 45000,
  down: 30,
  closing: 2,
  rate: 6.5,
  years: 25,
  city: ''
};

/** Level monthly payment on a fully amortizing loan. */
export function monthlyPayment(principal, annualRate, years) {
  if (!(principal > 0) || !(years > 0)) return 0;
  const months = Math.round(years * 12);
  const r = (annualRate ?? 0) / 100 / 12;
  if (!(r > 0)) return principal / months;
  return (principal * r) / (1 - (1 + r) ** -months);
}

/**
 * Everything the calculator shows for one set of inputs. taxRate is the
 * combined property tax rate in percent (from the Market data tab), applied
 * to the purchase price as a stand-in for the appraisal district's value.
 * Ratios are null where they would divide by zero.
 */
export function analyzeDeal(deal, taxRate = null) {
  const price = Math.max(0, num(deal.price));
  const income = Math.max(0, num(deal.income));
  const effectiveIncome = income * (1 - clamp(num(deal.vacancy), 0, 100) / 100);
  const propertyTax = taxRate != null && Number.isFinite(taxRate) ? (price * taxRate) / 100 : 0;
  const expenses = Math.max(0, num(deal.expenses)) + propertyTax;
  const noi = effectiveIncome - expenses;

  const downPayment = (price * clamp(num(deal.down), 0, 100)) / 100;
  const loan = price - downPayment;
  const payment = monthlyPayment(loan, num(deal.rate), num(deal.years));
  const debtService = payment * 12;
  const cashFlow = noi - debtService;
  const cashInvested = downPayment + (price * Math.max(0, num(deal.closing))) / 100;

  return {
    effectiveIncome,
    propertyTax,
    expenses,
    noi,
    capRate: price > 0 ? (noi / price) * 100 : null,
    loan,
    payment,
    debtService,
    cashFlow,
    cashInvested,
    cashOnCash: cashInvested > 0 ? (cashFlow / cashInvested) * 100 : null,
    dscr: debtService > 0 ? noi / debtService : null,
    breakEven: income > 0 ? ((expenses + debtService) / income) * 100 : null
  };
}

/**
 * The starting interest rate: the latest 10-year Treasury plus the spread,
 * to the nearest 0.05. null when the rates have not loaded.
 */
export function suggestedRate(rates, spread = DEFAULT_SPREAD) {
  const treasury = (rates ?? []).find((r) => r.key === 'DGS10');
  if (!treasury || !Number.isFinite(treasury.value)) return null;
  return Math.round((treasury.value + spread) * 20) / 20;
}

/** The inputs saved in the hash (#markets&tool=calc&price=…), over the defaults; anything unreadable keeps its default. */
export function readDeal(hash, defaults = DEFAULT_DEAL, cities = []) {
  const params = new URLSearchParams(String(hash ?? '').replace(/^#/, ''));
  const deal = { ...defaults };
  for (const field of DEAL_FIELDS) {
    const raw = params.get(field.key);
    if (raw == null || raw === '') continue;
    const value = Number(raw);
    if (!Number.isFinite(value)) continue;
    deal[field.key] = clamp(value, field.min, field.max ?? Infinity);
  }
  const city = params.get('taxcity');
  if (city != null && (city === '' || cities.includes(city))) deal.city = city;
  return deal;
}

/** The hash fragment (no leading &) that readDeal reads back. */
export function writeDeal(deal) {
  const params = new URLSearchParams();
  for (const field of DEAL_FIELDS) if (Number.isFinite(deal[field.key])) params.set(field.key, String(deal[field.key]));
  params.set('taxcity', deal.city ?? '');
  return params.toString();
}

function num(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}
