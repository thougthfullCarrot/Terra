// unsubscribe.js — the one-click unsubscribe link in alert emails. Reads the
// link's parts and asks the database (unsubscribe_alerts, migration 0016) to
// turn that kind of email off. It works signed out: the signed token is the
// proof, and it can only turn emails off.
import { unsubscribeParams } from './watch.js';

const NAMES = { jobs: 'job alert emails', watch: 'watchlist emails' };

/** Null when the page has no unsubscribe link; otherwise the message to show. */
export async function handleUnsubscribe(config, location, fetchImpl = fetch) {
  const link = unsubscribeParams(location.search);
  if (!link) return null;
  if (!link.valid || !config?.supabaseUrl || !config?.supabaseAnonKey) {
    return { ok: false, text: "This unsubscribe link isn't complete. Turn emails off under Profile instead." };
  }
  try {
    const response = await fetchImpl(`${config.supabaseUrl.replace(/\/+$/, '')}/rest/v1/rpc/unsubscribe_alerts`, {
      method: 'POST',
      headers: { apikey: config.supabaseAnonKey, 'content-type': 'application/json' },
      body: JSON.stringify({ p_user: link.user, p_scope: link.kind, p_token: link.token })
    });
    const done = response.ok && (await response.json()) === true;
    return done
      ? { ok: true, text: `You're unsubscribed from ${NAMES[link.kind]}. Turn them back on any time under Profile.` }
      : { ok: false, text: "This unsubscribe link didn't work. Turn emails off under Profile instead." };
  } catch {
    return { ok: false, text: "Couldn't reach Terra to unsubscribe. Try the link again in a minute." };
  }
}

/** Remove the link's parts from the address bar so a reload doesn't repeat it. */
export function clearUnsubscribe(location, history) {
  const params = new URLSearchParams(location.search);
  for (const key of ['unsubscribe', 'u', 't']) params.delete(key);
  const query = params.toString();
  history.replaceState(null, '', `${location.pathname}${query ? `?${query}` : ''}${location.hash}`);
}
