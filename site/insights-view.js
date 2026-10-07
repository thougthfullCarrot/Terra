// insights-view.js — three tools on the market data section, drawn from the
// snapshot markets-view.js hands over:
//
//   pay      Salary check: offers on H-1B filings at CRE employers (salaries.ts)
//   zoning   Zoning alerts: rezonings and special use permits on city agendas (zoning.ts)
//   growth   Who's hiring vs. who's building: the job feed against the development map (growth.js)
import { buildingNotHiring, firmJobsHref, growthJobs, growthRows } from './growth.js';

/* ------------------------------------------------------------ Salary check */

const LEVELS = { I: 'Entry', II: 'Qualified', III: 'Experienced', IV: 'Senior' };

/** Rows of one market (or all) matching a search, most filings first. */
export function payRows(salaries, city, query = '', family = '') {
  const words = String(query).toLowerCase().split(/\s+/).filter(Boolean);
  return (salaries?.markets ?? [])
    .filter((m) => !city || m.city === city)
    .flatMap((m) => m.rows.map((row) => ({ ...row, city: m.city })))
    .filter((row) => !family || row.family === family)
    .filter((row) => words.every((w) => `${row.employer} ${row.title}`.toLowerCase().includes(w)))
    .sort((a, b) => b.filings - a.filings || b.median - a.median);
}

export function payView(snapshot, city) {
  const salaries = snapshot.salaries;
  const frag = document.createDocumentFragment();
  if (!salaries?.markets?.length) {
    frag.append(el('div', 'state', 'Salary filings are being summarized. Check back after the next weekly update.'));
    return frag;
  }
  const markets = salaries.markets.filter((m) => !city || m.city === city);
  if (!markets.length) {
    frag.append(el('div', 'state', `No CRE salary filings in ${city} in the last two years. Try All markets.`));
    return frag;
  }

  // Pay by title family: one row per market, or the one market's families.
  const box = el('section', 'compare-block');
  box.append(el('h3', 'group-title', city ? `${city}: pay by role` : 'Pay by role and market'));
  box.append(el('p', 'group-blurb', 'Median yearly pay offered. "Entry level" is the median of jobs filed at the first two of the four Labor Department wage levels, the closest match to a 0-2 year role.'));
  const families = ['Analyst', 'Associate', 'Project / construction', 'Manager', 'Director', 'Vice president'];
  const wrap = el('div', 'table-wrap');
  const table = el('table', 'market-table pay-table');
  table.append(el('caption', 'visually-hidden', 'Median pay offered by role'));
  const head = el('tr');
  const body = el('tbody');
  if (city) {
    for (const [text, cls] of [['Role', 'city-col'], ['Median offer', 'num'], ['Entry level', 'num'], ['Filings', 'num']]) head.append(th(text, cls));
    for (const f of markets[0].families) {
      const tr = el('tr');
      const name = el('th', 'city-col', f.family);
      name.scope = 'row';
      tr.append(name, num(money(f.median)), num(f.entryMedian ? money(f.entryMedian) : '—', f.entryMedian ? `${f.entryFilings} entry-level filings` : ''), num(String(f.filings)));
      body.append(tr);
    }
  } else {
    head.append(th('Market', 'city-col'));
    for (const f of families) head.append(th(f, 'num'));
    head.append(th('Filings', 'num'));
    for (const m of markets) {
      const tr = el('tr');
      const name = el('th', 'city-col');
      name.scope = 'row';
      name.append(el('span', 'city-link', m.city));
      tr.append(name);
      for (const f of families) {
        const row = m.families.find((x) => x.family === f);
        // Two filings make a figure, not a median: say so by leaving it blank.
        tr.append(num(row && row.filings >= 3 ? money(row.median) : '—', row ? `${row.filings} filings` : ''));
      }
      tr.append(num(String(m.filings)));
      body.append(tr);
    }
  }
  const thead = el('thead');
  thead.append(head);
  table.append(thead, body);
  wrap.append(table);
  box.append(wrap);
  frag.append(box);

  // Every employer and title, searchable.
  const list = el('section', 'compare-block');
  list.append(el('h3', 'group-title', 'By firm and title'));
  const controls = el('div', 'pay-controls');
  const search = el('input', 'pay-search');
  search.type = 'search';
  search.placeholder = 'Search a firm or title (CBRE, analyst…)';
  search.setAttribute('aria-label', 'Search salary filings by firm or title');
  const pills = el('div', 'metric-pills');
  pills.setAttribute('role', 'group');
  pills.setAttribute('aria-label', 'Role');
  let family = '';
  for (const name of ['', ...families]) {
    const chip = el('button', 'chip', name || 'All roles');
    chip.type = 'button';
    chip.setAttribute('aria-pressed', String(name === family));
    chip.addEventListener('click', () => {
      family = name;
      for (const c of pills.children) c.setAttribute('aria-pressed', String(c === chip));
      draw();
    });
    pills.append(chip);
  }
  controls.append(search, pills);
  const rowsWrap = el('div', 'table-wrap');
  const note = el('p', 'pay-count');
  list.append(controls, note, rowsWrap);
  frag.append(list);

  const draw = () => {
    const rows = payRows(salaries, city, search.value, family);
    const shown = rows.slice(0, 80);
    note.textContent = rows.length ? `${rows.length} firm and title pairs${rows.length > shown.length ? `, showing the ${shown.length} with the most filings` : ''}.` : 'No filings match.';
    const t = el('table', 'market-table pay-rows');
    t.append(el('caption', 'visually-hidden', 'Pay offered by firm and job title'));
    const h = el('tr');
    for (const [text, cls] of [['Firm', 'city-col'], ['Title', ''], ...(city ? [] : [['Market', '']]), ['Median', 'num'], ['Range', 'num'], ['Level', ''], ['Filings', 'num']]) h.append(th(text, cls));
    const hd = el('thead');
    hd.append(h);
    const b = el('tbody');
    for (const row of shown) {
      const tr = el('tr');
      const firm = el('th', 'city-col', row.employer);
      firm.scope = 'row';
      tr.append(firm, el('td', '', row.title));
      if (!city) tr.append(el('td', '', row.city));
      tr.append(
        num(money(row.median)),
        num(row.low === row.high ? '' : `${money(row.low)} – ${money(row.high)}`),
        el('td', 'pay-level', row.level ? LEVELS[row.level] : ''),
        num(String(row.filings))
      );
      b.append(tr);
    }
    t.append(hd, b);
    rowsWrap.replaceChildren(t);
  };
  search.addEventListener('input', draw);
  draw();

  const source = el('p', 'market-asof');
  source.append(
    `Pay offered on certified H-1B and E-3 visa filings (Labor Condition Applications), ${salaries.period}, from the U.S. Department of Labor's `,
    link(salaries.source, 'public disclosure files'),
    '. These are real offers at named firms, but only for visa hires, and the law sets them at or above the local going rate, so treat them as a floor. Bonuses are not included. Level is the wage tier the employer filed at: Entry is the lowest of four.'
  );
  frag.append(source);
  return frag;
}

