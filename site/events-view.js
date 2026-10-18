// events-view.js — draws the events section. The rules live in events.js.
//
// Real estate networking and industry events by city, from events.json
// (chapter calendars, refreshed with the site). Each event links out to the
// organizer's page.
import { stateBox } from './labels.js';
import {
  dateParts,
  eventBadges,
  eventCounts,
  eventIcs,
  eventWhen,
  marketNote,
  ONLINE,
  zoneOf,
  filterEvents,
  googleCalendarUrl,
  groupByMonth,
  monthGrid,
  readEventsHash,
  writeEventsHash
} from './events.js';

const $ = (id) => document.getElementById(id);

let file = null;
let loading = null;
let state = null;
let bound = false;
/** The month the mini calendar shows, 'YYYY-MM'; reset when the city changes. */
let calMonth = '';

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
  if ('city' in change) calMonth = '';
  state = { ...state, ...change };
  history.replaceState(null, '', `${location.pathname}${location.search}${writeEventsHash(state)}`);
  render();
}

async function show() {
  const open = readEventsHash(location.hash, null).open;
  $('events-view').hidden = !open;
  if (!open) return;
  if (!file) {
    message('Loading events…', 'loading');
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
    ...file.cities.map((c) => chip(c.city, c.city, counts.get(c.city) ?? 0)),
    chip(ONLINE, ONLINE, counts.get(ONLINE) ?? 0)
  );

  const events = filterEvents(file, state, now);
  $('e-count').textContent = `${events.length} upcoming ${events.length === 1 ? 'event' : 'events'}${state.city === ONLINE ? ' online' : state.city ? ` in ${state.city}` : ' across Texas'}`;

  drawCalendar(events);
  if (!events.length) {
    // A market whose calendars were all unreadable says so, instead of reading as a quiet month.
    const note = state.city && state.city !== ONLINE ? marketNote(file, state.city) : null;
    message(note ? note.empty : state.city === ONLINE ? 'No virtual events listed right now.' : 'No events listed yet.');
  } else {
    let i = 0;
    $('e-list').replaceChildren(
      ...groupByMonth(events).map((group) => {
        const section = el('section', 'events-month');
        section.append(el('h3', 'eyebrow events-month-title', group.month), ...group.events.map((e) => item(e, i++)));
        return section;
      })
    );
  }

  const updated = new Date(file.generatedAt);
  const names = (file.sources ?? []).filter((s) => s.url).map((s) => s.organizer).join(', ');
  $('e-sources').replaceChildren(
    el(
      'p',
      '',
      `Events from ${names || 'chapter'} calendars${
        Number.isNaN(updated.getTime()) ? '' : `, updated ${updated.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}`
      }. Each one opens on the organizer's site to register. Times are the venue's local time.`
    ),
    reportDetails()
  );
}

/** "Collection report": per market, calendars read, failures and the last good read. */
function reportDetails() {
  const rows = file.report ?? [];
  const box = el('details', 'events-report');
  if (!rows.length) return box;
  box.append(el('summary', '', 'Collection report'));
  const list = el('ul', 'events-report-list');
  const fmt = (iso) => (iso ? new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : 'never');
  for (const r of rows) {
    const verdict = r.state === 'no-sources' ? 'no readable calendar yet' : r.state === 'unreadable' ? 'calendars could not be read' : r.state === 'none-found' ? 'no upcoming events found' : `${r.upcoming} upcoming`;
    const li = el('li', `report-${r.state}`);
    li.append(el('b', '', r.city), el('span', '', ` · ${verdict} · ${r.sourcesOk}/${r.sourcesChecked} calendars read${r.duplicatesRemoved ? ` · ${r.duplicatesRemoved} duplicates merged` : ''} · last verified ${fmt(r.lastVerifiedAt)}`));
    list.append(li);
  }
  box.append(list);
  return box;
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
  const card = el('article', 'card event-card');
  card.style.setProperty('--i', String(Math.min(index, 20)));
  const parts = dateParts(event.start, zoneOf(event));
  if (parts) card.dataset.day = parts.ymd;

  const block = el('time', 'date-block');
  block.dateTime = event.start;
  if (parts) block.append(el('small', '', parts.month), el('b', '', parts.day), el('span', '', parts.weekday));

  const body = el('div', 'event-body');
  const title = el('h3', 'event-title');
  if (event.url) {
    const link = el('a', '', event.title);
    link.href = event.url;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    title.append(link);
  } else {
    title.textContent = event.title;
  }
  if (event.status === 'cancelled') card.classList.add('is-cancelled');
  // The time (the date is in the block), then where.
  const when = eventWhen(event);
  const place = event.format === 'virtual' ? 'Online' : event.venue || 'Venue not listed';
  const where = [place, state.city && state.city !== ONLINE ? '' : event.format === 'virtual' ? '' : event.city].filter(Boolean).join(', ');
  body.append(title, el('p', 'event-where', [when, where].filter(Boolean).join(' · ')));
  if (event.address && event.format !== 'virtual') body.append(el('p', 'event-address', event.address));
  const tags = el('div', 'event-tags');
  const org = el('span', 'chip org', event.organizer);
  org.prepend(el('i'));
  tags.append(org);
  for (const b of eventBadges(event)) {
    const tag = el('span', `chip badge-${b.kind}`, b.text);
    if (b.title) tag.title = b.title;
    tags.append(tag);
  }
  body.append(tags);
  // What a reader must know before going: deadline, a move, and how fresh the listing is.
  const notes = [];
  if (event.registrationDeadline) notes.push(`Register by ${new Date(event.registrationDeadline).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: zoneOf(event) })}`);
  if (event.rescheduledFrom) notes.push(`Moved from ${new Date(event.rescheduledFrom).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: zoneOf(event) })}`);
  if (event.stale && event.verifiedAt) notes.push(`Calendar unreachable; last verified ${new Date(event.verifiedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`);
  if (notes.length) body.append(el('p', 'event-notes', notes.join(' · ')));

  const actions = el('div', 'event-actions');
  const add = el('button', 'secondary sm', 'Add to calendar');
  add.type = 'button';
  add.title = 'Download an .ics file for Apple Calendar, Outlook or Google';
  add.addEventListener('click', () => download(event));
  const google = el('a', 'link sm', 'Google Calendar');
  google.href = googleCalendarUrl(event);
  google.target = '_blank';
  google.rel = 'noopener noreferrer';
  if (event.registrationUrl && event.status !== 'cancelled') {
    const reg = el('a', 'link sm', 'Register');
    reg.href = event.registrationUrl;
    reg.target = '_blank';
    reg.rel = 'noopener noreferrer';
    actions.append(reg);
  }
  actions.append(add, google);

  card.append(block, body, actions);
  return card;
}

