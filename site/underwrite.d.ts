// Types for underwrite.js, so the backend's tests can import it under strict mode.

export interface Uw {
  price: number;
  income: number;
  vacancy: number;
  expenses: number;
  growth: number;
  expgrowth: number;
  hold: number;
  exitcap: number;
  sellcost: number;
  down: number;
  closing: number;
  rate: number;
  years: number;
  city: string;
}

export interface UwYear {
  year: number;
  gross: number;
  vacancyLoss: number;
  expenses: number;
  noi: number;
  debtService: number;
  cashFlow: number;
  balance: number;
}

export interface UwResult {
  hold: number;
  propertyTax: number;
  loan: number;
  equity: number;
  closingCosts: number;
  payment: number;
  debtService: number;
  years: UwYear[];
  salePrice: number;
  sellingCosts: number;
  loanPayoff: number;
  saleProceeds: number;
  levered: number[];
  unlevered: number[];
  leveredIrr: number | null;
  unleveredIrr: number | null;
  equityMultiple: number | null;
  profit: number;
  goingInCap: number | null;
  avgCashOnCash: number | null;
  dscr: number | null;
  debtYield: number | null;
}

export const UW_FIELDS: { key: Exclude<keyof Uw, 'city'>; label: string; unit: 'usd' | 'pct' | 'years'; min: number; max?: number; step: number }[];
export const DEFAULT_UW: Uw;
export const EXIT_CAP_STEPS: number[];
export const GROWTH_STEPS: number[];
export function underwrite(uw: Uw, taxRate?: number | null): UwResult;
export function sensitivity(uw: Uw, taxRate?: number | null): { growths: number[]; caps: number[]; grid: (number | null)[][] };
export function loanBalance(principal: number, annualRate: number, years: number, year: number): number;
export function irr(flows: number[]): number | null;
export function readUw(hash: string, defaults?: Uw, cities?: string[]): Uw;
export function writeUw(uw: Uw): string;
