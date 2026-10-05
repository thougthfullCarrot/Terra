// Types for deal.js, so the backend's tests can import it under strict mode.

export interface Deal {
  price: number;
  income: number;
  vacancy: number;
  expenses: number;
  down: number;
  closing: number;
  rate: number;
  years: number;
  city: string;
}

export interface DealField {
  key: Exclude<keyof Deal, 'city'>;
  label: string;
  unit: 'usd' | 'pct' | 'years';
  min: number;
  max?: number;
  step: number;
}

export interface DealResult {
  effectiveIncome: number;
  propertyTax: number;
  expenses: number;
  noi: number;
  capRate: number | null;
  loan: number;
  payment: number;
  debtService: number;
  cashFlow: number;
  cashInvested: number;
  cashOnCash: number | null;
  dscr: number | null;
  breakEven: number | null;
}

export const DEAL_FIELDS: DealField[];
export const DEFAULT_SPREAD: number;
export const DEFAULT_DEAL: Deal;
export function monthlyPayment(principal: number, annualRate: number, years: number): number;
export function analyzeDeal(deal: Partial<Deal>, taxRate?: number | null): DealResult;
export function suggestedRate(rates: { key: string; value: number }[] | null | undefined, spread?: number): number | null;
export function readDeal(hash: string, defaults?: Deal, cities?: string[]): Deal;
export function writeDeal(deal: Deal): string;
