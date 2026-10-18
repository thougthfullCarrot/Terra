/** Every Raw Land label in one place. Wording decided by Rod on 2026-10-18; change only with his OK. */
export const LABELS = {
  marketValue: 'BCAD tax-roll market value (2025), not an asking price or current market estimate.',
  provisional: 'Provisional: derived from roll components; BCAD layout not yet confirmed.',
  landValue: 'Land market value (2025)',
  landPsf: 'Land market value per land sq ft',
  appraisedAssessed: 'Not in this source',
  outline: 'Outline: BCAD 2025 extract (SARA copy)',
  notMatched: 'account not matched in the city parcel layer; current status unknown',
  unincorporated: 'No city zoning: unincorporated',
  zoningNotFound: 'Zoning not found for this area',
  coverageUnavailable: 'Zoning coverage unavailable',
  unavailable: 'Unavailable',
  unranked: (n: number, what: string) => `${n.toLocaleString('en-US')} matching accounts have no ${what} and are not ranked`,
  inMapArea: 'in this map area'
} as const;

/** City zoning status from Phase 0 (city by city). Only San Antonio is integrated in Phase 1. */
export const CITY_ZONING: Record<string, 'integrated' | 'published, not yet integrated' | 'published as PDF only' | 'retrieval failed' | 'not machine-readable' | 'not yet checked'> = {
  'San Antonio': 'integrated',
  'Fort Sam Houston': 'military installation, no city zoning', 'Lackland AFB': 'military installation, no city zoning', 'Randolph AFB': 'military installation, no city zoning',
  'Alamo Heights': 'published as PDF only',
  Helotes: 'published as PDF only',
  'Live Oak': 'published, not yet integrated',
  Cibolo: 'published, not yet integrated',
  'Universal City': 'retrieval failed',
  'Leon Valley': 'retrieval failed',
  Windcrest: 'retrieval failed'
};