function download(event) {
  const blob = new Blob([eventIcs(event)], { type: 'text/calendar;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = el('a');
  a.href = url;
  a.download = `${String(event.title || 'event').replace(/[^\w\- ]+/g, '').trim().slice(0, 60) || 'event'}.ics`;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** The mini month calendar beside the list: days with an event are marked and jump to it. */
function drawCalendar(events) {
  const side = $('e-side');
  const day = (e) => dateParts(e.start, zoneOf(e))?.ymd;
  const months = [...new Set(events.map((e) => day(e)?.slice(0, 7)).filter(Boolean))];
  side.hidden = !months.length;
  if (!months.length) return;
  if (!months.includes(calMonth)) calMonth = months[0];
  const at = months.indexOf(calMonth);
  const inMonth = events.filter((e) => day(e)?.startsWith(calMonth));
  const today = dateParts(new Date().toISOString())?.ymd;

  const head = el('div', 'cal-head');
  const name = new Date(`${calMonth}-01T12:00:00Z`).toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });
  const prev = navButton('‹', 'Previous month with events', at > 0 ? months[at - 1] : null);
  const next = navButton('›', 'Next month with events', at < months.length - 1 ? months[at + 1] : null);
  const title = el('b', '', name);
  title.setAttribute('aria-live', 'polite');
  head.append(prev, title, next);

  const grid = el('div', 'cal-grid');
  for (const d of ['S', 'M', 'T', 'W', 'T', 'F', 'S']) grid.append(el('span', 'dow', d));
  for (const cell of monthGrid(calMonth, inMonth)) {
    if (!cell) {
      grid.append(el('span', 'off'));
      continue;
    }
    const cls = `${cell.has ? 'has' : ''}${cell.ymd === today ? ' is-today' : ''}`.trim();
    if (cell.has) {
      const button = el('button', cls, String(cell.day));
      button.type = 'button';
      const count = inMonth.filter((e) => day(e) === cell.ymd).length;
      button.setAttribute('aria-label', `${cell.ymd}: ${count} ${count === 1 ? 'event' : 'events'}`);
      button.addEventListener('click', () => {
        const target = $('e-list').querySelector(`[data-day="${cell.ymd}"]`);
        target?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        target?.classList.add('flash');
        setTimeout(() => target?.classList.remove('flash'), 1200);
      });
      grid.append(button);
    } else {
      grid.append(el('span', cls, String(cell.day)));
    }
  }
  $('e-cal').replaceChildren(head, grid, el('p', 'cal-count', `${inMonth.length} ${inMonth.length === 1 ? 'event' : 'events'} this month`));

  function navButton(text, label, month) {
    const button = el('button', 'icon-button cal-nav', text);
    button.type = 'button';
    button.setAttribute('aria-label', label);
    button.disabled = !month;
    button.addEventListener('click', () => {
      calMonth = month;
      drawCalendar(events);
    });
    return button;
  }
}

function message(text, kind = 'empty') {
  $('e-list').replaceChildren(stateBox(text, kind, { retry: kind === true }));
}

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}
