// career-view.js — draws the Career tab. The rules live in career.js.
//
// Six tools, picked by chips and saved in the hash (#career&tool=titles):
// an interview brief on one firm, the title decoder, skills in demand, the
// brokerages sponsoring new agents, what's being built near a campus, and a
// driving tour of a market's new projects. They read the job feed (growth.js
// holds it), the market data (markets-view.js loads it), news.json and
// career/sponsors.json.
import {
  briefFirms,
  buildBrief,
  CAMPUSES,
  CAREER_TOOLS,
  decodeTitle,
  readCareerHash,
  skillDemand,
  SKILL_LABELS,
  sponsorRows,
  titleRows,
  tourMiles,
  tourStops,
  tourUrl,
  writeCareerHash,
  nearCampus
} from './career.js';
import { CENTERS } from './devmap.js';
import { firmJobsHref, growthJobs } from './growth.js';
import { money } from './insights-view.js';
import { marketSnapshot } from './markets-view.js';

const $ = (id) => document.getElementById(id);
const MARKETS = Object.keys(CENTERS);

let state = null;
let bound = false;
let news = null;
let sponsors = null;

export function startCareer() {
  if (bound) return;
  bound = true;
  window.addEventListener('hashchange', show);
  // The feed and the market data load on their own; a view drawn before they arrived redraws.
  window.addEventListener('terra-jobs', () => state && !$('career-view').hidden && render());
  show();
}

function update(change) {
  state = { ...state, ...change };
  history.replaceState(null, '', `${location.pathname}${location.search}${writeCareerHash(state)}`);
  render();
}

function show() {
  const next = readCareerHash(location.hash);
  $('career-view').hidden = !next.open;
  if (!next.open) return;
  const same = state && ['tool', 'city', 'firm', 'campus'].every((k) => state[k] === next[k]);
  state = next;
  if (!same) render();
}

function fetchJson(path) {
  return fetch(path, { cache: 'no-cache' }).then((r) => (r.ok ? r.json() : null)).catch(() => null);
}

/** What every tool may need, loaded once and in parallel. */
async function data() {
  news ??= fetchJson('news.json');
  sponsors ??= fetchJson('career/sponsors.json');
  const [market, newsFile, sponsorFile] = await Promise.all([marketSnapshot().catch(() => null), news, sponsors]);
  return { jobs: growthJobs(), market, news: newsFile, sponsors: sponsorFile };
}

let drawing = 0;
async function render() {
  const run = ++drawing;
  $('c-tools').replaceChildren(
    ...CAREER_TOOLS.map(([key, label]) => {
      const a = el('a', 'chip', label);
      a.href = writeCareerHash({ tool: key, city: state.city });
      if (key === state.tool) a.setAttribute('aria-current', 'page');
      return a;
    })
  );
  const city = $('c-city');
  if (!city.options.length) {
    city.append(new Option('All markets', ''), ...MARKETS.map((m) => new Option(m, m)));
    city.addEventListener('change', () => update({ city: city.value }));
  }
  city.value = MARKETS.includes(state.city) ? state.city : '';
  // The brief and the campus view pick a firm or a school instead of a market.
  $('c-city-label').parentElement.hidden = state.tool === 'brief' || state.tool === 'campus';
  $('c-blurb').textContent = BLURBS[state.tool];
  $('c-body').replaceChildren(el('div', 'state', 'Loading…'));
  const input = await data();
  if (run !== drawing) return;
  const view = VIEWS[state.tool](input);
  $('c-body').replaceChildren(view);
}

const BLURBS = {
  brief: 'Pick a firm before an interview or coffee chat: what it is building, what the news says, and questions worth asking.',
  titles: 'What the entry-level titles in Texas CRE actually do day to day, what they pay, and where they lead.',
  skills: 'Which skills this month\'s Texas postings ask for, by sector, so you know what to learn next.',
  sponsors: 'Brokerages licensing the most new sales agents: the firms that take on and train beginners.',
  campus: 'Projects going up within a short drive of your school, and the firms behind them.',
  tour: 'A driving route through a market\'s biggest new projects, to learn the market before an interview.'
};

