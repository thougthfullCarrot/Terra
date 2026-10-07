// property-view.js — draws the Property tab. The rules live in property.js.
//
// Five tools, picked by chips and saved in the hash (#property&tool=drive):
// who owns a parcel, the lease radar, tax sales and delinquent accounts,
// drive-time rings, and the deal of the week. The lists come from
// site/property/*.json (backend/src/bin/export-property.ts); the owner
// lookup and the drive-time areas are asked of public services live, from the
// browser, when someone searches or picks a spot.
import { analyzeDeal, writeDeal } from './deal.js';
import { ATTRIBUTION, CENTERS, loadLeaflet, TILES } from './devmap.js';
import {
  addressWhere,
  comptrollerUrl,
  count,
  circle,
  DEAL_LOAN,
  DEAL_TYPE_LABELS,
  dealSteps,
  DRIVE_MINUTES,
  entityName,
  FALLBACK_MPH,
  filterMoves,
  saleLinks,
  filterSales,
  franchiseUrl,
  isEntity,
  isochroneUrl,
  money,
  openCorporatesUrl,
  ownerLikeWhere,
  ownerWhere,
  parcelQueryUrl,
  parseAddress,
  PROPERTY_TOOLS,
  readFranchise,
  readIsochrones,
  readPropertyHash,
  sameEntity,
  sourcesFor,
  sumInside,
  writePropertyHash
} from './property.js';

const $ = (id) => document.getElementById(id);
const MARKETS = Object.keys(CENTERS);

let state = null;
let bound = false;
const files = {};
const loading = {};
let liveMap = null;

export function startProperty() {
  if (bound) return;
  bound = true;
  window.addEventListener('hashchange', show);
  show();
}

function load(name) {
  if (files[name]) return Promise.resolve(files[name]);
  loading[name] ??= fetch(`property/${name}.json`, { cache: 'no-cache' })
    .then((response) => {
      if (response.status === 404) return null;
      if (!response.ok) throw new Error(`${name}.json returned ${response.status}`);
      return response.json();
    })
    .then((data) => (files[name] = data))
    .catch((error) => {
      loading[name] = null;
      throw error;
    });
  return loading[name];
}

function update(change, { redraw = true } = {}) {
  state = { ...state, ...change };
  history.replaceState(null, '', `${location.pathname}${location.search}${writePropertyHash(state)}`);
  if (redraw) render();
}

function show() {
  const next = readPropertyHash(location.hash);
  $('property-view').hidden = !next.open;
  if (!next.open) {
    disposeMap();
    return;
  }
  // The owner search keeps its results when only the query in the hash changed.
  const same = state && state.tool === next.tool && state.city === next.city && state.lat === next.lat && state.lng === next.lng;
  state = next;
  if (!same) render();
}

function render() {
  disposeMap();
  $('p-tools').replaceChildren(
    ...PROPERTY_TOOLS.map(([key, label]) => {
      const a = el('a', 'chip', label);
      a.href = writePropertyHash({ tool: key, city: state.city });
      if (key === state.tool) a.setAttribute('aria-current', 'page');
      return a;
    })
  );
  const city = $('p-city');
  if (!city.options.length) {
    city.append(new Option('All markets', ''), ...MARKETS.map((m) => new Option(m, m)));
    city.addEventListener('change', () => update({ city: city.value, lat: null, lng: null }));
  }
  city.value = MARKETS.includes(state.city) ? state.city : '';
  $('p-blurb').textContent = BLURBS[state.tool];
  $('p-sources').replaceChildren();
  const body = $('p-body');
  body.replaceChildren(el('div', 'state', 'Loading…'));
  const view = { owner: ownerView, leases: leasesView, distress: distressView, drive: driveView, deal: dealView }[state.tool];
  Promise.resolve(view(body))
    .catch((error) => body.replaceChildren(el('div', 'state error', `Couldn't load this tool. ${error instanceof Error ? error.message : ''}`.trim())));
}

const BLURBS = {
  owner: 'Type an address or an owner. Terra reads the county appraisal roll, then the state franchise tax record behind an LLC, and lists everything else that owner holds.',
  leases:
    "Texas doesn't publish lease dates, so this tracks the next best thing: companies building out new space (the space they leave comes back to market) and leases public companies say are ending.",
  distress: 'Properties headed to tax sale auctions, and the biggest commercial accounts behind on property taxes. Deals can show up here before they hit the market.',
  drive: 'Pick a spot on the map to see how many people live and work within a 10, 20 and 30 minute drive, the way retail and industrial site selectors compare locations.',
  deal: "One real Texas sale from this week's news, walked through step by step: the price, the income it implies, the loan and whether the debt helps the buyer."
};

