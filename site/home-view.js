// home-view.js — the signed-in welcome screen (#home): one card for each of
// Terra's four features, plus Profile, saved jobs and the tracker.
//
// Counts show only when they are real: the open roles from the loaded feed,
// headlines from news.json and upcoming events from events.json. A file that
// is missing or empty leaves its card without a number rather than a guess.
import { filterEvents } from './events.js';
import { countLabel } from './home.js';
import { trackerOn } from './tracker-view.js';
import { showSection } from './markets-view.js';

const $ = (id) => document.getElementById(id);

let account = null;
let counted = false;

/** Whether the hash opens the welcome screen (markets-view.js asks). */
export function homeOpen(hash = location.hash) {
  return new URLSearchParams(hash.replace(/^#/, '')).has('home');
}

/** account.js hands over its profile and tour openers once a member is in, and null on sign-out. */
export function setHomeAccount(next) {
  account = next;
  // The Home tab only exists for a signed-in member.
  $('tab-home').hidden = !next;
  showSection();
  if (!next) {
    counted = false;
    for (const id of ['home-jobs-count', 'home-news-count', 'home-events-count']) $(id).hidden = true;
  }
  draw();
}

/** app.js calls this whenever the feed is drawn, with the number of open roles. */
export function setHomeJobs(total) {
  setCount('home-jobs-count', countLabel(total, 'open role', 'listed now'));
}

export function startHome() {
  $('home-profile').addEventListener('click', () => account?.openProfile());
  $('home-tour').addEventListener('click', () => account?.openTour());
  window.addEventListener('hashchange', draw);
  draw();
}

function draw() {
  // markets-view.js shows and hides the section itself; this fills it in.
  if (!homeOpen() || !account) return;
  $('home-tracker-item').hidden = !trackerOn();
  if (!counted) {
    counted = true;
    countFiles();
  }
}

function setCount(id, text) {
  const node = $(id);
  node.textContent = text;
  node.hidden = !text;
}

async function countFiles() {
  const [news, events] = await Promise.all([readJson('news.json'), readJson('events.json')]);
  const headlines = (news?.cities ?? []).reduce((sum, city) => sum + (city.headlines?.length ?? 0), 0);
  setCount('home-news-count', countLabel(headlines, 'headline', 'in the latest update'));
  let upcoming = 0;
  try {
    upcoming = events ? filterEvents(events).length : 0;
  } catch {
    upcoming = 0;
  }
  setCount('home-events-count', countLabel(upcoming, 'upcoming event', 'listed'));
}

async function readJson(path) {
  try {
    const response = await fetch(path, { cache: 'no-cache' });
    return response.ok ? await response.json() : null;
  } catch {
    return null;
  }
}