const VIEWS = { brief: briefView, titles: titlesView, skills: skillsView, sponsors: sponsorsView, campus: campusView, tour: tourView };

const noJobs = () => el('div', 'state', 'The job list is still loading. If you are signed out, sign in first.');

/* ------------------------------------------------------------ Interview brief */

function briefView({ jobs, market, news: newsFile, sponsors: sponsorFile }) {
  const frag = document.createDocumentFragment();
  if (!jobs.length) return noJobs();
  const firms = briefFirms(jobs);
  const pick = el('label', 'career-pick');
  pick.append(el('span', 'eyebrow', 'FIRM'));
  const select = el('select');
  select.append(new Option('Pick a firm…', ''), ...firms.map((f) => new Option(`${f.firm} (${f.jobs})`, f.firm)));
  select.value = state.firm;
  select.addEventListener('change', () => update({ firm: select.value }));
  pick.append(select);
  frag.append(pick);
  if (!state.firm) {
    frag.append(el('div', 'state', 'Pick a firm above, or open a job and choose "Interview brief".'));
    return frag;
  }
  const b = buildBrief(state.firm, {
    jobs,
    projects: market?.developments?.projects ?? [],
    news: newsFile,
    zoning: market?.zoning,
    salaries: market?.salaries,
    sponsors: sponsorFile
  });

  const head = el('section', 'compare-block brief-head');
  head.append(el('h3', 'group-title', b.firm));
  head.append(el('p', 'dev-meta', [b.sector, b.cities.join(', '), `${b.jobs.length} open on Terra`].filter(Boolean).join(' · ')));
  const actions = el('div', 'brief-actions');
  const jobsLink = el('a', 'secondary', 'See its jobs');
  jobsLink.href = firmJobsHref(b.firm, location.pathname);
  const print = el('button', 'secondary', 'Print or save as PDF');
  print.type = 'button';
  print.addEventListener('click', () => window.print());
  actions.append(jobsLink, print);
  head.append(actions);
  frag.append(head);

  const points = section('Talking points');
  if (b.points.length) points.append(list(b.points));
  else points.append(el('p', 'group-blurb', `Terra has no projects, headlines or zoning cases that name ${b.firm} yet. Start from its own website and recent press releases.`));
  frag.append(points);

  const ask = section('Questions to ask');
  ask.append(list(b.questions));
  frag.append(ask);

  if (b.projects.length) {
    const s = section(`Projects (${b.projects.length})`, 'State construction filings (TDLR TABS) and city permits that name the firm.');
    const ul = el('ul', 'growth-projects');
    for (const p of b.projects.slice(0, 8)) {
      const li = el('li');
      li.append(link(p.url, p.facility || p.name), el('span', 'dev-meta', [p.roles.join(', '), p.place || p.city, p.work, money(p.cost), p.status].filter(Boolean).join(' · ')));
      ul.append(li);
    }
    if (b.projects.length > 8) ul.append(el('li', 'dev-meta', `and ${b.projects.length - 8} more`));
    s.append(ul);
    frag.append(s);
  }
  if (b.headlines.length) {
    const s = section('In the news');
    const ul = el('ul', 'growth-projects');
    for (const h of b.headlines) {
      const li = el('li');
      li.append(link(h.url, h.title), el('span', 'dev-meta', [h.source, h.publishedAt?.slice(0, 10)].filter(Boolean).join(' · ')));
      ul.append(li);
    }
    s.append(ul);
    frag.append(s);
  }
  if (b.cases.length) {
    const s = section('On zoning agendas');
    const ul = el('ul', 'growth-projects');
    for (const c of b.cases) {
      const li = el('li');
      li.append(c.url ? link(c.url, c.title) : el('span', '', c.title), el('span', 'dev-meta', `${c.place} · ${c.body} · ${c.date}`));
      ul.append(li);
    }
    s.append(ul);
    frag.append(s);
  }
  if (b.pay.length) {
    const s = section('What it has offered', 'Pay on its H-1B visa filings with the Labor Department: real offers, though only for visa hires.');
    const ul = el('ul', 'growth-projects');
    for (const row of b.pay) {
      const li = el('li');
      li.append(el('span', '', `${row.title}: ${dollars(row.median)}`), el('span', 'dev-meta', `${row.city} · ${row.filings} filing${row.filings === 1 ? '' : 's'}`));
      ul.append(li);
    }
    s.append(ul);
    frag.append(s);
  }
  const s = section('Open roles');
  const ul = el('ul', 'growth-projects');
  for (const job of b.jobs.slice(0, 10)) {
    const li = el('li');
    const a = el('a', 'link', job.role);
    a.href = `${location.pathname}?${new URLSearchParams({ job: job.id })}`;
    li.append(a, el('span', 'dev-meta', [job.city, decodeTitle(job.role)?.title].filter(Boolean).join(' · ')));
    ul.append(li);
  }
  s.append(ul);
  frag.append(s);
  frag.append(el('p', 'market-asof', 'Matched by company name. Projects often sit under a one-off LLC, so a firm can be doing more than shows here.'));
  return frag;
}