// ---------------------------------------------------------------- who owns this

let ownerResults = null;

function ownerView(body) {
  const form = el('form', 'card owner-form');
  const label = el('label', 'calc-field owner-field');
  label.append(el('span', 'eyebrow', 'ADDRESS OR OWNER NAME'));
  const box = el('span', 'calc-input');
  const input = el('input');
  input.type = 'search';
  input.placeholder = 'e.g. 700 Louisiana St, or Hines';
  input.value = state.q;
  input.autocomplete = 'off';
  box.append(input);
  label.append(box);
  const button = el('button', 'primary', 'Look up');
  button.type = 'submit';
  form.append(label, button);
  const results = el('div', 'owner-results');
  results.setAttribute('aria-live', 'polite');
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const q = input.value.trim();
    if (!q) return;
    update({ q }, { redraw: false });
    search(q, results);
  });
  body.replaceChildren(form, results);
  if (ownerResults && ownerResults.q === state.q) results.replaceChildren(...ownerResults.nodes);
  else if (state.q) search(state.q, results);
  $('p-sources').replaceChildren(
    note(
      'Owners and values come from the county appraisal districts: Harris (City of Houston map), Dallas (a public copy of the district roll), Tarrant, Bexar and Travis. Other counties are not covered yet. The state record is the Comptroller\'s franchise tax list on data.texas.gov. The Comptroller\'s page lists officers and the registered agent for free; the Secretary of State charges $1 a search, so Terra doesn\'t use it.'
    )
  );
}

async function queryLayer(source, where, count = 25) {
  const response = await fetch(parcelQueryUrl(source, where, count));
  if (!response.ok) throw new Error(`${source.county} County map returned ${response.status}`);
  const body = await response.json();
  if (body.error) throw new Error(body.error.message ?? `${source.county} County map error`);
  return (body.features ?? []).map((f) => ({ ...source.read(f.attributes ?? {}), source }));
}

async function search(q, results) {
  results.replaceChildren(el('div', 'state', 'Searching the appraisal rolls…'));
  const byAddress = Boolean(parseAddress(q));
  const found = [];
  const failed = [];
  for (const source of sourcesFor(state.city)) {
    const where = byAddress ? addressWhere(source, q) : ownerLikeWhere(source, q);
    if (!where) continue;
    try {
      found.push(...(await queryLayer(source, where, byAddress ? 10 : 40)));
    } catch {
      failed.push(source.county);
    }
    // An address belongs to one county: stop at the first that has it.
    if (byAddress && found.length) break;
  }
  const nodes = [];
  if (!found.length) {
    nodes.push(
      el(
        'div',
        'state',
        byAddress
          ? `No parcel at "${q}" in the covered counties. Try the street number and name only (like 700 Louisiana), or pick the market above.`
          : `No owner matching "${q}". Owner names are as the county records them, often with LLC or LP at the end.`
      )
    );
  } else if (found.length === 1) {
    nodes.push(...(await parcelDetail(found[0])));
  } else {
    nodes.push(el('p', 'market-asof', `${found.length} parcels match. Pick one.`), parcelTable(found, results));
  }
  if (failed.length) nodes.push(el('p', 'calc-note', `${failed.join(', ')} County didn't answer; try again in a minute.`));
  ownerResults = { q, nodes };
  if (results.isConnected) results.replaceChildren(...nodes);
}

function parcelTable(parcels, results) {
  const wrap = el('div', 'table-wrap');
  const table = el('table', 'market-table');
  const head = el('tr');
  for (const [text, cls] of [['Property', 'city-col'], ['Owner', ''], ['Value', 'num']]) head.append(th(text, cls));
  const thead = el('thead');
  thead.append(head);
  const tbody = el('tbody');
  for (const parcel of parcels) {
    const tr = el('tr');
    const name = el('th', 'city-col');
    name.scope = 'row';
    const pick = el('button', 'link owner-pick', parcel.address || `Account ${parcel.account}`);
    pick.type = 'button';
    pick.addEventListener('click', async () => {
      results.replaceChildren(el('div', 'state', 'Loading…'));
      const nodes = await parcelDetail(parcel);
      ownerResults = { q: state.q, nodes };
      results.replaceChildren(...nodes);
    });
    name.append(pick, el('span', 'metro', `${parcel.source.county} County${parcel.code ? ` · ${parcel.code}` : ''}`));
    tr.append(name, el('td', '', parcel.owner || '—'), el('td', 'num', money(parcel.value)));
    tbody.append(tr);
  }
  table.append(thead, tbody);
  wrap.append(table);
  return wrap;
}

