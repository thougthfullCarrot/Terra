/**
 * Stripe webhook logic for website subscriptions, kept free of Deno and npm
 * imports so the backend's tests can run it under Node. index.ts is the thin
 * Deno entry point that wires it to the environment.
 *
 * Flow: the site sends a non-college user to a Stripe Payment Link with
 * `client_reference_id` set to their Supabase user id. When checkout completes
 * Stripe calls this function; it links the customer to that user and records
 * the subscription. Later subscription events (renewal, cancellation, failed
 * payment) update the same row by customer id.
 */

export interface Env {
  supabaseUrl: string;
  serviceRoleKey: string;
  stripeSecretKey: string;
  webhookSecret: string;
}

export interface SubscriptionRow {
  user_id?: string;
  stripe_customer_id: string;
  stripe_subscription_id: string;
  status: string;
  current_period_end: string | null;
}

type Fetch = typeof fetch;

/** Stripe's default tolerance: reject signatures older than five minutes, so a captured request can't be replayed. */
export const TOLERANCE_SECONDS = 300;

/**
 * Check a `Stripe-Signature` header against the raw body, as Stripe's SDK
 * does: HMAC-SHA256 of `${t}.${body}` with the endpoint secret, hex-encoded,
 * compared against every v1 entry.
 */
export async function verifySignature(
  body: string,
  header: string | null,
  secret: string,
  nowSeconds = Math.floor(Date.now() / 1000)
): Promise<boolean> {
  if (!header || !secret) return false;
  const parts = header.split(',').map((part) => part.trim().split('='));
  const timestamp = Number(parts.find(([key]) => key === 't')?.[1]);
  const signatures = parts.filter(([key]) => key === 'v1').map(([, value]) => value ?? '');
  if (!Number.isFinite(timestamp) || !signatures.length) return false;
  if (Math.abs(nowSeconds - timestamp) > TOLERANCE_SECONDS) return false;

  const expected = await hmacHex(secret, `${timestamp}.${body}`);
  return signatures.some((signature) => timingSafeEqual(signature, expected));
}

export async function hmacHex(secret: string, payload: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, [
    'sign'
  ]);
  const mac = await crypto.subtle.sign('HMAC', key, encoder.encode(payload));
  return [...new Uint8Array(mac)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/**
 * The row to store for a Stripe subscription object. Stripe moved
 * `current_period_end` from the subscription onto its items in API version
 * 2025-03-31; read whichever the account's version sends.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function rowFromSubscription(subscription: any): SubscriptionRow {
  const periodEnd: number | undefined =
    subscription.current_period_end ?? subscription.items?.data?.[0]?.current_period_end;
  const customer = typeof subscription.customer === 'string' ? subscription.customer : subscription.customer?.id;
  return {
    stripe_customer_id: customer,
    stripe_subscription_id: subscription.id,
    status: subscription.status,
    current_period_end: periodEnd ? new Date(periodEnd * 1000).toISOString() : null
  };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Handle one verified event. Returns a short description of what was done, for the function's logs. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function handleEvent(event: any, env: Env, fetchImpl: Fetch = fetch): Promise<string> {
  const object = event?.data?.object;
  switch (event?.type) {
    case 'checkout.session.completed': {
      if (object.mode !== 'subscription' || !object.subscription) return 'ignored: not a subscription checkout';
      const userId = object.client_reference_id;
      if (!userId || !UUID.test(userId)) return 'ignored: checkout has no Terra user id';
      const subscription = await fetchSubscription(object.subscription, env, fetchImpl);
      await upsert({ ...rowFromSubscription(subscription), user_id: userId }, 'user_id', env, fetchImpl);
      return `linked ${userId} to ${subscription.id} (${subscription.status})`;
    }
    case 'customer.subscription.created':
    case 'customer.subscription.updated':
    case 'customer.subscription.deleted': {
      // These carry no Terra user id. They update a row checkout already
      // created; one that arrives first is harmless, because checkout's own
      // handler fetches the subscription's current state anyway.
      const row = rowFromSubscription(object);
      const updated = await update(row, env, fetchImpl);
      return updated ? `updated ${row.stripe_customer_id} to ${row.status}` : `ignored: ${row.stripe_customer_id} not linked yet`;
    }
    default:
      return `ignored: ${event?.type}`;
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function fetchSubscription(id: string, env: Env, fetchImpl: Fetch): Promise<any> {
  const response = await fetchImpl(`https://api.stripe.com/v1/subscriptions/${encodeURIComponent(id)}`, {
    headers: { authorization: `Bearer ${env.stripeSecretKey}` }
  });
  if (!response.ok) throw new Error(`Stripe returned ${response.status} for subscription ${id}`);
  return response.json();
}

function restHeaders(env: Env): Record<string, string> {
  return {
    apikey: env.serviceRoleKey,
    authorization: `Bearer ${env.serviceRoleKey}`,
    'content-type': 'application/json'
  };
}

async function upsert(row: SubscriptionRow, onConflict: string, env: Env, fetchImpl: Fetch): Promise<void> {
  const response = await fetchImpl(`${env.supabaseUrl}/rest/v1/subscriptions?on_conflict=${onConflict}`, {
    method: 'POST',
    headers: { ...restHeaders(env), prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify(row)
  });
  if (!response.ok) throw new Error(`Supabase upsert failed: ${response.status} ${await response.text()}`);
}

async function update(row: SubscriptionRow, env: Env, fetchImpl: Fetch): Promise<boolean> {
  const response = await fetchImpl(
    `${env.supabaseUrl}/rest/v1/subscriptions?stripe_customer_id=eq.${encodeURIComponent(row.stripe_customer_id)}`,
    {
      method: 'PATCH',
      headers: { ...restHeaders(env), prefer: 'return=representation' },
      body: JSON.stringify({
        stripe_subscription_id: row.stripe_subscription_id,
        status: row.status,
        current_period_end: row.current_period_end
      })
    }
  );
  if (!response.ok) throw new Error(`Supabase update failed: ${response.status} ${await response.text()}`);
  const rows = (await response.json()) as unknown[];
  return rows.length > 0;
}