/* ------------------------------------------------------------ Zoning alerts */

/** Not covered, and why, for the note under the list. */
export const ZONING_GAPS = [
  ['Houston', 'has no zoning'],
  ['Fort Worth', "agendas moved to a site that blocks automated readers"],
  ['Lubbock', 'has no public agenda feed']
];

export function zoningCases(zoning, city, { when = 'upcoming', kind = '', today = new Date().toISOString().slice(0, 10) } = {}) {
  return (zoning?.cases ?? [])
    .filter((c) => !city || c.market === city)
    .filter((c) => (when === 'upcoming' ? c.date >= today : c.date < today))
    .filter((c) => !kind || c.kind === kind)
    .sort((a, b) => (when === 'upcoming' ? a.date.localeCompare(b.date) : b.date.localeCompare(a.date)) || a.place.localeCompare(b.place));
}

export function zoningView(snapshot, city) {
  const zoning = snapshot.zoning;
  const frag = document.createDocumentFragment();
  if (!zoning?.cases) {
    frag.append(el('div', 'state', 'Zoning agendas are being read. Check back after the next daily update.'));
    return frag;
  }
  let when = 'upcoming';
  let kind = '';
  const controls = el('div', 'zoning-controls');
  const whenPills = pillGroup('When', [['upcoming', 'Coming up'], ['recent', 'Last 30 days']], () => when, (v) => ((when = v), draw()));
  const kinds = ['', 'Rezoning', 'Planned development', 'Special use permit', 'Plan amendment', 'Variance'];
  const kindPills = pillGroup('Type', kinds.map((k) => [k, k || 'All types']), () => kind, (v) => ((kind = v), draw()));
  controls.append(whenPills, kindPills);
  const list = el('ol', 'zoning-list');
  const count = el('p', 'pay-count');
  frag.append(controls, count, list);

  const draw = () => {
    const cases = zoningCases(zoning, city, { when, kind });
    count.textContent = cases.length
      ? `${cases.length} ${cases.length === 1 ? 'case' : 'cases'} ${when === 'upcoming' ? 'on agendas coming up' : 'heard in the last 30 days'}${city ? ` in the ${city} area` : ''}.`
      : `No zoning cases ${when === 'upcoming' ? 'posted yet for the coming weeks' : 'heard in the last 30 days'}${city ? ` in the ${city} area` : ''}. Agendas are usually posted a week or two before each meeting.`;
    list.replaceChildren(
      ...cases.slice(0, 150).map((c) => {
        const li = el('li', 'zoning-item');
        const top = el('div', 'zoning-top');
        top.append(el('span', 'zoning-date', dateLabel(c.date)), el('span', 'zoning-place', `${c.place} · ${c.body}`));
        const tags = el('div', 'zoning-tags');
        tags.append(el('span', 'badge', c.kind));
        for (const use of c.uses) tags.append(el('span', 'badge zoning-use', use));
        if (c.file) tags.append(el('span', 'zoning-file', c.file));
        li.append(top, tags, el('p', 'zoning-title', c.title));
        const row = el('span', 'dev-links');
        row.append(link(c.url, 'Agenda ↗'));
        li.append(row);
        return li;
      })
    );
    for (const group of [whenPills, kindPills]) group.refresh();
  };
  draw();

  const note = el('p', 'market-asof');
  const gaps = ZONING_GAPS.filter(([place]) => !city || place === city);
  note.append(
    `From the planning commission and council agendas of ${zoning.covered?.length ?? 0} Texas cities, updated ${dateLabel(zoning.asOf.slice(0, 10))}. A rezoning or planned development is usually the first public sign of a project, months before a building permit. `,
    gaps.length ? `Not covered: ${gaps.map(([place, why]) => `${place} (${why})`).join(', ')}.` : ''
  );
  frag.append(note);
  return frag;
}