async function parcelDetail(parcel) {
  const card = el('section', 'card owner-card');
  card.append(el('h3', 'group-title', parcel.address || `Account ${parcel.account}`));
  const facts = el('dl', 'owner-facts');
  for (const [label, value] of [
    ['Owner of record', parcel.owner],
    ['Tax bill goes to', parcel.mail],
    ['Appraised value', parcel.value ? money(parcel.value) : null],
    ['Property class', [parcel.code, parcel.use].filter(Boolean).join(' · ')],
    ['Land', parcel.landSqft ? `${Math.round(parcel.landSqft).toLocaleString('en-US')} sq ft (${(parcel.landSqft / 43560).toFixed(2)} acres)` : null],
    ['Building', parcel.buildingSqft ? `${Math.round(parcel.buildingSqft).toLocaleString('en-US')} sq ft` : null],
    ['Built', parcel.built ? String(parcel.built) : null],
    ['Owner since', parcel.acquired ? longDate(parcel.acquired) : null],
    ['County', `${parcel.source.county} · account ${parcel.account}`]
  ]) {
    if (!value) continue;
    facts.append(el('dt', '', label), el('dd', '', value));
  }
  card.append(facts);
  const row = el('p', 'dev-links');
  if (parcel.url) row.append(link('Appraisal record ↗', parcel.url));
  if (parcel.address) row.append(link('Map ↗', `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${parcel.address}, TX`)}`));
  card.append(row);

  const nodes = [card];
  if (isEntity(parcel.owner)) nodes.push(await entityCard(parcel.owner));
  else if (parcel.owner) nodes.push(note('The owner of record reads as a person, so there is no company record to follow.'));
  nodes.push(await portfolioCard(parcel));
  return nodes;
}

async function entityCard(owner) {
  const card = el('section', 'card owner-card');
  card.append(el('h3', 'group-title', 'Who is behind it'));
  let rows = [];
  try {
    const response = await fetch(franchiseUrl(owner));
    if (response.ok) rows = (await response.json()).map(readFranchise).filter(Boolean);
  } catch {
    // Shown below as "not found" with the links to search by hand.
  }
  const name = entityName(owner);
  const match = rows.find((r) => sameEntity(r.name, name)) ?? (rows.length === 1 ? rows[0] : null);
  if (match) {
    const facts = el('dl', 'owner-facts');
    for (const [label, value] of [
      ['Registered name', match.name],
      ['State mailing address', match.address],
      ['Texas taxpayer number', match.number],
      ['Secretary of State file', match.fileNumber],
      ['Formed or registered', match.since ? longDate(match.since) : null],
      ['Standing', match.active ? 'Active: may do business in Texas' : 'Not in good standing (forfeited or ended)']
    ]) {
      if (value) facts.append(el('dt', '', label), el('dd', '', value));
    }
    card.append(facts);
    const row = el('p', 'dev-links');
    row.append(link('Officers and registered agent (Comptroller) ↗', comptrollerUrl(match.number)), link('Other states (OpenCorporates) ↗', openCorporatesUrl(owner)));
    card.append(
      row,
      el(
        'p',
        'calc-note',
        "The Comptroller's page shows the people listed on the company's last public information report: its managers, officers and registered agent. A company formed outside Texas may list another LLC as its manager; follow that name the same way."
      )
    );
  } else {
    card.append(
      el('p', '', `No Texas franchise tax record matches "${name}". Out-of-state owners and some trusts and partnerships aren't on it.`),
      (() => {
        const row = el('p', 'dev-links');
        row.append(link('Search OpenCorporates ↗', openCorporatesUrl(owner)), link('Comptroller entity search ↗', 'https://comptroller.texas.gov/taxes/franchise/account-status/search'));
        return row;
      })()
    );
  }
  return card;
}