/* ------------------------------------------------------------ Title decoder */

function titlesView({ jobs, market }) {
  const frag = document.createDocumentFragment();
  const rows = titleRows(jobs, market?.salaries, state.city);
  const grid = el('div', 'title-grid');
  for (const row of rows) {
    const card = el('article', 'card title-card');
    card.append(el('h3', 'title-name', row.title));
    card.append(el('p', 'title-does', row.does));
    const facts = el('dl', 'title-facts');
    const pay = row.pay.entry ?? row.pay.median;
    fact(facts, 'Pay', pay ? `about ${dollars(pay)}${row.pay.entry ? ' entry level' : ''}` : 'not enough filings');
    fact(facts, 'Open now', row.jobs.length ? `${row.jobs.length} on Terra${state.city ? ` in ${state.city}` : ''}` : 'none right now');
    fact(facts, 'Leads to', row.next.join(' · '));
    card.append(facts);
    card.append(el('p', 'eyebrow', 'A TYPICAL WEEK'));
    card.append(list(row.day));
    const tags = el('div', 'title-skills');
    for (const key of row.skills) tags.append(el('span', 'badge', SKILL_LABELS[key] ?? key));
    card.append(tags);
    if (row.jobs.length) {
      const a = el('a', 'link', `See ${row.jobs.length === 1 ? 'the opening' : `the ${row.jobs.length} openings`} →`);
      a.href = `${location.pathname}?${new URLSearchParams({ sector: row.sectors[0], ...(state.city ? { city: state.city } : {}) })}`;
      card.append(a);
    }
    grid.append(card);
  }
  frag.append(grid);
  frag.append(el('p', 'market-asof', 'Pay is the median offer on Labor Department H-1B filings at Texas CRE employers for the matching title family (Salary check on Market data), weighted across markets. Visa hires only, so treat it as a ballpark.'));
  return frag;
}

/* ------------------------------------------------------------ Skills in demand */

function skillsView({ jobs }) {
  const frag = document.createDocumentFragment();
  if (!jobs.length) return noJobs();
  const demand = skillDemand(jobs, state.city);
  if (!demand.rows.length) return el('div', 'state', `No postings${state.city ? ` in ${state.city}` : ''} name a skill Terra tracks right now.`);

  const top = section('Most asked for', `Share of the ${demand.total} open postings${state.city ? ` in ${state.city}` : ''} that name each skill.`);
  const bars = el('ol', 'skill-bars');
  for (const row of demand.rows) {
    const li = el('li');
    const bar = el('span', 'skill-bar');
    bar.style.setProperty('--w', `${Math.max(2, Math.round(row.share * 100))}%`);
    li.append(el('span', 'skill-name', row.label), bar, el('span', 'skill-pct', `${Math.round(row.share * 100)}%`));
    li.title = `${row.count} of ${demand.total} postings`;
    bars.append(li);
  }
  top.append(bars);
  frag.append(top);

  if (demand.sectors.length > 1) {
    const s = section('By sector', 'Darker means more of that sector\'s postings ask for the skill.');
    const wrap = el('div', 'table-wrap');
    const table = el('table', 'market-table heat-table');
    const thead = el('thead');
    const head = el('tr');
    head.append(th('Skill', 'city-col'));
    for (const sector of demand.sectors) head.append(th(`${sector.sector} (${sector.jobs})`, 'num'));
    thead.append(head);
    const body = el('tbody');
    for (const row of demand.rows) {
      const tr = el('tr');
      const name = el('th', 'city-col', row.label);
      name.scope = 'row';
      tr.append(name);
      for (const cell of row.cells) {
        const td = el('td', 'num heat', cell.count ? `${Math.round(cell.share * 100)}%` : '');
        td.style.setProperty('--heat', String(Math.round(cell.share * 100) / 100));
        td.title = `${cell.count} ${cell.sector} postings`;
        tr.append(td);
      }
      body.append(tr);
    }
    table.append(thead, body);
    wrap.append(table);
    s.append(wrap);
    frag.append(s);
  }
  frag.append(el('p', 'market-asof', 'Read from each posting\'s title, description and requirements with the same skill list the resume matcher uses. Updated every two hours with the feed.'));
  return frag;
}

