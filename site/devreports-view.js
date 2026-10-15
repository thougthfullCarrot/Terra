// devreports-view.js — beside the development map: the coverage note, the
// smaller filings list, the "Report a development" form, the member's own
// reports with their review status, and verified community reports as pins.
//
// account.js hands over a store once migration 0019 is in and the
// DEVELOPMENT_REPORTS_ENABLED variable is on; until then only the note and
// the smaller filings show.
import { LIMITS, coverageNote, matchSmaller, reportError, reportRow, reportStatus } from './devreports.js';

let store = null;
let published = [];
let mine = [];
const listeners = new Set();

/** Set or clear the report store: { list(), published(), submit(row, photo) }. */
export async function setReportStore(next) {
  store = next;
  published = [];
  mine = [];
  if (store) {
    [published, mine] = await Promise.all([store.published().catch(() => []), store.list().catch(() => [])]);
  }
  for (const listener of listeners) listener();
}

export const reportsOn = () => Boolean(store);
export const publishedReports = (city) => published.filter((r) => r.city === city && r.lat != null && r.lng != null);

/**
 * The section under the map. `pinMode` tells the map that its next click is a
 * dropped pin; `pick` receives it.
 */
export function reportsSection({ city, data, permits }) {
  const box = el('div', 'dev-reports');
  const metro = data?.metros?.find((m) => m.city === city);
  const smaller = matchSmaller(data?.smaller, city);
  const note = el('p', 'dev-coverage');
  note.textContent = coverageNote({ metro, smaller: smaller.length, permits, reports: publishedReports(city).length });
  box.append(note);
  const small = smaller.length ? smallerList(city, smaller) : null;
  if (small) box.append(small.node);

  const holder = el('div', 'dev-report-holder');
  box.append(holder);
  const state = { pin: null, picking: false, marker: null, onPick: null };
  const draw = () => holder.replaceChildren(...(store ? [reportForm(city, state), myReports(city)] : []));
  draw();
  // A section that left the page stops listening the next time anything changes.
  const listener = () => (box.isConnected ? draw() : listeners.delete(listener));
  listeners.add(listener);

  return {
    node: box,
    /** The map search, run on the smaller filings too: how many match (the list opens on them). */
    searchSmaller: (query) => small?.search(query) ?? 0,
    /** Whether a map click should drop the report pin. */
    picking: () => state.picking,
    pick(latlng) {
      state.pin = { lat: latlng.lat, lng: latlng.lng };
      state.picking = false;
      state.onPick?.();
    }
  };
}

function smallerList(city, all) {
  const box = el('details', 'dev-smaller');
  box.append(el('summary', '', `Smaller filings (${all.length.toLocaleString('en-US')}, no pins)`));
  const search = el('input', 'dev-smaller-search');
  search.type = 'search';
  search.placeholder = 'Search smaller filings';
  search.setAttribute('aria-label', `Search ${city} smaller filings`);
  const list = el('ol', 'dev-smaller-list');
  const draw = () => {
    const shown = matchSmaller(all, city, search.value).slice(0, 200);
    list.replaceChildren(
      ...shown.map((s) => {
        const item = el('li', 'dev-item');
        const link = el('a', 'dev-name', s.name);
        link.href = s.url;
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        item.append(link, el('span', 'dev-meta', [s.place, `$${s.cost.toLocaleString('en-US')}`, s.work, s.status].filter(Boolean).join(' · ')));
        return item;
      })
    );
  };
  search.addEventListener('input', draw);
  draw();
  const node = box;
  const searchFrom = (query) => {
    search.value = query;
    draw();
    return query.trim() ? matchSmaller(all, city, query).length : 0;
  };
  box.append(
    el('p', 'dev-meta', 'Below the map cutoff, from the same state search. The state search is not read in full below the cutoff, so some smaller filings are missing here too.'),
    search,
    list
  );
  return { node, search: searchFrom };
}

