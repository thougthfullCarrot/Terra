import { describe, expect, it, vi } from 'vitest';
import {
  handleEvent,
  hmacHex,
  rowFromSubscription,
  verifySignature,
  type Env
} from '../supabase/functions/stripe-webhook/stripe.js';

const env: Env = {
  supabaseUrl: 'https://proj.supabase.co',
  serviceRoleKey: 'service',
  stripeSecretKey: 'rk_test',
  webhookSecret: 'whsec_test'
};
const USER = '0b9c2f4e-6a1d-4c3b-9e8f-1a2b3c4d5e6f';

describe('verifySignature', () => {
  const body = '{"id":"evt_1"}';
  const t = 1_790_000_000;

  it('accepts a signature Stripe would send', async () => {
    const v1 = await hmacHex(env.webhookSecret, `${t}.${body}`);
    expect(await verifySignature(body, `t=${t},v1=deadbeef,v1=${v1}`, env.webhookSecret, t + 10)).toBe(true);
  });

  it('rejects a tampered body, a wrong secret, an old timestamp, or no header', async () => {
    const v1 = await hmacHex(env.webhookSecret, `${t}.${body}`);
    expect(await verifySignature('{"id":"evt_2"}', `t=${t},v1=${v1}`, env.webhookSecret, t)).toBe(false);
    expect(await verifySignature(body, `t=${t},v1=${v1}`, 'whsec_other', t)).toBe(false);
    expect(await verifySignature(body, `t=${t},v1=${v1}`, env.webhookSecret, t + 301)).toBe(false);
    expect(await verifySignature(body, null, env.webhookSecret, t)).toBe(false);
  });
});

describe('rowFromSubscription', () => {
  it('reads the period end from the subscription or, on newer API versions, its items', () => {
    const old = rowFromSubscription({ id: 'sub_1', customer: 'cus_1', status: 'active', current_period_end: 1_790_000_000 });
    const basil = rowFromSubscription({
      id: 'sub_1',
      customer: { id: 'cus_1' },
      status: 'active',
      items: { data: [{ current_period_end: 1_790_000_000 }] }
    });
    expect(old).toEqual(basil);
    expect(old).toEqual({
      stripe_customer_id: 'cus_1',
      stripe_subscription_id: 'sub_1',
      status: 'active',
      current_period_end: new Date(1_790_000_000_000).toISOString()
    });
  });
});

function fakeFetch(responses: Record<string, unknown>) {
  return vi.fn(async (url: string | URL | Request, _init?: RequestInit) => {
    const key = Object.keys(responses).find((prefix) => String(url).startsWith(prefix));
    if (!key) return new Response('not found', { status: 404 });
    return new Response(JSON.stringify(responses[key]), { status: 200 });
  });
}

describe('handleEvent', () => {
  it('links a completed checkout to the Terra user who started it', async () => {
    const fetch = fakeFetch({
      'https://api.stripe.com/v1/subscriptions/sub_1': {
        id: 'sub_1',
        customer: 'cus_1',
        status: 'active',
        current_period_end: 1_790_000_000
      },
      'https://proj.supabase.co/rest/v1/subscriptions': []
    });
    const outcome = await handleEvent(
      {
        type: 'checkout.session.completed',
        data: { object: { mode: 'subscription', subscription: 'sub_1', client_reference_id: USER } }
      },
      env,
      fetch
    );
    expect(outcome).toMatch(/linked/);

    const [url, init] = fetch.mock.calls[1]!;
    expect(String(url)).toBe('https://proj.supabase.co/rest/v1/subscriptions?on_conflict=user_id');
    expect(init?.method).toBe('POST');
    expect(JSON.parse(String(init?.body))).toMatchObject({ user_id: USER, stripe_customer_id: 'cus_1', status: 'active' });
  });

  it('ignores a checkout with no Terra user id or a one-off payment', async () => {
    const fetch = fakeFetch({});
    const base = { mode: 'subscription', subscription: 'sub_1' };
    expect(await handleEvent({ type: 'checkout.session.completed', data: { object: base } }, env, fetch)).toMatch(/ignored/);
    expect(
      await handleEvent(
        { type: 'checkout.session.completed', data: { object: { ...base, client_reference_id: "x' or 1=1" } } },
        env,
        fetch
      )
    ).toMatch(/ignored/);
    expect(
      await handleEvent(
        { type: 'checkout.session.completed', data: { object: { mode: 'payment', client_reference_id: USER } } },
        env,
        fetch
      )
    ).toMatch(/ignored/);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('records a cancellation against the customer', async () => {
    const fetch = fakeFetch({ 'https://proj.supabase.co/rest/v1/subscriptions': [{ user_id: USER }] });
    const outcome = await handleEvent(
      {
        type: 'customer.subscription.deleted',
        data: { object: { id: 'sub_1', customer: 'cus_1', status: 'canceled', current_period_end: 1_790_000_000 } }
      },
      env,
      fetch
    );
    expect(outcome).toBe('updated cus_1 to canceled');
    const [url, init] = fetch.mock.calls[0]!;
    expect(String(url)).toBe('https://proj.supabase.co/rest/v1/subscriptions?stripe_customer_id=eq.cus_1');
    expect(init?.method).toBe('PATCH');
  });

  it('throws when Supabase refuses, so Stripe retries', async () => {
    const fetch = vi.fn(async () => new Response('nope', { status: 500 }));
    await expect(
      handleEvent(
        { type: 'customer.subscription.updated', data: { object: { id: 's', customer: 'c', status: 'active' } } },
        env,
        fetch
      )
    ).rejects.toThrow(/500/);
  });
});