/* ------------------------------------------------------------ Hiring vs building */

export function growthView(snapshot, city) {
  const jobs = growthJobs();
  const projects = snapshot.developments?.projects ?? [];
  const frag = document.createDocumentFragment();
  if (!jobs.length) {
    frag.append(el('div', 'state', 'Open the Jobs tab first so the job list loads, then come back here.'));
    return frag;
  }
  const rows = growthRows(jobs, projects, city);
  const both = rows.filter((r) => r.projects.length);
  const hiringOnly = rows.filter((r) => !r.projects.length);
  const building = buildingNotHiring(jobs, projects, city);

  const top = el('section', 'compare-block');
  top.append(el('h3', 'group-title', 'Building and hiring'));
  top.append(el('p', 'group-blurb', 'Firms with open jobs in Terra that are also the owner, tenant or architect on projects going up in the same market. Their hiring is backed by work in the ground.'));
  if (!both.length) top.append(el('div', 'state', `No firm hiring${city ? ` in ${city}` : ''} matches a project on the development map right now.`));
  const grid = el('div', 'growth-grid');
  for (const row of both) grid.append(growthCard(row));
  top.append(grid);
  frag.append(top);

  const next = el('section', 'compare-block');
  next.append(el('h3', 'group-title', 'Building, not hiring here yet'));
  next.append(el('p', 'group-blurb', 'Private developers with the most money in projects on the map and no jobs in the feed. Growing firms hire next: these are the ones to network with or cold-email.'));
  if (!building.length) next.append(el('div', 'state', 'No developer stands out yet.'));
  const list = el('ol', 'growth-list');
  for (const row of building) {
    const li = el('li');
    const name = el('span', 'growth-firm', row.owner);
    const meta = el('span', 'dev-meta', `${row.projects.length} ${row.projects.length === 1 ? 'project' : 'projects'} · ${money(row.cost)}${city ? '' : ` · ${[...new Set(row.projects.map((p) => p.city))].join(', ')}`}`);
    const links = el('span', 'dev-links');
    links.append(link(row.projects[0].developerUrl, row.projects[0].developerDirect ? 'Website ↗' : 'Find their site ↗'));
    li.append(name, meta, el('span', 'dev-meta', row.projects.slice(0, 2).map((p) => p.name).join('; ')), links);
    list.append(li);
  }
  next.append(list);
  frag.append(next);

  const rest = el('section', 'compare-block');
  rest.append(el('h3', 'group-title', 'Hiring, nothing on the map'));
  rest.append(el('p', 'group-blurb', 'Usually brokers, lenders, property managers and homebuilders, whose work does not show up as a commercial building filing. That is normal, not a warning sign.'));
  const chips = el('div', 'growth-chips');
  for (const row of hiringOnly) {
    const a = el('a', 'chip', `${row.firm} · ${row.jobs.length}`);
    a.href = firmJobsHref(row.firm, location.pathname);
    a.title = `${row.jobs.length} open ${row.jobs.length === 1 ? 'job' : 'jobs'} at ${row.firm}`;
    chips.append(a);
  }
  rest.append(chips);
  frag.append(rest);

  frag.append(
    el(
      'p',
      'market-asof',
      'Matched by company name between the job feed and state TABS filings and city building permits. Projects often sit under a one-off LLC, so a firm can be building more than shows here; smaller firms match less often than big ones.'
    )
  );
  return frag;
}