function reportForm(city, state) {
  const wrap = el('details', 'dev-report');
  wrap.append(el('summary', 'chip', 'Report a development'));
  const form = el('form', 'dev-report-form');
  form.noValidate = true;
  form.append(
    el('p', 'dev-meta', `Know a ${city}-area project the map is missing? Send it in. Reports are checked before they appear, and only the project details are shown, never who sent them.`),
    field('Address', input('address', 'text', LIMITS.address, '13735 IH-10 W, San Antonio, TX')),
  );
  const pinRow = el('div', 'dev-report-pin');
  const pinButton = el('button', 'chip', 'Drop a pin on the map');
  pinButton.type = 'button';
  const pinText = el('span', 'dev-meta', 'Or give an address above.');
  pinButton.addEventListener('click', () => {
    state.picking = !state.picking;
    pinButton.setAttribute('aria-pressed', String(state.picking));
    pinText.textContent = state.picking ? 'Click the spot on the map.' : state.pin ? pinLabel(state.pin) : 'Or give an address above.';
  });
  state.onPick = () => {
    pinButton.setAttribute('aria-pressed', 'false');
    pinText.textContent = pinLabel(state.pin);
  };
  if (state.pin) pinText.textContent = pinLabel(state.pin);
  pinRow.append(pinButton, pinText);
  const description = el('textarea');
  description.name = 'description';
  description.maxLength = LIMITS.description;
  description.rows = 3;
  description.required = true;
  const photo = input('photo', 'file');
  photo.accept = 'image/jpeg,image/png,image/webp';
  // People never see this field; bots fill it in.
  const trap = input('website', 'text');
  trap.tabIndex = -1;
  trap.autocomplete = 'off';
  const trapBox = el('div', 'dev-report-trap');
  trapBox.setAttribute('aria-hidden', 'true');
  trapBox.append(trap);
  const send = el('button', 'primary', 'Send report');
  send.type = 'submit';
  const status = el('p', 'dev-meta');
  status.setAttribute('role', 'status');
  form.append(
    pinRow,
    field('Project name (optional)', input('name', 'text', LIMITS.name)),
    field('What is being built', description),
    field('Source link (optional)', input('sourceUrl', 'url', LIMITS.url, 'https://')),
    field('Photo (optional, up to 5 MB)', photo),
    trapBox,
    send,
    status
  );
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const values = Object.fromEntries(['address', 'name', 'description', 'sourceUrl', 'website'].map((k) => [k, form.elements[k].value]));
    const result = reportRow({ ...values, pin: state.pin, photo: photo.files?.[0] ?? null }, city);
    if (result.spam) {
      status.textContent = 'Thanks, your report was sent for review.';
      form.reset();
      return;
    }
    if (result.errors.length) {
      status.textContent = result.errors.join(' ');
      return;
    }
    send.disabled = true;
    status.textContent = 'Sending…';
    try {
      const saved = await store.submit(result.row, photo.files?.[0] ?? null);
      mine = [saved, ...mine];
      state.pin = null;
      form.reset();
      status.textContent = 'Thanks, your report was sent for review.';
      for (const listener of listeners) listener();
    } catch (error) {
      status.textContent = reportError(error instanceof Error ? error.message : String(error));
    } finally {
      send.disabled = false;
    }
  });
  wrap.append(form);
  return wrap;
}

function myReports(city) {
  const own = mine.filter((r) => r.city === city);
  if (!own.length) return el('span');
  const box = el('div', 'dev-my-reports');
  box.append(el('h4', 'group-title', 'Your reports'));
  const list = el('ul', 'dev-smaller-list');
  for (const r of own) {
    const item = el('li', 'dev-item');
    item.append(
      el('span', 'dev-name', r.name || r.address || pinLabel(r)),
      el('span', `dev-meta report-${r.status}`, reportStatus(r)),
      ...(r.review_note && r.status !== 'pending' ? [el('span', 'dev-meta', r.review_note)] : [])
    );
    list.append(item);
  }
  box.append(list);
  return box;
}

/** The popup of a verified community report on the map. */
export function reportPopup(report) {
  const box = el('div', 'dev-pop');
  box.append(el('strong', '', report.name || report.address || 'Community report'), el('p', 'dev-meta', 'Community report, verified by TERRA'));
  if (report.address) box.append(el('p', 'dev-meta', report.address));
  box.append(el('p', '', report.description));
  if (report.source_url) {
    const link = el('a', '', 'Source');
    link.href = report.source_url;
    link.target = '_blank';
    link.rel = 'noopener noreferrer nofollow';
    box.append(link);
  }
  return box;
}

const pinLabel = (pin) => `Pin at ${pin.lat.toFixed(5)}, ${pin.lng.toFixed(5)}`;

function field(label, control) {
  const node = el('label', 'dev-report-field');
  node.append(el('span', '', label), control);
  return node;
}

function input(name, type, maxLength, placeholder) {
  const node = el('input');
  node.name = name;
  node.type = type;
  if (maxLength) node.maxLength = maxLength;
  if (placeholder) node.placeholder = placeholder;
  return node;
}

function el(tag, cls = '', text) {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text != null) node.textContent = text;
  return node;
}