async function portfolioCard(parcel) {
  const card = el('section', 'card owner-card');
  card.append(el('h3', 'group-title', `What else this owner holds in ${parcel.source.county} County`));
  const seen = new Map();
  for (const where of [ownerWhere(parcel.source, { owner: parcel.owner }), ownerWhere(parcel.source, { mailLine: parcel.mailLine })]) {
    if (!where) continue;
    try {
      for (const p of await queryLayer(parcel.source, where, 60)) if (!seen.has(p.account)) seen.set(p.account, p);
    } catch {
      // A failed second query still leaves the first one's list.
    }
  }
  seen.delete(parcel.account);
  const others = [...seen.values()].sort((a, b) => (b.value ?? 0) - (a.value ?? 0));
  if (!others.length) {
    card.append(el('p', 'muted', 'No other parcels under this name or mailing address in this county.'));
    return card;
  }
  const total = others.reduce((sum, p) => sum + (p.value ?? 0), 0);
  card.append(
    el(
      'p',
      'market-asof',
      `${others.length}${others.length >= 60 ? '+' : ''} other parcel${others.length === 1 ? '' : 's'} worth ${money(total)} on the roll, under the same owner name or the same tax-bill address (owners often hold each building in its own LLC).`
    )
  );
  const list = el('ul', 'owner-list');
  for (const p of others.slice(0, 25)) {
    const item = el('li');
    item.append(el('span', 'site-address', p.address || `Account ${p.account}`), el('span', 'radar-line muted', [p.owner, money(p.value), p.code].filter(Boolean).join(' · ')));
    list.append(item);
  }
  card.append(list);
  return card;
}

// ---------------------------------------------------------------- lease radar

async function leasesView(body) {
  const file = await load('leases');
  if (!file) {
    body.replaceChildren(el('div', 'state', 'The lease radar is being built. Check back after the next update.'));
    return;
  }
  const moves = filterMoves(file.moves, state.city);
  const nodes = [];
  nodes.push(
    el(
      'p',
      'market-asof',
      `${moves.length} tenant build-out${moves.length === 1 ? '' : 's'} of 10,000+ sq ft registered in the last year${state.city ? ` in the ${state.city} area` : ''}, soonest move-in first.`
    )
  );
  if (moves.length) {
    const list = el('div', 'radar-list');
    for (const move of moves.slice(0, 80)) list.append(moveCard(move));
    nodes.push(list);
  } else {
    nodes.push(el('div', 'state', 'No large tenant build-outs filed here in the last year.'));
  }

  const filings = (file.filings ?? []).filter((f) => !state.city || f.city === state.city);
  const section = el('section', 'card radar-filings');
  section.append(el('h3', 'group-title', 'Leases public companies say are ending'));
  if (filings.length) {
    const list = el('ul', 'owner-list');
    for (const f of filings) {
      const item = el('li');
      const head = el('span', 'site-address', `${f.company} · ${f.city} · ends ${f.year}`);
      item.append(head, el('q', 'radar-quote', f.sentence), link(`10-K filed ${longDate(f.filed)} ↗`, f.url));
      list.append(item);
    }
    section.append(list);
  } else {
    section.append(el('p', 'muted', file.filingsNote ?? 'No 10-K filed in the last 15 months names a lease end date here.'));
  }
  nodes.push(section);
  body.replaceChildren(...nodes);
  $('p-sources').replaceChildren(
    note(
      `Build-outs: TDLR's Texas Architectural Barriers registry (TABS), which every commercial interior project over $50,000 files before work starts. The project name is usually the tenant's. Dates and costs are the filer's estimates. Lease end dates: SEC full-text search of 10-K filings. Updated ${longDate(file.generatedAt)}.`
    )
  );
}

function moveCard(move) {
  const card = el('article', 'card radar-item');
  const top = el('p', 'news-meta');
  top.append(el('span', '', move.end ? `${move.end < new Date().toISOString().slice(0, 10) ? 'Moved in' : 'Move-in'} about ${monthYear(move.end)}` : 'Move-in date not filed'), el('span', 'news-source', move.place ?? move.city));
  const title = el('h3', 'news-title', move.tenant);
  const facts = [move.squareFeet ? `${move.squareFeet.toLocaleString('en-US')} sq ft` : '', move.building, money(move.cost) + ' build-out'].filter(Boolean).join(' · ');
  card.append(top, title, el('p', 'radar-facts', facts));
  if (move.address) card.append(el('p', 'muted radar-line', move.address));
  const people = [move.landlord ? `Landlord: ${move.landlord}` : '', move.designFirm ? `Architect: ${move.designFirm}` : ''].filter(Boolean).join(' · ');
  if (people) card.append(el('p', 'muted radar-line', people));
  if (move.scope) card.append(el('p', 'dev-pop-scope', move.scope));
  const row = el('p', 'dev-links');
  row.append(link('State filing ↗', move.url));
  card.append(row);
  return card;
}

