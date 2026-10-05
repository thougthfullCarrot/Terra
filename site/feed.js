// feed.js — the website's rules, as plain functions with no DOM.
//
// Kept apart from app.js so the parts where a mistake is invisible (a filter
// that silently drops a posting, a deadline sort that puts undated roles
// first, a day count that is off by one) are covered by the backend's tests.

const DAY_MS = 86_400_000;

export const FILTERS = ['city', 'firm', 'kind', 'sector'];
export const SORTS = ['newest', 'deadline', 'match'];

/** Whole calendar days from `from` to `to`, in UTC. Matches the API's arithmetic. */
export function daysBetween(from, to) {
  return Math.round((midnight(to) - midnight(from)) / DAY_MS);
}

function midnight(date) {
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}

/**
 * Distinct values of one field with their counts, most common first, then A to
 * Z. Values in `always` are listed even at zero, so a covered city stays
 * choosable on a day it has no postings.
 */
export function facet(jobs, field, always = []) {
  const counts = new Map(always.map((value) => [value, 0]));
  for (const job of jobs) {
    const value = job[field];
    if (value) counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return [...counts]
    .map(([value, count]) => ({ value, count }))
    .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value));
}

/**
 * Every word of the search must appear somewhere in the posting, so
 * "analyst dallas" narrows rather than widens. Filters are exact matches; an
 * empty one is ignored. `saved` keeps only the ids in `savedIds`, the jobs the
 * visitor starred on this device.
 */
export function filterJobs(jobs, { q = '', city = '', firm = '', kind = '', sector = '', saved = false, savedIds } = {}) {
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  return jobs.filter((job) => {
    if (saved && !savedIds?.has(job.id)) return false;
    if (city && job.city !== city) return false;
    if (firm && job.firm !== firm) return false;
    if (kind && job.kind !== kind) return false;
    if (sector && job.sector !== sector) return false;
    if (!words.length) return true;
    const haystack = [job.role, job.firm, job.city, job.sector, job.kind, job.desc, ...(job.reqs ?? [])]
      .join(' ')
      .toLowerCase();
    return words.every((word) => haystack.includes(word));
  });
}

/**
 * 'newest': most recently posted first.
 * 'deadline': soonest deadline first, postings with no deadline after every
 * dated one (newest first among themselves), never ahead of them.
 */
export function sortJobs(jobs, sort = 'newest') {
  const newest = (a, b) => b.postedAt.localeCompare(a.postedAt) || a.id.localeCompare(b.id);
  const sorted = [...jobs];
  if (sort === 'match') {
    // matchScore is set by the page from the signed-in user's resume; jobs
    // without one (no resume yet) fall back to newest.
    return sorted.sort((a, b) => (b.matchScore ?? -1) - (a.matchScore ?? -1) || newest(a, b));
  }
  if (sort === 'deadline') {
    return sorted.sort((a, b) => {
      if (a.deadline && b.deadline) return a.deadline.localeCompare(b.deadline) || newest(a, b);
      if (a.deadline) return -1;
      if (b.deadline) return 1;
      return newest(a, b);
    });
  }
  return sorted.sort(newest);
}

/** Posted within the last two calendar days: worth a "New" tag. */
export function isNew(postedAt, now = new Date()) {
  return daysBetween(new Date(postedAt), now) <= 2;
}

/** A firm's monogram: "Lincoln Property Company" -> "LP", "Greystar" -> "GR", "CBRE" -> "CBRE". */
export function initials(name) {
  const words = (name ?? '').replace(/[^\p{L}\p{N}\s&]/gu, ' ').split(/\s+/).filter((w) => w && w !== '&');
  if (!words.length) return '?';
  const [first] = words;
  // An acronym name stays whole: "JLL", "CBRE".
  if (words.length === 1) return (first.length <= 4 && first === first.toUpperCase() ? first : first.slice(0, 2)).toUpperCase();
  return (words[0][0] + words[1][0]).toUpperCase();
}

/**
 * The starred job ids, from whatever localStorage held. Anything that is not
 * a list of strings (an old format, a hand edit) reads as nothing saved.
 */
export function parseSaved(text) {
  try {
    const list = JSON.parse(text ?? '[]');
    return new Set(Array.isArray(list) ? list.filter((id) => typeof id === 'string') : []);
  } catch {
    return new Set();
  }
}

/** A new set with `id` added, or removed if it was there. */
export function toggleSaved(saved, id) {
  const next = new Set(saved);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  return next;
}

export function postedLabel(postedAt, now = new Date()) {
  const days = Math.max(0, daysBetween(new Date(postedAt), now));
  if (days === 0) return 'Posted today';
  if (days === 1) return 'Posted yesterday';
  return `Posted ${days} days ago`;
}

const DISPLAY_DATE = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });

/** { text, urgent } for a YYYY-MM-DD deadline, or null when there is none. */
export function deadlineLabel(deadline, now = new Date()) {
  if (!deadline) return null;
  const date = new Date(`${deadline}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return null;
  const days = daysBetween(now, date);
  const when = DISPLAY_DATE.format(date);
  if (days < 0) return { text: `Closed ${when}`, urgent: true };
  if (days === 0) return { text: `Closes today`, urgent: true };
  return { text: `Closes ${when} · ${days}d left`, urgent: days <= 7 };
}

/** "Updated 3 hours ago", from the snapshot's own timestamp. */
export function updatedLabel(generatedAt, now = new Date()) {
  const minutes = Math.max(0, Math.round((now.getTime() - new Date(generatedAt).getTime()) / 60_000));
  if (minutes < 1) return 'Updated just now';
  if (minutes < 60) return `Updated ${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `Updated ${hours} hour${hours === 1 ? '' : 's'} ago`;
  return `Updated ${Math.round(hours / 24)} days ago`;
}

/** Only http(s) links reach an href; anything else from a board is dropped. */
export function safeUrl(url) {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:' ? parsed.href : null;
  } catch {
    return null;
  }
}

/** Filter state <-> query string, so a filtered view is a link someone can send. */
export function readQuery(search) {
  const params = new URLSearchParams(search);
  const state = { q: params.get('q') ?? '', sort: params.get('sort') ?? 'newest', saved: params.get('saved') === '1' };
  for (const key of FILTERS) state[key] = params.get(key) ?? '';
  if (!SORTS.includes(state.sort)) state.sort = 'newest';
  state.job = params.get('job') ?? '';
  return state;
}

export function writeQuery(state) {
  const params = new URLSearchParams();
  if (state.q) params.set('q', state.q);
  for (const key of FILTERS) if (state[key]) params.set(key, state[key]);
  if (state.sort && state.sort !== 'newest') params.set('sort', state.sort);
  if (state.saved) params.set('saved', '1');
  if (state.job) params.set('job', state.job);
  const text = params.toString();
  return text ? `?${text}` : '';
}