/* ------------------------------------------------------------ New-agent sponsors */

function sponsorsView({ sponsors: file }) {
  const frag = document.createDocumentFragment();
  if (!file?.brokers?.length) return el('div', 'state', 'The licensing list is being built. Check back after the next weekly update.');
  const search = el('input', 'career-search');
  search.type = 'search';
  search.placeholder = 'Search brokerages';
  search.setAttribute('aria-label', 'Search brokerages');
  frag.append(search);
  const ol = el('ol', 'growth-list sponsor-list');
  const draw = () => {
    const rows = sponsorRows(file, state.city, search.value).slice(0, 40);
    ol.replaceChildren(
      ...rows.map((b) => {
        const li = el('li');
        li.append(
          el('span', 'growth-firm', b.name),
          el('span', 'dev-meta', `${b.newAgents} new agent${b.newAgents === 1 ? '' : 's'} in ${file.windowLabel} · ${b.agents} sponsored in all · ${b.place}`)
        );
        return li;
      })
    );
    if (!rows.length) ol.append(el('li', 'dev-meta', 'No brokerage matches.'));
  };
  search.addEventListener('input', draw);
  draw();
  frag.append(ol);
  frag.append(
    el(
      'p',
      'market-asof',
      `From the Texas Real Estate Commission's public license holder file (${file.asOf}). Counts sales agents whose first license was issued in ${file.windowLabel} and who are sponsored by each brokerage. Only brokerage names and counts are shown, never the agents.`
    )
  );
  return frag;
}

/* ------------------------------------------------------------ Near campus */

function campusView({ jobs, market }) {
  const frag = document.createDocumentFragment();
  const pick = el('label', 'career-pick');
  pick.append(el('span', 'eyebrow', 'SCHOOL'));
  const select = el('select');
  select.append(new Option('Pick your school…', ''), ...CAMPUSES.map((c) => new Option(`${c.name} (${c.city})`, c.key)));
  select.value = state.campus;
  select.addEventListener('change', () => update({ campus: select.value }));
  pick.append(select);
  frag.append(pick);
  const campus = CAMPUSES.find((c) => c.key === state.campus);
  if (!campus) {
    frag.append(el('div', 'state', 'Pick your school to see what is being built nearby.'));
    return frag;
  }
  const projects = market?.developments?.projects;
  if (!projects) return frag.append(el('div', 'state', 'The development maps are still loading.')), frag;
  const radius = 10;
  const near = nearCampus(projects, jobs, campus, radius);
  if (!near.projects.length) {
    frag.append(el('div', 'state', `No private projects within ${radius} miles of ${campus.name} are on the map right now.`));
    return frag;
  }
  const firms = section(`Firms building near ${campus.name}`, `Owners, tenants, architects and contractors on ${near.projects.length} projects within ${radius} miles. Firms with jobs on Terra come first. The rest are good cold-email targets: you can say you have watched their project go up.`);
  const ol = el('ol', 'growth-list');
  for (const f of near.firms.slice(0, 25)) {
    const li = el('li');
    li.append(el('span', 'growth-firm', f.name), el('span', 'dev-meta', `${f.roles.join(', ')} · ${f.projects.length} project${f.projects.length === 1 ? '' : 's'}${f.cost ? ` · ${money(f.cost)}` : ''}`));
    if (f.jobs.length) {
      const a = el('a', 'link', `${f.jobs.length} open job${f.jobs.length === 1 ? '' : 's'} →`);
      a.href = firmJobsHref(f.jobs[0].firm, location.pathname);
      li.append(a);
    }
    ol.append(li);
  }
  firms.append(ol);
  frag.append(firms);
  const list2 = section('Closest projects');
  const ul = el('ul', 'growth-projects');
  for (const p of near.projects.slice(0, 12)) {
    const li = el('li');
    li.append(link(p.url, p.facility || p.name), el('span', 'dev-meta', [`${p.miles.toFixed(1)} mi`, p.owner, p.work, money(p.cost), p.status].filter(Boolean).join(' · ')));
    ul.append(li);
  }
  list2.append(ul);
  const tour = el('a', 'secondary', 'Make it a driving tour');
  tour.href = writeCareerHash({ tool: 'tour', city: campus.city, campus: campus.key });
  list2.append(tour);
  frag.append(list2);
  return frag;
}

