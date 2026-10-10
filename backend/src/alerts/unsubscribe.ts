import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Signed one-click unsubscribe links. The key is the random secret migration
 * 0016 keeps in the database (alert_link_secret(), service role only); the
 * database checks the same HMAC in unsubscribe_alerts(), so a link works
 * without signing in but only for its own member and kind of email.
 */
export type EmailKind = 'jobs' | 'watch';

export function unsubscribeToken(secretHex: string, userId: string, kind: EmailKind): string {
  return createHmac('sha256', Buffer.from(secretHex, 'hex')).update(`${userId}:${kind}`, 'utf8').digest('hex');
}

/** The page link: the site reads u, k and t and calls unsubscribe_alerts(). */
export function unsubscribeUrl(siteUrl: string, secretHex: string, userId: string, kind: EmailKind): string {
  const url = new URL(siteUrl);
  url.search = '';
  url.hash = '';
  url.searchParams.set('unsubscribe', kind);
  url.searchParams.set('u', userId);
  url.searchParams.set('t', unsubscribeToken(secretHex, userId, kind));
  return url.toString();
}

/** Same check as the database's, for tests and for refusing a bad link early. */
export function validToken(secretHex: string, userId: string, kind: EmailKind, token: string): boolean {
  const expected = Buffer.from(unsubscribeToken(secretHex, userId, kind), 'hex');
  const given = Buffer.from(/^[0-9a-f]{64}$/i.test(token) ? token : '', 'hex');
  return given.length === expected.length && timingSafeEqual(given, expected);
}
