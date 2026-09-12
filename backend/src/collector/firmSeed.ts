import { readFile } from 'node:fs/promises';
import type { FirmRow } from '../db/store.js';

/**
 * Parse the firm list straight out of the seed migration.
 *
 * Reading the SQL rather than duplicating the list keeps one source of truth,
 * and lets the verifier run with no database and no credentials — which is the
 * point, since verifying slugs is the thing you do before you have either.
 */
export function parseFirmSeed(sql: string): FirmRow[] {
  const firms: FirmRow[] = [];
  let id = 0;

  // Matches ('Firm', 'greenhouse', 'slug') and the same with trailing columns
  // such as slug_verified or active, which rows carry once a firm is verified.
  const row =
    /\(\s*'((?:[^']|'')*)'\s*,\s*'(greenhouse|lever|workday|icims)'\s*,\s*'((?:[^']|'')*)'\s*(?:,[^)]*)?\)/g;

  for (const match of sql.matchAll(row)) {
    firms.push({
      id: ++id,
      name: unquote(match[1] as string),
      ats: match[2] as FirmRow['ats'],
      atsSlug: unquote(match[3] as string),
      active: true,
      slugVerified: false
    });
  }

  return firms;
}

export async function loadFirmSeed(path: string): Promise<FirmRow[]> {
  return parseFirmSeed(await readFile(path, 'utf8'));
}

/** SQL escapes a literal quote by doubling it. */
function unquote(value: string): string {
  return value.replace(/''/g, "'");
}