function growthCard(row) {
  const card = el('article', 'card growth-card');
  const head = el('div', 'growth-head');
  head.append(el('span', 'growth-firm', row.firm), el('span', 'badge', row.label));
  const jobs = el('a', 'link', `${row.jobs.length} open ${row.jobs.length === 1 ? 'job' : 'jobs'} →`);
  jobs.href = firmJobsHref(row.firm, location.pathname);
  const summary = el('p', 'dev-meta', `${row.projects.length} ${row.projects.length === 1 ? 'project' : 'projects'} · ${money(row.cost)} · ${[...new Set(row.jobs.map((j) => j.city))].join(', ')}`);
  const list = el('ul', 'growth-projects');
  for (const p of row.projects.slice(0, 4)) {
    const li = el('li');
    const a = link(p.url, p.name);
    li.append(a, el('span', 'dev-meta', [p.roles.join(', '), p.place, money(p.cost), p.status].filter(Boolean).join(' · ')));
    list.append(li);
  }
  if (row.projects.length > 4) list.append(el('li', 'dev-meta', `and ${row.projects.length - 4} more on the map`));
  card.append(head, summary, list, jobs);
  return card;
}

/* ------------------------------------------------------------ Helpers */

function pillGroup(label, options, current, pick) {
  const group = el('div', 'metric-pills');
  group.setAttribute('role', 'group');
  group.setAttribute('aria-label', label);
  for (const [value, text] of options) {
    const chip = el('button', 'chip', text);
    chip.type = 'button';
    chip.dataset.value = value;
    chip.addEventListener('click', () => pick(value));
    group.append(chip);
  }
  group.refresh = () => {
    for (const chip of group.children) chip.setAttribute('aria-pressed', String(chip.dataset.value === current()));
  };
  group.refresh();
  return group;
}

export function money(value) {
  if (!(value > 0)) return '—';
  if (value >= 1e9) return `$${(value / 1e9).toFixed(1)}B`;
  if (value >= 1e7) return `$${Math.round(value / 1e6)}M`;
  if (value >= 1e6) return `$${(value / 1e6).toFixed(1)}M`;
  return `$${Math.round(value / 1e3)}K`;
}

function dateLabel(iso) {
  if (!iso) return '';
  return new Date(`${iso}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });
}

function th(text, cls = '') {
  const node = el('th', cls, text);
  node.scope = 'col';
  return node;
}

function num(text, title = '') {
  const td = el('td', 'num');
  const span = el('span', 'value', text);
  if (title) span.title = title;
  td.append(span);
  return td;
}

function link(href, text) {
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
