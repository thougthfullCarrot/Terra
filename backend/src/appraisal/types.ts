/**
 * One appraisal district account in one shape, whatever district it came from.
 *
 * Two cautions travel with every record and every screen that shows one:
 * - `owner` is the owner of record on the roll: often an LLC, a trustee or a
 *   lender's nominee, not necessarily the beneficial owner.
 * - The values are the district's appraisal for tax purposes, not a sale
 *   price or market value. Texas doesn't require sale prices to be disclosed.
 */
export interface AppraisalRecord {
  /** Lower-case district id, e.g. 'bexar'. */
  district: string;
  /** The district's property/account id, as text. */
  account: string;
  /** The district's own page for the account, when it has one with a stable link. */
  sourceUrl: string | null;
  /** Where the property is. */
  situs: string | null;
  situsCity: string | null;
  situsZip: string | null;
  /** The owner of record and where the district mails the tax notice. Not the situs. */
  owner: string | null;
  mailing: string | null;
  landValue: number | null;
  improvementValue: number | null;
  /** Total appraised value as the district publishes it (some only publish market value; see valueBasis). */
  totalValue: number | null;
  /** Which figure totalValue is: the district's 'appraised' value or its 'market' value. */
  valueBasis: 'appraised' | 'market' | null;
  taxYear: number | null;
  /** State property type code (A1 house, B1 apartments, F1 commercial, ...). */
  stateCode: string | null;
  landSqft: number | null;
  buildingSqft: number | null;
  yearBuilt: number | null;
  lat: number | null;
  lng: number | null;
  /** When TERRA read the record from the source (ISO date). */
  retrieved: string;
  /** The dataset it was read from (layer URL or file name). */
  dataset: string;
}

export const OWNER_CAUTION = 'Owner of record on the appraisal roll; it may not be the beneficial owner.';
export const VALUE_CAUTION = 'Appraised for property tax; not a sale price or market value.';
