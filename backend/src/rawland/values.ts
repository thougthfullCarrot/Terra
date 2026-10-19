import type { AppraisalRecord } from '../appraisal/types.js';
import { SQFT_PER_ACRE, landPsf } from './metrics.js';
import { LABELS } from './labels.js';

export interface AccountValues { market: number | null; land: number | null; landPsf: number | null; acres: number | null; stateCode: string | null; taxYear: number | null; status: string; conflicting: string[] }
/**
 * #84's AppraisalRecord -> Raw Land values. Market value only when the record says its total is the market figure.
 * Land market value is provisional and kept only when land + improvements reproduce that total within $1.
 * Nothing here reads owner, situs or mailing fields.
 */
export function accountValues(r: AppraisalRecord): AccountValues {
  const market = r.valueBasis === 'market' ? r.totalValue : null;
  const acres = r.landSqft != null && r.landSqft > 0 ? r.landSqft / SQFT_PER_ACRE : null;
  let land: number | null = null; let status = 'ok';
  if (market == null) status = r.totalValue == null ? `${LABELS.unavailable}: total value missing` : `${LABELS.unavailable}: total is not a market value`;
  else if (r.landValue == null || r.improvementValue == null) status = `${LABELS.unavailable}: land or improvement value missing`;
  else if (Math.abs(r.landValue + r.improvementValue - market) >= 1) status = `${LABELS.unavailable}: components do not reproduce the market value`;
  else land = r.landValue;
  if (r.conflicting?.length) status += `; source rows disagree on ${r.conflicting.join(', ')}`;
  return { market, land, landPsf: acres == null ? null : landPsf(land, acres), acres, stateCode: r.stateCode, taxYear: r.taxYear, status, conflicting: r.conflicting ?? [] };
}
