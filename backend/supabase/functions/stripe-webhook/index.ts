// Supabase Edge Function (Deno): receives Stripe webhooks for website
// subscriptions. The logic lives in stripe.ts, where the tests can reach it.
//
// Deployed by .github/workflows/stripe-webhook.yml with JWT checks off,
// because Stripe signs its requests rather than sending a Supabase token.
import { handleEvent, verifySignature, type Env } from './stripe.ts';

declare const Deno: {
  env: { get(name: string): string | undefined };
  serve(handler: (request: Request) => Response | Promise<Response>): void;
};

const env: Env = {
  supabaseUrl: Deno.env.get('SUPABASE_URL') ?? '',
  serviceRoleKey: Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
  stripeSecretKey: Deno.env.get('STRIPE_SECRET_KEY') ?? '',
  webhookSecret: Deno.env.get('STRIPE_WEBHOOK_SECRET') ?? ''
};

Deno.serve(async (request) => {
  if (request.method !== 'POST') return new Response('POST only', { status: 405 });

  const body = await request.text();
  if (!(await verifySignature(body, request.headers.get('stripe-signature'), env.webhookSecret))) {
    return new Response('bad signature', { status: 400 });
  }

  try {
    const outcome = await handleEvent(JSON.parse(body), env);
    console.log(outcome);
    return new Response(JSON.stringify({ received: true }), { headers: { 'content-type': 'application/json' } });
  } catch (error) {
    // A 500 makes Stripe retry the event with backoff, which is what a
    // transient Supabase or Stripe API failure needs.
    console.error(error);
    return new Response('failed', { status: 500 });
  }
});
