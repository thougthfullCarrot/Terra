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
  const seen = new Set<string>();

  return text
    .split(/\r?\n/)
    .map((line) => line.replace(/#.*$/, '').trim())
    .filter((line) => {
      if (!line) return false;
      const key = line.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

export async function loadFirmCandidates(path: string): Promise<string[]> {
  return parseFirmCandidates(await readFile(path, 'utf8'));
}
