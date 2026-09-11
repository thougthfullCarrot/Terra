/**
 * The skill vocabulary the scorer understands. `label` is what shows up in the
 * match note, so it is written the way a student would say it ('modeling', not
 * 'Financial Modeling'). `aliases` are matched case-insensitively against both
 * the posting text and the profile's resume skills.
 */
export interface SkillDef {
  key: string;
  label: string;
  aliases: string[];
}

export const SKILLS: SkillDef[] = [
  { key: 'argus', label: 'Argus', aliases: ['argus', 'argus enterprise', 'argus af'] },
  { key: 'excel', label: 'Excel', aliases: ['excel', 'spreadsheet', 'advanced excel'] },
  {
    key: 'modeling',
    label: 'modeling',
    aliases: [
      'financial modeling',
      'modeling',
      'modelling',
      'dcf',
      'discounted cash flow',
      'pro forma',
      'proforma',
      'waterfall',
      'loan sizing'
    ]
  },
  {
    key: 'underwriting',
    label: 'underwriting',
    aliases: ['underwriting', 'underwrite', 'credit analysis']
  },
  { key: 'costar', label: 'CoStar', aliases: ['costar', 'co-star'] },
  { key: 'yardi', label: 'Yardi', aliases: ['yardi'] },
  { key: 'mri', label: 'MRI', aliases: ['mri software', 'mri'] },
  { key: 'sql', label: 'SQL', aliases: ['sql', 'postgres', 'database querying'] },
  { key: 'python', label: 'Python', aliases: ['python', 'pandas'] },
  { key: 'tableau', label: 'Tableau', aliases: ['tableau', 'power bi', 'powerbi'] },
  { key: 'gis', label: 'GIS', aliases: ['gis', 'arcgis', 'esri'] },
  {
    key: 'powerpoint',
    label: 'PowerPoint',
    aliases: ['powerpoint', 'deck building', 'pitch deck', 'presentation']
  },
  {
    key: 'research',
    label: 'market research',
    aliases: ['market research', 'submarket', 'comps', 'comparables', 'data cleaning']
  },
  {
    key: 'writing',
    label: 'writing',
    aliases: ['writing sample', 'written communication', 'report writing']
  },
  { key: 'license', label: 'TX license', aliases: ['salesperson license', 'real estate license', 'trec'] },
  { key: 'lease', label: 'lease analysis', aliases: ['lease abstract', 'lease analysis', 'lease administration'] },
  { key: 'entitlement', label: 'entitlements', aliases: ['entitlement', 'entitlements', 'permitting', 'zoning'] },
  { key: 'uspap', label: 'USPAP', aliases: ['uspap', 'appraisal standards'] }
];

const BY_KEY = new Map(SKILLS.map((skill) => [skill.key, skill]));

export function skillLabel(key: string): string {
  return BY_KEY.get(key)?.label ?? key;
}

/** Every skill in the vocabulary mentioned anywhere in `text`. */
export function detectSkills(text: string): string[] {
  if (!text) return [];
  const hay = text.toLowerCase();
  return SKILLS.filter((skill) => skill.aliases.some((alias) => contains(hay, alias))).map(
    (skill) => skill.key
  );
}

/**
 * Map a profile's free-text resume skills onto vocabulary keys. Anything the
 * vocabulary does not know is dropped rather than guessed at — an unknown
 * skill cannot match a posting requirement either way.
 */
export function normalizeProfileSkills(skills: string[]): string[] {
  const out = new Set<string>();
  for (const raw of skills ?? []) {
    for (const key of detectSkills(raw)) out.add(key);
  }
  return [...out];
}

function contains(haystack: string, phrase: string): boolean {
  const escaped = phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|[^a-z])${escaped}([^a-z]|$)`).test(haystack);
}
