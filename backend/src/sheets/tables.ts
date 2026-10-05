import type { SiteSnapshot } from '../site/snapshot.js';
import type { MarketSnapshot } from '../market/snapshot.js';
import type { Cell } from './google.js';

/**
 * The website's data as spreadsheet rows: one tab of jobs, one of market
 * figures, one of sign-ups. Each tab is rewritten whole on every build, so it
 * always matches the site and needs no de-duplication.
 */

export const JOBS_TAB = 'Jobs';
export const MARKET_TAB = 'Market';
export const SIGNUPS_TAB = 'Sign-ups';

export function jobRows(snapshot: SiteSnapshot): Cell[][] {
  return [
    ['Posted', 'Role', 'Firm', 'City', 'Sector', 'Type', 'Pay', 'Deadline', 'Apply link', 'Found on', `Refreshed ${stamp(snapshot.generatedAt)}`],
    ...snapshot.jobs.map((job) => [
      job.postedAt.slice(0, 10),
      job.role,
      job.firm,
      job.city,
      job.sector,
      job.kind,
      job.pay ?? '',
      job.deadline ?? '',
      job.applyUrl,
      job.via ?? 'Firm careers page',
      ''
    ])
  ];
}

export function marketRows(snapshot: MarketSnapshot): Cell[][] {
  const unit: Record<string, string> = { count: '', usd: ' ($)', change: ' (% change)', rate: ' (%)' };
  const period = (key: string) => snapshot.markets.find((market) => market.periods[key])?.periods[key];
  return [
    [
      'City',
      'Metro area',
      ...snapshot.metrics.map((metric) => `${metric.label}${unit[metric.unit] ?? ''}${period(metric.key) ? `, ${period(metric.key)}` : ''}`),
      `Refreshed ${stamp(snapshot.generatedAt)}`
    ],
    ...snapshot.markets.map((market) => [
      market.city,
      market.metro,
      ...snapshot.metrics.map((metric) => market.values[metric.key] ?? null),
      ''
    ])
  ];
}

/** What the sign-up log reads from Supabase. Deliberately no resume, picture or profile text. */
export interface SignupUser {
  id: string;
  email: string | null;
  created_at: string;
  email_confirmed_at?: string | null;
  last_sign_in_at?: string | null;
}

export interface SignupProfile {
  id: string;
  school: string | null;
  grad_year: number | null;
  major: string | null;
}

export interface SignupSubscription {
  user_id: string;
  status: string;
  current_period_end: string | null;
}

/** Same rule as public.access_level() in 0005_site_access.sql. */
export function accessLabel(user: SignupUser, subscription: SignupSubscription | undefined, now: Date): string {
  const email = (user.email ?? '').trim().toLowerCase();
  if (user.email_confirmed_at && /(^|\.)edu$/.test(email.split('@')[1] ?? '')) return 'College (free)';
  if (
    subscription &&
    ['active', 'trialing'].includes(subscription.status) &&
    (!subscription.current_period_end || new Date(subscription.current_period_end) > now)
  ) {
    return 'Subscriber';
  }
  if (subscription) return `Subscription ${subscription.status}`;
  return user.email_confirmed_at ? 'Signed up, not subscribed' : 'Email not confirmed';
}

export function signupRows(
  users: SignupUser[],
  profiles: SignupProfile[],
  subscriptions: SignupSubscription[],
  now: Date
): Cell[][] {
  const profile = new Map(profiles.map((row) => [row.id, row]));
  const subscription = new Map(subscriptions.map((row) => [row.user_id, row]));
  return [
    ['Joined', 'Email', 'Access', 'School', 'Grad year', 'Major', 'Last sign-in', `Refreshed ${stamp(now.toISOString())}`],
    ...[...users]
      .sort((a, b) => b.created_at.localeCompare(a.created_at))
      .map((user) => {
        const p = profile.get(user.id);
        return [
          user.created_at.slice(0, 10),
          user.email ?? '',
          accessLabel(user, subscription.get(user.id), now),
          p?.school ?? '',
          p?.grad_year ?? '',
          p?.major ?? '',
          user.last_sign_in_at?.slice(0, 10) ?? '',
          ''
        ];
      })
  ];
}

function stamp(iso: string): string {
  return `${iso.slice(0, 16).replace('T', ' ')} UTC`;
}
