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
