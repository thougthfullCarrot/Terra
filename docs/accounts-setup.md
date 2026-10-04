# Website accounts: setup

The website can require sign-in. Anyone signs in with a link emailed to them.
A college (.edu) email gets the jobs free; any other email pays a monthly
subscription through Stripe. Signed-in users get a profile (name, college,
grad year, major, picture, resume) and the jobs that best fit their resume are
marked **Best match**.

Until the settings below exist, the site stays open exactly as before. Nothing
here costs money: Supabase's free plan and Stripe's test mode are both free.

You need three accounts: Supabase (database, sign-in, file storage), Stripe
(payments), and this GitHub repository's settings. About 20 minutes.

## 1. Supabase project

1. Go to <https://supabase.com/dashboard>, sign in with GitHub, click **New project**.
2. Name it `terra`, pick a database password (save it somewhere), region
   **Central US** or the closest to Texas, plan **Free**. Click **Create new project** and wait for it to finish.
3. Left sidebar, **SQL Editor** > **New query**. Paste the whole contents of each
   file below, one at a time and in this order, and click **Run** after each:
   - `backend/supabase/migrations/0001_init.sql`
   - `backend/supabase/migrations/0002_seed_firms.sql`
   - `backend/supabase/migrations/0003_markets_seed.sql`
   - `backend/supabase/migrations/0004_cron.sql`
   - `backend/supabase/migrations/0005_site_access.sql`

   Each should end with "Success. No rows returned".
4. Left sidebar, **Authentication** > **URL Configuration**:
   - **Site URL**: `https://thougthfullcarrot.github.io/Terra/`
   - **Redirect URLs** > **Add URL**: `https://thougthfullcarrot.github.io/Terra/**`
   - Click **Save**.
5. Left sidebar, **Project Settings** > **API** (or **Data API** / **API Keys**). Copy:
   - **Project URL** (looks like `https://abcdefgh.supabase.co`)
   - the **anon / public** key
   - the **service_role** key (click **Reveal**). This one is secret; it only goes into GitHub secrets below.
6. Go to <https://supabase.com/dashboard/account/tokens>, click **Generate new token**,
   name it `terra-github`, copy it. GitHub uses it to deploy the payment webhook.

Note on email: Supabase's built-in sender only sends a few sign-in emails per
hour, so other people quickly see "email rate limit exceeded". Use Gmail as the
sender instead (free, about 500 emails a day):

1. Turn on 2-Step Verification at <https://myaccount.google.com/security>.
2. Open <https://myaccount.google.com/apppasswords>, name it `terra`, click **Create**,
   and copy the 16-letter password.
3. In GitHub secrets (section 3) add `SMTP_USER` (your Gmail address) and
   `SMTP_PASSWORD` (that 16-letter password).
4. **Actions** tab > **Email sender** > **Run workflow**.

## 2. Stripe (test mode)

Keep the **Test mode** toggle (top right of the dashboard) on for all of this.
Nobody can be charged real money in test mode.

1. Go to <https://dashboard.stripe.com/register> and create an account (or sign in).
2. **Product catalog** > **Add product**. Name `Terra membership`, pricing
   **Recurring**, **Monthly**, the price you want. Click **Save product**.
3. On that product, **Create payment link**. Under **After payment**, choose
   **Don't show confirmation page** > redirect to
   `https://thougthfullcarrot.github.io/Terra/?checkout=success`. Click **Create link**
   and copy the link (starts with `https://buy.stripe.com/test_`).
4. **Settings** > **Billing** > **Customer portal** > **Activate test link**, and copy
   that link too. Subscribers use it to cancel or change their card.
5. **Developers** > **API keys** > **Create restricted key**. Name it `terra-webhook`,
   set **Subscriptions** to **Read** and leave everything else at **None**. Click
   **Create key** and copy it (starts with `rk_test_`).
6. **Developers** > **Webhooks** > **Add endpoint**:
   - **Endpoint URL**: your Project URL from Supabase plus `/functions/v1/stripe-webhook`,
     for example `https://abcdefgh.supabase.co/functions/v1/stripe-webhook`
   - **Select events**: `checkout.session.completed`, `customer.subscription.created`,
     `customer.subscription.updated`, `customer.subscription.deleted`
   - Click **Add endpoint**, then **Reveal** the **Signing secret** and copy it (starts with `whsec_`).

## 3. GitHub settings

Open <https://github.com/thougthfullCarrot/Terra/settings/secrets/actions>.

On the **Secrets** tab, click **New repository secret** for each:

| Name | Value |
| --- | --- |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase service_role key |
| `SUPABASE_ACCESS_TOKEN` | the `terra-github` token |
| `STRIPE_SECRET_KEY` | the `rk_test_` restricted key |
| `STRIPE_WEBHOOK_SECRET` | the `whsec_` signing secret |

On the **Variables** tab, click **New repository variable** for each:

| Name | Value |
| --- | --- |
| `SUPABASE_URL` | Supabase Project URL |
| `SUPABASE_ANON_KEY` | Supabase anon key |
| `STRIPE_PAYMENT_LINK` | the `https://buy.stripe.com/test_` link |
| `STRIPE_BILLING_PORTAL_LINK` | the customer portal link |
| `PRICE_LABEL` | what the button says, e.g. `$9/month` |

Leaving out `STRIPE_PAYMENT_LINK` turns payments off: non-college emails are
told a college email is required.

## 4. Turn it on

1. **Actions** tab > **Stripe webhook** > **Run workflow**. It should finish green and
   print the webhook URL in its summary.
2. **Actions** tab > **Website** > **Run workflow**. When it finishes, the site asks
   visitors to sign in.

## 5. Try it

- Sign in with a `.edu` address: the jobs show, free.
- Sign in with a Gmail address: you get a Subscribe button. Pay with Stripe's test
  card `4242 4242 4242 4242`, any future date, any CVC. You land back on the site
  and the jobs appear within a few seconds.
- Open **Profile**, upload a resume (PDF, Word or text) and fill in grad year and
  city: jobs that fit are outlined and marked **Best match**, and **Sort > Best match**
  appears.

## Going live with real payments

Only when you are ready to charge real money: in Stripe, switch **Test mode** off,
repeat steps 2.2 to 2.6 in live mode, and replace `STRIPE_PAYMENT_LINK`,
`STRIPE_BILLING_PORTAL_LINK`, `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET` with
the live values. Then run both workflows again.

## How it fits together

- `site/account.js`: sign-in, the subscribe screen and the profile page.
- `backend/supabase/migrations/0005_site_access.sql`: who may read the jobs
  (`access_level()`), the `subscriptions` table, private picture and resume storage.
- `backend/supabase/functions/stripe-webhook/`: records Stripe payments in `subscriptions`.
- `.github/workflows/site.yml`: writes `site/config.js` from the variables and stores
  each snapshot in Supabase instead of publishing `postings.json`.
- Resumes are read in the browser; their text is stored with the profile and scored
  with the same matcher the app uses (`backend/src/matching/score.ts`). No AI service is called.
