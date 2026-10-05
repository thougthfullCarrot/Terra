// events-view.js — draws the events section. The rules live in events.js.
//
// Real estate networking and industry events by city, from events.json
// (chapter calendars, refreshed with the site). Each event links out to the
// organizer's page.
import { eventCounts, eventDate, filterEvents, groupByMonth, readEventsHash, writeEventsHash } from './events.js';

const $ = (id) => document.getElementById(id);

let file = null;
let loading = null;
let state = null;
let bound = false;

export function startEvents() {
  if (bound) return;
  bound = true;
  window.addEventListener('hashchange', show);
  show();
}

async function load() {
  const response = await fetch('events.json', { cache: 'no-cache' });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`events.json returned ${response.status}`);
  return response.json();
}

function update(change) {
  state = { ...state, ...change };
  history.replaceState(null, '', `${location.pathname}${location.search}${writeEventsHash(state)}`);
  render();
}

async function show() {
  const open = readEventsHash(location.hash, null).open;
  $('events-view').hidden = !open;
  if (!open) return;
  if (!file) {
    message('Loading events…');
    loading ??= load();
    try {
      const data = await loading;
      if (!data?.cities?.length) {
        loading = null;
        message('Events are being gathered. Check back in a few minutes.');
        return;
      }
      file = data;
    } catch (error) {
      loading = null;
      message(`Couldn't load events. ${error instanceof Error ? error.message : ''}`.trim(), true);
      return;
    }
  }
  state = readEventsHash(location.hash, file);
  render();
}

function render() {
  const now = new Date();
  const counts = eventCounts(file, now);
  $('e-cities').replaceChildren(
    chip('All', '', filterEvents(file, {}, now).length),
    ...file.cities.map((c) => chip(c.city, c.city, counts.get(c.city) ?? 0))
  );

  const events = filterEvents(file, state, now);
  $('e-count').textContent = `${events.length} upcoming ${events.length === 1 ? 'event' : 'events'}${state.city ? ` in ${state.city}` : ' across Texas'}`;

  if (!events.length) {
    message(state.city ? `No events listed yet for ${state.city}.` : 'No events listed yet.');
  } else {
    let i = 0;
    $('e-list').replaceChildren(
      ...groupByMonth(events).map((group) => {
        const section = el('section', 'events-month');
        section.append(el('h3', 'eyebrow events-month-title', group.month.toUpperCase()), ...group.events.map((e) => item(e, i++)));
        return section;
      })
    );
  }

  const updated = new Date(file.generatedAt);
  const names = (file.sources ?? []).map((s) => s.organizer).join(', ');
  $('e-sources').replaceChildren(
    el(
      'p',
      '',
      `Events from ${names || 'chapter'} calendars${
        Number.isNaN(updated.getTime()) ? '' : `, updated ${updated.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}`
      }. Each one opens on the organizer's site to register.`
    )
  );
}

function chip(label, city, count) {
  const button = el('button', `chip${count ? '' : ' empty'}`, label);
  button.type = 'button';
  button.setAttribute('aria-pressed', String(state.city === city));
  button.append(el('span', 'chip-count', String(count)));
  button.addEventListener('click', () => update({ city }));
  return button;
}

function item(event, index) {
  const card = el('article', 'card news-item event-item');
  card.style.setProperty('--i', String(Math.min(index, 20)));
  const meta = el('p', 'news-meta');
  const time = el('time', '', eventDate(event.start));
  time.dateTime = event.start;
  meta.append(time, el('span', 'news-source', event.organizer));
  const title = el('h3', 'news-title');
  const link = el('a', '', event.title);
  link.href = event.url;
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  title.append(link);
  card.append(meta, title);
  const tags = el('ul', 'chips');
  if (!state.city) tags.append(el('li', 'kind', event.city));
  if (event.venue) tags.append(el('li', '', event.venue));
  if (event.cost) tags.append(el('li', '', event.cost));
  if (tags.childElementCount) card.append(tags);
  return card;
}

function message(text, isError = false) {
  $('e-list').replaceChildren(el('div', isError ? 'state error' : 'state', text));
}

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}
