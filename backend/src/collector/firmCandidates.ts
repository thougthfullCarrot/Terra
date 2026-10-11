import { readFile } from 'node:fs/promises';

/**
 * Read the candidate firm list — plain names, one per line.
 *
 * Deliberately not a migration and not SQL. Candidates are guesses with no
 * standing until the probe confirms them, and keeping them in a throwaway text
 * file makes that separation impossible to blur: nothing reaches the database
 * without going through a verification step first.
 */
export function parseFirmCandidates(text: string): string[] {
  return parseCandidates(text).map((candidate) => candidate.name);
}

export async function loadFirmCandidates(path: string): Promise<string[]> {
  return parseFirmCandidates(await readFile(path, 'utf8'));
}

/**
 * A candidate line can also carry what a person already knows about the firm:
 *
 *   Name | website | sector | markets
 *   Embrey Partners | embreydc.com | Development | San Antonio; Austin
 *
 * The website is a hint, not a fact: discovery still has to find the firm's
 * name on the page before it trusts the domain.
 */
export interface Candidate {
  name: string;
  domain?: string;
  sector?: string;
  markets?: string;
}

export function parseCandidates(text: string): Candidate[] {
  const seen = new Set<string>();
  const out: Candidate[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, '').trim();
    if (!line) continue;
    const [name = '', domain, sector, markets] = line.split('|').map((part) => part.trim());
    const key = name.toLowerCase();
    if (!name || seen.has(key)) continue;
    seen.add(key);
    out.push({
      name,
      ...(domain ? { domain: domain.replace(/^https?:\/\//, '').replace(/\/.*$/, '').toLowerCase() } : {}),
      ...(sector ? { sector } : {}),
      ...(markets ? { markets } : {})
    });
  }
  return out;
}

export async function loadCandidates(path: string): Promise<Candidate[]> {
  return parseCandidates(await readFile(path, 'utf8'));
}