// ---------------------------------------------------------------- distress

let scheduledOnly = true;

async function distressView(body) {
  const file = await load('distress');
  if (!file) {
    body.replaceChildren(el('div', 'state', 'The distress list is being built. Check back after the next update.'));
    return;
  }
  const draw = () => {
    const sales = filterSales(file.sales, { city: state.city, scheduledOnly });
    const all = filterSales(file.sales, { city: state.city });
    const soon = all.filter((s) => s.saleDate && Date.parse(s.saleDate) - Date.now() < 45 * 86_400_000).length;
    const tiles = el('div', 'calc-results distress-tiles');
    tiles.append(
      tile('Auctions in the next 45 days', count(soon), 'Tax sales on the county steps or online'),
      tile('All tax sale listings', count(all.length), 'Including ones waiting for a sale date'),
      tile('Value of the scheduled lots', money(all.filter((s) => s.saleDate).reduce((n, s) => n + (s.value ?? 0), 0)), 'Appraisal district values')
    );
    const toggle = el('label', 'dev-toggle');
    const check = el('input');
    check.type = 'checkbox';
    check.checked = scheduledOnly;
    check.addEventListener('change', () => {
      scheduledOnly = check.checked;
      draw();
    });
    toggle.append(check, ' Only properties with an auction date');
    const nodes = [tiles, toggle];
    if (sales.length) nodes.push(salesTable(sales.slice(0, 150)));
    else nodes.push(el('div', 'state', state.city ? `No tax sale listings for the ${state.city} area.` : 'No tax sale listings right now.'));
    if (sales.length > 150) nodes.push(el('p', 'calc-note', `Showing the first 150 of ${sales.length}.`));
    const delinquent = file.delinquent;
    if (delinquent?.accounts?.length && (!state.city || ['Houston', 'Galveston'].includes(state.city))) nodes.push(delinquentCard(delinquent));
    body.replaceChildren(...nodes);
  };
  draw();
  const covered = Object.entries(file.counties ?? {})
    .map(([city, counties]) => `${city} (${counties.join(', ')})`)
    .join('; ');
  $('p-sources').replaceChildren(
    note(
      `Tax sales: Linebarger Goggan Blair & Sampson's public tax sale list, which covers ${covered || 'most big Texas counties'}. Travis, Comal, Lubbock and Collin counties use other firms and are not included. A minimum bid is what the county will accept; buyers take the property subject to redemption rights and any other liens, so check the county's sale list before bidding. Foreclosure notices are filed as scanned documents with each county clerk, so they aren't counted. Updated ${longDate(file.generatedAt)}.`
    )
  );
}

function salesTable(sales) {
  const wrap = el('div', 'table-wrap');
  const table = el('table', 'market-table');
  const head = el('tr');
  for (const [text, cls] of [['Property', 'city-col'], ['Auction', ''], ['Value', 'num'], ['Minimum bid', 'num']]) head.append(th(text, cls));
  const thead = el('thead');
  thead.append(head);
  const tbody = el('tbody');
  for (const sale of sales) {
    const tr = el('tr');
    const name = el('th', 'city-col');
    name.scope = 'row';
    name.append(el('span', 'site-address', sale.address));
    const meta = el('span', 'metro');
    meta.append([sale.place, `${sale.county} County`].filter(Boolean).join(' · '));
    for (const l of saleLinks(sale)) meta.append(' · ', link(l.label, l.url));
    name.append(meta);
    const when = el('td', '', sale.saleDate ? longDate(sale.saleDate) : '—');
    when.append(el('span', 'metric-meta', sale.status));
    tr.append(name, when, el('td', 'num', money(sale.value)), el('td', 'num', money(sale.minimumBid)));
    tbody.append(tr);
  }
  table.append(thead, tbody);
  wrap.append(table);
  return wrap;
}

