import type { Sector } from '../types.js';

/**
 * Keyword weights per sector. Title hits count triple: 'Acquisitions Analyst'
 * in a description about a property management portfolio is still an
 * investment seat, and the title is the more reliable signal.
 */
const KEYWORDS: Record<Sector, string[]> = {
  Investment: [
    'acquisition',
    'acquisitions',
    'underwriting',
    'underwrite',
    'investment',
    'investments',
    'private equity',
    'fund',
    'due diligence',
    'disposition',
    'irr',
    'investment committee'
  ],
  Brokerage: [
    'brokerage',
    'broker',
    'leasing',
    'tenant representation',
    'tenant rep',
    'landlord representation',
    'listing',
    'tour book',
    'lease abstract',
    'occupier',
    'agency leasing',
    'research associate',
    'market research'
  ],
  Development: [
    'development',
    'developer',
    'entitlement',
    'entitlements',
    'construction',
    'ground-up',
    'ground up',
    'site selection',
    'pre-development',
    'predevelopment',
    'project management',
    'permitting'
  ],
  'Property Mgmt': [
    'property management',
    'property manager',
    'facilities',
    'tenant services',
    'tenant coordinator',
    'building engineer',
    'yardi',
    'mri',
    'work order',
    'vendor coordination',
    'on-site management'
  ],
  'Asset Mgmt': [
    'asset management',
    'asset manager',
    'portfolio management',
    'budget variance',
    'hold/sell',
    'business plan',
    'investor reporting',
    'lease renewal analysis',
    'noi growth'
  ],
  Appraisal: [
    'appraisal',
    'appraiser',
    'valuation',
    'valuations',
    'uspap',
    'mai',
    'income approach',
    'sales comparison',
    'trainee appraiser'
  ],
  'Capital Markets': [
    'capital markets',
    'debt placement',
    'structured finance',
    'loan sizing',
    'mortgage banking',
    'cmbs',
    'agency debt',
    'credit spread',
    'equity placement',
    'loan origination',
    'servicing'
  ],
  // Mostly reached through the firm row (a builder's postings are all pinned
  // to this sector); the keywords catch builder roles from search sources.
  Homebuilder: [
    'homebuilder',
    'homebuilders',
    'home builder',
    'home builders',
    'homebuilding',
    'home building',
    'new home',
    'new homes',
    'new home sales',
    'model home',
    'homesite',
    'homesites',
    'production builder',
    'assistant superintendent',
    'lot takedown',
    'homebuyer',
    'homebuyers'
  ],
  // Phrases specific to subsidized housing only; bare 'hud' or 'compliance'
  // would pull in mortgage and corporate jobs. 'Compliance specialist' counts
  // only alongside housing words (see HOUSING_CONTEXT below).
  'Affordable Housing': [
    'affordable housing',
    'lihtc',
    'low-income housing tax credit',
    'low income housing tax credit',
    'housing tax credit',
    'tax credit compliance',
    'tax credit property',
    'tax credit properties',
    'hud',
    'section 8',
    'section 42',
    'housing choice voucher',
    'public housing',
    'housing authority',
    'workforce housing',
    'low-income housing',
    'low income housing',
    'community development corporation',
    'community development financial',
    'cdfi',
    'tdhca'
  ]
};

/** Housing words that make a 'compliance specialist' an affordable-housing seat. */
const HOUSING_CONTEXT = /\b(lihtc|tax credit|hud|section 8|affordable housing|housing authority|income certification)/;

const TITLE_WEIGHT = 3;

export interface SectorGuess {
  sector: Sector | null;
  score: number;
}

/**
 * Score every sector against the title and description, returning the best.
 * `sector` is null when nothing matched, which lets the caller count how much
 * of a run needed the fallback instead of hiding it.
 */
export function classifySector(title: string, description = ''): SectorGuess {
  const t = title.toLowerCase();
  const d = description.toLowerCase();

  let best: SectorGuess = { sector: null, score: 0 };

  for (const [sector, words] of Object.entries(KEYWORDS) as [Sector, string[]][]) {
    let score = 0;
    for (const word of words) {
      if (includesPhrase(t, word)) score += TITLE_WEIGHT;
      if (includesPhrase(d, word)) score += 1;
    }
    if (sector === 'Affordable Housing' && HOUSING_CONTEXT.test(`${t}\n${d}`)) {
      if (includesPhrase(t, 'compliance specialist')) score += TITLE_WEIGHT;
      if (includesPhrase(t, 'community development')) score += TITLE_WEIGHT;
    }
    // Ties go to Affordable Housing over Development/Property Mgmt: a LIHTC
    // developer's role says both, and the affordable signal is the rarer one.
    if (score > best.score || (score > 0 && score === best.score && sector === 'Affordable Housing')) best = { sector, score };
  }

  return best;
}

/** Word-boundary containment, so 'broker' does not match 'brokerage-adjacent'. */
function includesPhrase(haystack: string, phrase: string): boolean {
  const escaped = phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|[^a-z])${escaped}([^a-z]|$)`).test(haystack);
}