/* ------------------------------------------------------------ Market tour */

function tourView({ market }) {
  const frag = document.createDocumentFragment();
  const city = state.city || CAMPUSES.find((c) => c.key === state.campus)?.city || 'Dallas';
  if (!state.city) $('c-city').value = city;
  const projects = market?.developments?.projects;
  if (!projects) return el('div', 'state', 'The development maps are still loading.');
  const campus = CAMPUSES.find((c) => c.key === state.campus && c.city === city);
  const [lat, lng] = CENTERS[city];
  const start = campus ? { lat: campus.lat, lng: campus.lng } : { lat, lng };
  const stops = tourStops(projects, city, start);
  if (!stops.length) {
    frag.append(el('div', 'state', `No private projects with street addresses are on the ${city} map right now.`));
    return frag;
  }
  const head = section(`${city}: ${stops.length} stops, about ${tourMiles(stops)} miles`, `Starting from ${campus ? campus.name : `downtown ${city}`}. The biggest private projects on the development map with street addresses, in driving order. View from the street; job sites are private property.`);
  const go = el('a', 'primary', 'Open the route in Google Maps');
  go.href = tourUrl(start, stops);
  go.target = '_blank';
  go.rel = 'noopener noreferrer';
  head.append(go);
  frag.append(head);
  const ol = el('ol', 'tour-stops');
  stops.forEach((p) => {
    const li = el('li', 'card tour-stop');
    li.append(el('h4', 'tour-name', p.facility || p.name));
    li.append(el('p', 'dev-meta', [p.address, `${p.leg.toFixed(1)} mi from the last stop`].filter(Boolean).join(' · ')));
    const facts = [p.work, p.squareFeet ? `${p.squareFeet.toLocaleString()} sq ft` : '', money(p.cost), p.status].filter((x) => x && x !== '—');
    li.append(el('p', '', facts.join(' · ')));
    const who = [p.owner && `Owner: ${p.owner}`, p.tenant && `Tenant: ${p.tenant}`, p.designFirm && `Architect: ${p.designFirm}`, p.contractor && `Contractor: ${p.contractor}`].filter(Boolean);
    if (who.length) li.append(el('p', 'dev-meta', who.join(' · ')));
    if (p.scope) li.append(el('p', 'tour-scope', p.scope.length > 220 ? `${p.scope.slice(0, 220)}…` : p.scope));
    li.append(link(p.url, 'Filing ↗'));
    ol.append(li);
  });
  frag.append(ol);
  return frag;
}

/* ------------------------------------------------------------ Helpers */

function section(title, blurb) {
  const s = el('section', 'compare-block');
  s.append(el('h3', 'group-title', title));
  if (blurb) s.append(el('p', 'group-blurb', blurb));
  return s;
}

function list(items) {
  const ul = el('ul', 'career-list');
  for (const item of items) ul.append(el('li', '', item));
  return ul;
}

function fact(dl, label, value) {
  dl.append(el('dt', '', label), el('dd', '', value));
}

function dollars(n) {
  return `$${Math.round(n / 1000)}K`;
}

function th(text, cls = '') {
  const node = el('th', cls, text);
  node.scope = 'col';
  return node;
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
