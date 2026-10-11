import { classifySector } from './sector.js';

/**
 * Whether a posting is a commercial real estate seat, as opposed to a job that
 * merely sits at a real estate firm (JLL's IT intern) or a bank (a teller).
 *
 * Two kinds of employer:
 *  - A CRE firm (the default): its entry-level jobs are kept unless the title
 *    names a function with nothing to do with real estate (software, HR,
 *    marketing, maintenance) and no sector word rescues it.
 *  - A firm marked real-estate-only (banks, title insurers, Ryan): the job has
 *    to show real estate work, in its title or, failing that, plainly and
 *    more than once in its description. A bank's boilerplate mentioning "real
 *    estate" once is not enough.
 */
const OFF_FUNCTION =
  /\b(software|web developer|front[- ]end|back[- ]end|full[- ]stack|devops|data engineer|data scientist|machine learning|cyber\w*|information security|network|help ?desk|service desk|desktop support|security analyst|it support|it analyst|information technology|human resources|hr|recruit\w*|talent acquisition|payroll|benefits|marketing|graphic|social media|communications|public relations|customer service|call center|receptionist|front desk|administrative assistant|executive assistant|office assistant|nurse|driver|mechanic|maintenance|technician|porter|housekeep\w*|janitor\w*|custodian|cook|chef|security officer|warehouse|paralegal|legal|counsel|attorney|sales development|inside sales|account executive|engineer(ing)?|teller|personal banker|wealth|insurance agent|claims)\b/i;

const CRE_TEXT =
  /\b(commercial real estate|cre\b|real estate (investment|development|finance|lending|transactions?|portfolio|acquisitions?)|income[- ]producing propert(y|ies)|multifamily|industrial propert(y|ies)|office propert(y|ies)|retail propert(y|ies)|real property|land acquisition|entitlements?|leasing|property management|appraisal|ad valorem|property tax)\b/gi;

export type Relevance = 'cre' | 'off-topic';

export function creRelevance(title: string, description: string, creOnly: boolean): Relevance {
  const titleSector = classifySector(title).sector;
  if (titleSector) return 'cre';

  if (OFF_FUNCTION.test(title)) return 'off-topic';
  if (!creOnly) return 'cre';

  const mentions = description.match(CRE_TEXT)?.length ?? 0;
  return mentions >= 2 ? 'cre' : 'off-topic';
}
