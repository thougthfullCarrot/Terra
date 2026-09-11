// data-source.js — production implementation of the app's ONLY data layer.
//
// Drop-in replacement for the prototype's seed-data version: same exports, same
// signatures, same shapes, so no screen changes when you swap it in.
//
//   SOURCE                 -> rendered on the Profile screen
//   fetchFeed({ state })   -> { jobs, match, markets, syncedAt } | throws Error
//   fetchMarkets()         -> markets
//   simulateFailure()      -> dev only, no-op in production builds
//
// The server does the joining, the date math, and the match scoring. Everything
// here is transport.

const API_BASE = process.env.EXPO_PUBLIC_API_BASE ?? 'https://api.yourapp.dev';

export const SOURCE = {
  name: 'texas-cre-aggregator',
  endpoint: `${API_BASE}/v1/postings?state=TX&level=intern,entry`,
  poll: 'every 2 hours',
  transport: 'REST + realtime subscription on insert'
};

/**
 * Supply the signed-in user's Supabase access token so the response carries
 * their match scores. Called once at sign-in; without it the feed still loads,
 * just without the resume-match highlights.
 */
let accessToken = null;
export function setAccessToken(token) {
  accessToken = token;
}

// Dev only, driving the Profile screen's "Test failure" button. The export
// stays in every build so the screen compiles; it does nothing in production.
let failNext = false;
export function simulateFailure() {
  if (process.env.NODE_ENV === 'production') return;
  failNext = true;
}

export async function fetchFeed({ state = 'TX', signal } = {}) {
  if (failNext) {
    failNext = false;
    throw new Error(`Source unreachable — ${SOURCE.name} returned 503`);
  }

  const response = await request(`/v1/postings?state=${encodeURIComponent(state)}&level=intern,entry`, signal);

  const payload = await response.json();
  return {
    jobs: payload.jobs ?? [],
    match: payload.match ?? {},
    markets: payload.markets ?? {},
    // The wire carries an ISO string; every screen expects a Date.
    syncedAt: payload.syncedAt ? new Date(payload.syncedAt) : new Date()
  };
}

export async function fetchMarkets({ signal } = {}) {
  const response = await request('/v1/markets', signal);
  return response.json();
}

async function request(path, signal) {
  const headers = { accept: 'application/json' };
  if (accessToken) headers.authorization = `Bearer ${accessToken}`;

  let response;
  try {
    response = await fetch(`${API_BASE}${path}`, { headers, signal });
  } catch (cause) {
    // The error card prints this message verbatim.
    throw new Error(`Source unreachable — ${SOURCE.name} did not respond`);
  }

  if (!response.ok) {
    const detail = await response.json().catch(() => null);
    throw new Error(detail?.error ?? `Source unreachable — ${SOURCE.name} returned ${response.status}`);
  }

  return response;
}

/**
 * Realtime: new postings arrive as INSERTs. Call this once from the app shell
 * and prepend what it hands you rather than refetching the whole feed.
 */
export function subscribeToNewPostings(db, onNewPosting) {
  return db
    .channel('new-postings')
    .on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'postings' },
      (payload) => onNewPosting(payload.new)
    )
    .subscribe();
}