function delinquentCard(list) {
  const card = el('section', 'card');
  card.append(
    el('h3', 'group-title', `Biggest commercial tax-delinquent accounts, ${list.county} County`),
    el(
      'p',
      'group-blurb',
      `Accounts the county's collection firm is suing on, as of ${list.asOf ? longDate(list.asOf) : 'the last update'}. Owners behind on taxes are often open to selling. Names of people are left off.`
    )
  );
  const wrap = el('div', 'table-wrap');
  const table = el('table', 'market-table');
  const head = el('tr');
  for (const [text, cls] of [['Property', 'city-col'], ['Owner', ''], ['Value', 'num'], ['Taxes owed', 'num'], ['Years behind', 'num']]) head.append(th(text, cls));
  const thead = el('thead');
  thead.append(head);
  const tbody = el('tbody');
  for (const a of list.accounts.slice(0, 60)) {
    const tr = el('tr');
    const name = el('th', 'city-col');
    name.scope = 'row';
    name.append(el('span', 'site-address', a.address), el('span', 'metro', `${a.code} · account ${a.account}`));
    tr.append(name, el('td', '', a.owner ?? 'Individual'), el('td', 'num', money(a.value)), el('td', 'num', money(a.taxDue)), el('td', 'num', a.yearsDue ? String(a.yearsDue) : '—'));
    tbody.append(tr);
  }
  table.append(thead, tbody);
  wrap.append(table);
  card.append(wrap);
  return card;
}

// ---------------------------------------------------------------- drive time

async function driveView(body) {
  const city = MARKETS.includes(state.city) ? state.city : 'Houston';
  const card = el('section', 'card drive-card');
  const hint = el('p', 'group-blurb', state.lat != null ? '' : `Click or tap the map to drop a pin. Pick another market above to move the map.`);
  const mapNode = el('div', 'dev-map drive-map');
  mapNode.setAttribute('role', 'region');
  mapNode.setAttribute('aria-label', 'Map: pick a site');
  const results = el('div', 'drive-results');
  results.setAttribute('aria-live', 'polite');
  card.append(hint, mapNode, results);
  body.replaceChildren(card);
  $('p-sources').replaceChildren(
    note(
      `Drive areas: Valhalla routing on OpenStreetMap roads (FOSSGIS's free public server), at typical speeds without traffic. People: Census Bureau American Community Survey 5-year estimates. Jobs: Census LEHD workplace counts. Each census tract counts when its center is inside the area.`
    )
  );

  const [L, tracts] = await Promise.all([loadLeaflet(), load('tracts')]);
  if (!mapNode.isConnected) return;
  const map = L.map(mapNode, { scrollWheelZoom: false });
  map.attributionControl.setPrefix('<a href="https://leafletjs.com" target="_blank" rel="noopener noreferrer">Leaflet</a>');
  L.tileLayer(TILES, { maxZoom: 19, attribution: ATTRIBUTION }).addTo(map);
  liveMap = map;
  const layers = L.layerGroup().addTo(map);
  map.setView(state.lat != null ? [state.lat, state.lng] : CENTERS[city], 10);
  if (!tracts?.tracts?.length) results.append(el('p', 'calc-note', 'Population and job counts are still being built; the drive areas still draw.'));

  const pick = async (lat, lng) => {
    update({ lat, lng }, { redraw: false });
    hint.textContent = '';
    layers.clearLayers();
    L.circleMarker([lat, lng], { radius: 7, color: '#fff', weight: 2, fillColor: color('--accent', '#2b4a8b'), fillOpacity: 1 }).addTo(layers);
    results.replaceChildren(el('div', 'state', 'Drawing drive areas…'));
    let rings;
    let estimated = false;
    try {
      const response = await fetch(isochroneUrl(lat, lng));
      if (!response.ok) throw new Error(String(response.status));
      rings = readIsochrones(await response.json());
      if (!rings.length) throw new Error('no areas');
    } catch {
      estimated = true;
      rings = DRIVE_MINUTES.map((minutes) => ({ minutes, geometry: circle(lat, lng, (FALLBACK_MPH * minutes) / 60) }));
    }
    const shades = [0.32, 0.2, 0.12];
    const fill = color('--accent', '#2b4a8b');
    [...rings].reverse().forEach((ring, i) => {
      L.geoJSON(ring.geometry, { style: { color: fill, weight: 1.5, fillColor: fill, fillOpacity: shades[rings.length - 1 - i] ?? 0.1 } }).addTo(layers);
    });
    const outer = rings[rings.length - 1];
    if (outer) map.fitBounds(L.geoJSON(outer.geometry).getBounds(), { padding: [16, 16] });
    const tiles = el('div', 'calc-results drive-tiles');
    for (const ring of rings) {
      const sums = sumInside(tracts?.tracts ?? [], ring.geometry);
      const t = el('div', 'rate-tile calc-tile');
      t.append(
        el('span', 'rate-label', `${ring.minutes}-minute drive`),
        el('span', 'rate-value', tracts?.tracts?.length ? count(sums.people) : '—'),
        el('span', 'calc-note', tracts?.tracts?.length ? `people · ${count(sums.jobs)} jobs · ${sums.tracts} tracts` : 'people')
      );
      tiles.append(t);
    }
    const nodes = [tiles];
    if (estimated) nodes.push(el('p', 'calc-warning', `The routing server didn't answer, so these are straight-line circles at ${FALLBACK_MPH} mph, not road distances. Try again in a minute for real drive areas.`));
    if (tracts?.acsYear) nodes.push(el('p', 'calc-note', `People from the ${tracts.acsYear - 4}–${tracts.acsYear} survey; jobs from ${tracts.lodesYear}.`));
    results.replaceChildren(...nodes);
  };
  map.on('click', (e) => pick(e.latlng.lat, e.latlng.lng));
  if (state.lat != null) pick(state.lat, state.lng);
}

