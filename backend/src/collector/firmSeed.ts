import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { FirmRow } from '../db/store.js';
import { SECTORS, type Sector } from '../types.js';

const MIGRATIONS = resolve(dirname(fileURLToPath(import.meta.url)), '../../supabase/migrations');

/** Every migration that inserts firms, in the order they apply. */
export const SEED_PATHS = [
  resolve(MIGRATIONS, '0002_seed_firms.sql'),
  resolve(MIGRATIONS, '0006_homebuilders.sql')
];

/**
 * Parse the firm list out of the seed migration.
 *
 * Reading the SQL rather than duplicating the list keeps one source of truth,
 * and lets the verifier run with no database and no credentials — which is the
 * point, since verifying boards is what you do before you have either.
 *
 * It reads each statement's own column list instead of assuming positions.
 * An earlier version matched (name, ats, ats_slug) by regex and ignored every
 * later column, which silently dropped `ats_host` — so the two Workday firms
 * failed with "missing ats_host" when the migration plainly had it, and the
 * Workday fetcher never got called at all. Rows now legitimately carry four,
 * five or six columns in different orders, so position is not something to
 * guess at.
 */
export function parseFirmSeed(sql: string): FirmRow[] {
  const firms: FirmRow[] = [];
  let id = 0;

  // Comments go first. A statement cannot be delimited by the next ';' while
  // comments are still present: one of this migration's own comments quotes a
  // board name followed by a semicolon, which truncated the VALUES clause and
  // dropped every firm in that statement.
  const clean = stripComments(sql);
  const statement = /insert\s+into\s+firms\s*\(([^)]*)\)\s*values([\s\S]*?);/gi;

  for (const match of clean.matchAll(statement)) {
    const columns = (match[1] ?? '').split(',').map((column) => column.trim().toLowerCase());

    for (const tuple of tuples(match[2] ?? '')) {
      const row = new Map<string, string | boolean | null>();
      tuple.forEach((value, index) => {
        const column = columns[index];
        if (column) row.set(column, value);
      });

      const name = text(row.get('name'));
      const ats = text(row.get('ats'));
      const slug = text(row.get('ats_slug'));
      if (!name || !ats || !slug) continue;

      firms.push({
        id: ++id,
        name,
        ats: ats as FirmRow['ats'],
        atsSlug: slug,
        atsHost: text(row.get('ats_host')),
        // Columns the migration leaves out fall back to the schema defaults.
        active: row.has('active') ? row.get('active') === true : true,
        slugVerified: row.get('slug_verified') === true,
        sector: sectorOf(row.get('sector'))
      });
    }
  }

  return firms;
}

/** Reads one migration, or several as one list with ids running on across files. */
export async function loadFirmSeed(paths: string | string[] = SEED_PATHS): Promise<FirmRow[]> {
  const files = await Promise.all((Array.isArray(paths) ? paths : [paths]).map((path) => readFile(path, 'utf8')));
  return parseFirmSeed(files.join('\n'));
}

function sectorOf(value: string | boolean | null | undefined): Sector | null {
  const name = text(value);
  return name && (SECTORS as readonly string[]).includes(name) ? (name as Sector) : null;
}

/**
 * Remove line comments, leaving string literals alone.
 *
 * Has to be string-aware both ways: a '--' inside a quoted firm name is not a
 * comment, and a ';' or a quote inside a comment is not SQL.
 */
function stripComments(sql: string): string {
  let out = '';
  let inString = false;

  for (let i = 0; i < sql.length; i++) {
    const char = sql[i] as string;

    if (inString) {
      out += char;
      if (char === "'" && sql[i + 1] === "'") {
        out += "'";
        i++;
      } else if (char === "'") {
        inString = false;
      }
      continue;
    }

    if (char === "'") {
      inString = true;
      out += char;
      continue;
    }

    if (char === '-' && sql[i + 1] === '-') {
      // Skip to end of line, keeping the newline so line structure survives.
      while (i < sql.length && sql[i] !== '\n') i++;
      out += '\n';
      continue;
    }

    out += char;
  }

  return out;
}

/**
 * Split a VALUES clause into one array of parsed values per tuple.
 *
 * Hand-written rather than regex because a value can contain the characters
 * that delimit it: a firm named 'O''Connor & Associates, Inc.' has both an
 * escaped quote and a comma inside it.
 */
function tuples(clause: string): (string | boolean | null)[][] {
  const rows: (string | boolean | null)[][] = [];

  let current: (string | boolean | null)[] | null = null;
  let token = '';
  let inString = false;

  const flushToken = () => {
    if (!current) return;
    const value = token.trim();
    if (value) current.push(parseValue(value));
    token = '';
  };

  for (let i = 0; i < clause.length; i++) {
    const char = clause[i] as string;

    if (inString) {
      // '' is an escaped quote, not the end of the string.
      if (char === "'" && clause[i + 1] === "'") {
        token += "''";
        i++;
      } else if (char === "'") {
        inString = false;
        token += char;
      } else {
        token += char;
      }
      continue;
    }

    if (char === "'") {
      inString = true;
      token += char;
      continue;
    }

    if (char === '(' && !current) {
      current = [];
      continue;
    }

    if (char === ')' && current) {
      flushToken();
      rows.push(current);
      current = null;
      continue;
    }

    if (char === ',' && current) {
      flushToken();
      continue;
    }

    if (current) token += char;
  }

  return rows;
}

function parseValue(raw: string): string | boolean | null {
  if (raw.startsWith("'") && raw.endsWith("'") && raw.length >= 2) {
    return raw.slice(1, -1).replace(/''/g, "'");
  }
  const lower = raw.toLowerCase();
  if (lower === 'true') return true;
  if (lower === 'false') return false;
  if (lower === 'null' || lower === 'default') return null;
  return raw;
}

function text(value: string | boolean | null | undefined): string | null {
  return typeof value === 'string' && value ? value : null;
}
