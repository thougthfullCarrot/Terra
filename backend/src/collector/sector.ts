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
  ]
};

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
    if (score > best.score) best = { sector, score };
  }

  return best;
}

/** Word-boundary containment, so 'broker' does not match 'brokerage-adjacent'. */
function includesPhrase(haystack: string, phrase: string): boolean {
  const escaped = phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|[^a-z])${escaped}([^a-z]|$)`).test(haystack);
}