function disposeMap() {
  liveMap?.remove();
  liveMap = null;
}

// ---------------------------------------------------------------- deal of the week

async function dealView(body) {
  const file = await load('deal');
  if (!file?.deal) {
    body.replaceChildren(el('div', 'state', "This week's deal is being picked. Check back after the next update."));
    return;
  }
  const deal = file.deal;
  const steps = dealSteps(deal, file, analyzeDeal);
  const card = el('article', 'card deal-card');
  const top = el('p', 'news-meta');
  top.append(el('span', '', `Week of ${longDate(deal.week)}`), el('span', 'news-source', deal.source));
  const title = el('h3', 'deal-title');
  title.append(link(deal.title, deal.url));
  const tags = el('ul', 'chips');
  for (const t of [deal.place, DEAL_TYPE_LABELS[deal.type], deal.curated ? 'Figures checked by Terra' : '']) if (t) tags.append(el('li', '', t));
  card.append(top, title, tags);

  const list = el('ol', 'deal-steps');
  const step = (heading, ...lines) => {
    const li = el('li');
    li.append(el('h4', 'deal-step-title', heading), ...lines.filter(Boolean).map((l) => (typeof l === 'string' ? el('p', '', l) : l)));
    list.append(li);
  };
  const size = [
    steps.perSqft ? `${money(steps.perSqft)} per square foot` : '',
    steps.squareFeet ? `on about ${Math.round(steps.squareFeet).toLocaleString('en-US')} sq ft` : '',
    steps.perUnit ? `${money(steps.perUnit)} per apartment` : ''
  ]
    .filter(Boolean)
    .join(' ');
  step(
    `The price: ${money(steps.price)}`,
    size ? `That works out to ${size}. Price per foot (or per unit) is how buyers compare buildings of different sizes.` : 'The headline gives the price but not the size; the seller and broker usually announce it in the full story.'
  );
  if (steps.cap != null) {
    step(
      `The income it implies: about ${money(steps.noi)} a year`,
      steps.capKnown
        ? `The deal traded at a ${steps.cap.toFixed(2)}% cap rate, so the building's net operating income (rent minus operating costs, before the loan) is about ${money(steps.noi)} a year.`
        : `Texas doesn't make sale prices or rents public, so the income is an estimate. ${DEAL_TYPE_LABELS[deal.type]} in Texas has been trading around a ${steps.band.low}–${steps.band.high}% cap rate. At ${steps.cap}%, the buyer expects about ${money(steps.noi)} a year of net operating income. Cap rate = income ÷ price.`
    );
    const loan = steps.loan;
    step(
      `The loan: ${money(loan.amount)} at about ${steps.rate.toFixed(2)}%`,
      `A typical lender would lend around ${100 - DEAL_LOAN.down}% of the price. At ${file.treasury ? `the 10-year Treasury (${file.treasury.value.toFixed(2)}%) plus ${DEAL_LOAN.spread} points` : 'today\'s rates'}, over ${DEAL_LOAN.years} years, the payments come to ${money(loan.debtService)} a year. The income covers that ${loan.dscr ? loan.dscr.toFixed(2) : '—'} times (lenders want at least 1.25).`
    );
    const verdict =
      loan.leverage === 'positive'
        ? `Positive leverage: the property earns ${steps.cap.toFixed(2)}% while the debt costs ${loan.constant.toFixed(2)}% a year, so every dollar borrowed raises the buyer's return.`
        : loan.leverage === 'negative'
          ? `Negative leverage: the debt costs ${loan.constant.toFixed(2)}% a year but the property only earns ${steps.cap.toFixed(2)}%, so borrowing lowers the buyer's return today. Buyers accept that when they expect rents or value to grow, plan to fix up the building, or pay mostly cash.`
          : `Neutral leverage: the debt costs about what the property earns (${loan.constant.toFixed(2)}% vs ${steps.cap.toFixed(2)}%), so the return comes down to growth.`;
    step(
      `Year-one cash return: ${loan.cashOnCash == null ? '—' : `${loan.cashOnCash.toFixed(1)}%`}`,
      `The buyer puts in about ${money(loan.cashInvested)} of equity and keeps ${money(loan.cashFlow)} after the loan payments.`,
      verdict
    );
  } else {
    step('The income', 'This is a land deal: land earns no rent until something is built, so buyers price it per acre or per buildable square foot instead of by a cap rate.');
  }
  if (deal.why) step('Why it made sense', deal.why);
  card.append(list);

  if (steps.noi != null) {
    const calc = writeDeal({ price: steps.price, income: Math.round(steps.noi), vacancy: 0, expenses: 0, down: DEAL_LOAN.down, closing: DEAL_LOAN.closing, rate: steps.rate, years: DEAL_LOAN.years, city: '' });
    const row = el('p', 'dev-links');
    const a = el('a', 'link', 'Change the assumptions in the deal calculator →');
    a.href = `#markets&tool=calc&${calc}`;
    row.append(a);
    card.append(row);
  }
  card.append(
    el(
      'p',
      'calc-note',
      deal.curated
        ? 'Price and income from public reporting on this sale.'
        : 'Price from the headline; income and loan figures are Terra\'s teaching estimates from typical market cap rates, not the deal\'s actual numbers.'
    )
  );

  const nodes = [card];
  if (file.alsoThisWeek?.length) {
    const more = el('section', 'card');
    more.append(el('h3', 'group-title', 'Other Texas sales in the news this week'));
    const ul = el('ul', 'owner-list');
    for (const d of file.alsoThisWeek) {
      const li = el('li');
      li.append(link(d.title, d.url), el('span', 'radar-line muted', `${money(d.price)} · ${d.source}`));
      ul.append(li);
    }
    more.append(ul);
    nodes.push(more);
  }
  if (file.past?.length) {
    const past = el('section', 'card');
    past.append(el('h3', 'group-title', 'Past deals of the week'));
    const ul = el('ul', 'owner-list');
    for (const d of file.past) {
      const li = el('li');
      li.append(link(d.title, d.url), el('span', 'radar-line muted', `Week of ${longDate(d.week)} · ${money(d.price)}`));
      ul.append(li);
    }
    past.append(ul);
    nodes.push(past);
  }
  body.replaceChildren(...nodes);
  $('p-sources').replaceChildren(
    note(`Picked from Google News headlines that report a Texas sale with a price; the biggest of the week. The 10-year Treasury is from FRED. Updated ${longDate(file.generatedAt)}.`)
  );
}

// ---------------------------------------------------------------- helpers

function tile(label, value, sub) {
  const t = el('div', 'rate-tile calc-tile');
  t.append(el('span', 'rate-label', label), el('span', 'rate-value', value), el('span', 'calc-note', sub));
  return t;
}

function note(text) {
  return el('p', '', text);
}

function th(text, cls) {
  const node = el('th', cls, text);
  node.scope = 'col';
  return node;
}

function color(name, fallback) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
}

function longDate(iso) {
  const d = new Date(/^\d{4}-\d{2}-\d{2}$/.test(iso) ? `${iso}T12:00:00Z` : iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'America/Chicago' });
}

function monthYear(iso) {
  const d = new Date(`${iso}T12:00:00Z`);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'America/Chicago' });
}

function link(text, href) {
  const a = el('a', 'link', text);
  a.href = href;
  a.target = '_blank';
  a.rel = 'noopener noreferrer';
  return a;
}

function el(tag, cls = '', text) {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text != null) node.textContent = text;
  return node;
}
