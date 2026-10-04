// config.js — account settings for the website.
//
// Empty here on purpose. The Website workflow (site.yml) overwrites this file
// at build time from the repository's Actions variables, so no key lives in
// the code. While SUPABASE_URL and SUPABASE_ANON_KEY are empty the site runs
// open, as before accounts existed: no sign-in, feed read from postings.json.
//
// The anon key is designed to be public (row level security does the
// gating); the service role key never reaches this file.
export const CONFIG = {
  supabaseUrl: '',
  supabaseAnonKey: '',
  // Stripe Payment Link for the monthly subscription, and the no-code
  // customer portal link for managing it. Empty: non-college emails see
  // "college email required" instead of a subscribe button.
  paymentLink: '',
  billingPortalLink: '',
  // Shown next to the subscribe button, e.g. "$9/month". Set in Stripe; this is only the label.
  priceLabel: ''
};
