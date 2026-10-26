// home.js — pure helpers for the welcome screen (home-view.js), kept apart so the backend's tests can import them.

/**
 * "128 open roles listed now", or '' when there is no real number to show:
 * a missing, zero or unreadable count leaves the card without one.
 */
export function countLabel(n, noun, suffix = '') {
  if (!Number.isFinite(n) || n <= 0) return '';
  const words = `${n.toLocaleString('en-US')} ${n === 1 ? noun : `${noun}s`}`;
  return suffix ? `${words} ${suffix}` : words;
}
