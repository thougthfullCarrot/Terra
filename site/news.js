// news.js — the news section's rules, as plain functions with no DOM.
//
// Like market.js, kept apart from the drawing code so filtering and dates are
// covered by the backend's tests. The data file is written by
// backend/src/bin/export-news.ts.

/** #news&city=Houston&topic=Development → { open, city, topic }. Unknown values fall back to all. */
export function readNewsHash(hash, file) {
  const params = new URLSearchParams(String(hash ?? '').replace(/^#/, ''));
  const cities = (file?.cities ?? []).map((c) => c.city);
  const topics = file?.topics ?? [];
  return {
    open: params.has('news'),
    city: cities.includes(params.get('city')) ? params.get('city') : '',
    topic: topics.includes(params.get('topic')) ? params.get('topic') : ''
  };
}

export function writeNewsHash(state) {
  const params = new URLSearchParams();
  if (state.city) params.set('city', state.city);
  if (state.topic) params.set('topic', state.topic);
  const text = params.toString();
  return `#news${text ? `&${text}` : ''}`;
}

/**
 * Headlines for one city (or every city) and one topic (or all), newest
 * first, each carrying its city. A story several cities' searches found is
 * listed once, under every city it came up for.
 */
export function filterHeadlines(file, { city = '', topic = '' } = {}) {
  const byUrl = new Map();
  for (const entry of file?.cities ?? []) {
    if (city && entry.city !== city) continue;
    for (const headline of entry.headlines ?? []) {
      if (topic && !headline.topics?.includes(topic)) continue;
      const seen = byUrl.get(headline.url);
      if (seen) {
        if (!seen.cities.includes(entry.city)) seen.cities.push(entry.city);
      } else {
        byUrl.set(headline.url, { ...headline, cities: [entry.city] });
      }
    }
  }
  return [...byUrl.values()].sort((a, b) => (b.publishedAt ?? '').localeCompare(a.publishedAt ?? ''));
}

/** How many headlines each topic has under the current city, for the chip counts. */
export function topicCounts(file, city = '') {
  const counts = new Map((file?.topics ?? []).map((t) => [t, 0]));
  for (const headline of filterHeadlines(file, { city })) {
    for (const topic of headline.topics ?? []) if (counts.has(topic)) counts.set(topic, counts.get(topic) + 1);
  }
  return counts;
}

/** "Today", "Yesterday", "3 days ago", then a short date. */
export function newsDate(iso, now = new Date()) {
  if (!iso) return '';
  const then = new Date(iso);
  if (Number.isNaN(then.getTime())) return '';
  const day = (d) => Date.UTC(d.getFullYear(), d.getMonth(), d.getDate());
  const days = Math.round((day(now) - day(then)) / 86_400_000);
  if (days <= 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days < 7) return `${days} days ago`;
  return then.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}
