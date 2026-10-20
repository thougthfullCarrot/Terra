import { createHash } from 'node:crypto';

/**
 * Stable posting id: sha1(firm + role + city), per the collector spec.
 *
 * The three parts are lowercased and whitespace-collapsed first. Boards
 * reformat titles constantly ('Investment Analyst Intern' one run, 'Investment
 * Analyst  Intern ' the next); without that the same seat would land twice.
 */
export function postingId(firm: string, role: string, city: string): string {
  const key = [firm, role, city].map(canonical).join('|');
  return createHash('sha1').update(key).digest('hex');
}

function canonical(value: string): string {
  return value
    .toLowerCase()
    .replace(/[‐-―]/g, '-')
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Identity of one opening on an official board: the ATS, the board (Greenhouse
 * slug; Workday host + tenant/site) and the board's own job id. Unlike
 * postingId() it does not depend on the title or city, nor on which of two
 * same-titled openings a board happens to list first.
 */
export function openingId(ats: string, board: string, sourceId: string): string {
  const key = ['opening', ats.toLowerCase(), board.toLowerCase().trim(), sourceId.trim()].join('|');
  return createHash('sha1').update(key).digest('hex');
}
