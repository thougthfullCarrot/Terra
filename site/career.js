// career.js — the rules behind the Career tab (career-view.js draws it):
//
//   brief     Interview brief: one firm's projects, news, zoning cases, pay and open jobs
//   titles    Title decoder: what each entry-level title does, what it pays, where it leads
//   skills    Skills in demand: which skills the feed's postings ask for, by sector
//   sponsors  New-agent sponsors: brokerages licensing the most new salespeople (TREC)
//   campus    Built near campus: projects and firms within a short drive of a university
//   tour      Market tour: a driving route through a market's biggest new projects
//
// Plus the "open a long time" and "reposted" flags on job cards (jobFlags).
// Everything here works on data the site already has; nothing is fetched.
import { rolesOn, sameFirm, significant } from './growth.js';

export const CAREER_TOOLS = [
  ['brief', 'Interview brief'],
  ['titles', 'Title decoder'],
  ['skills', 'Skills in demand'],
  ['sponsors', 'New-agent sponsors'],
  ['campus', 'Near campus'],
  ['tour', 'Market tour']
];

export function readCareerHash(hash) {
  const params = new URLSearchParams(String(hash ?? '').replace(/^#/, ''));
  const tool = params.get('tool');
  return {
    open: params.has('career'),
    tool: CAREER_TOOLS.some(([key]) => key === tool) ? tool : 'brief',
    city: params.get('city') ?? '',
    firm: params.get('firm') ?? '',
    campus: params.get('campus') ?? ''
  };
}

export function writeCareerHash(state) {
  const params = new URLSearchParams();
  if (state.tool && state.tool !== 'brief') params.set('tool', state.tool);
  for (const key of ['city', 'firm', 'campus']) if (state[key]) params.set(key, state[key]);
  const rest = params.toString();
  return `#career${rest ? `&${rest}` : ''}`;
}

const DAY = 86_400_000;
/** Open this long and a seat is probably hard to fill, or no longer being filled at all. */
export const STALE_DAYS = 60;

/**
 * Flags for one job: open a long time, or reposted. openSince and reposts come
 * from the build's history (backend/src/site/history.ts); without them the
 * board's own posted date is all there is.
 */
export function jobFlags(job, now = new Date()) {
  const flags = [];
  const since = Date.parse(job.openSince ?? job.postedAt);
  const days = Number.isFinite(since) ? Math.floor((now.getTime() - since) / DAY) : 0;
  if (days >= STALE_DAYS) {
    const months = Math.floor(days / 30);
    flags.push({
      kind: 'stale',
      label: `Open ${months}+ months`,
      hint: 'Up for a long time. It may be hard to fill, which gives you leverage, or it may already be filled. Ask the recruiter before you spend time on it.'
    });
  }
  if ((job.reposts ?? 0) >= 1) {
    flags.push({
      kind: 'repost',
      label: job.reposts === 1 ? 'Reposted' : `Reposted ${job.reposts}×`,
      hint: 'Taken down and put back up. The firm is still looking, so a direct note to the team can stand out.'
    });
  }
  return flags;
}

/* ------------------------------------------------------------ Title decoder */

/**
 * The entry-level titles in the feed, in plain words. `match` is tried against
 * the job title; `pay` names the salary check's title family (salaries.ts).
 */
export const TITLE_GUIDE = [
  {
    key: 'acq',
    title: 'Acquisitions / investment analyst',
    match: /\b(acquisitions?|investments?|capital markets|equity)\b.*\b(analyst|associate)\b|\b(analyst|associate)\b.*\b(acquisitions?|investments?)\b/i,
    sectors: ['Investment', 'Capital Markets'],
    does: 'Builds the cash flow model for buildings the firm might buy, pulls rent and sale comps, and writes the memo that goes to the investment committee.',
    day: ['Underwrite 3-5 deals a week, most of which die', 'Update the model when the broker sends new numbers', 'Tour properties with the deal lead'],
    skills: ['excel', 'modeling', 'underwriting', 'argus', 'costar'],
    pay: 'Analyst',
    next: ['Associate (2-3 years)', 'Vice president of acquisitions', 'Asset management']
  },
  {
    key: 'dev',
    title: 'Development analyst / associate',
    match: /\bdevelopment\b.*\b(analyst|associate|coordinator)\b|\b(analyst|associate)\b.*\bdevelopment\b/i,
    sectors: ['Development', 'Homebuilder', 'Affordable Housing'],
    does: 'Tracks a project from land to keys: the budget, the schedule, zoning and permits, and the draws on the construction loan.',
    day: ['Update the development budget and the pro forma', 'Sit in owner-architect-contractor meetings', 'Chase permits and city reviews'],
    skills: ['modeling', 'entitlement', 'excel', 'gis'],
    pay: 'Analyst',
    next: ['Development manager', 'Project manager', 'Land acquisitions']
  },
  {
    key: 'broker',
    title: 'Brokerage associate / analyst',
    match: /\b(broker|brokerage|leasing|sales)\b.*\b(analyst|associate|agent|runner|coordinator)\b|\b(agent|runner)\b/i,
    sectors: ['Brokerage'],
    does: 'Supports a team of brokers selling or leasing buildings: market surveys, offering memos, tour books and cold calls. Usually needs a Texas sales agent license within months.',
    day: ['Build comps and market surveys in CoStar', 'Put together marketing packages and tour books', 'Make calls to owners and tenants'],
    skills: ['costar', 'research', 'powerpoint', 'license'],
    pay: 'Associate',
    next: ['Producing broker on commission', 'Team lead', 'Capital markets']
  },
  {
    key: 'am',
    title: 'Asset management analyst',
    match: /\basset management\b|\basset manager\b|\bportfolio\b.*\banalyst\b/i,
    sectors: ['Asset Mgmt', 'Investment'],
    does: 'Owns the numbers on buildings the firm already holds: budgets against actuals, leasing decisions, refinancing and when to sell.',
    day: ['Build the monthly and quarterly reports for investors', 'Re-forecast the hold model', 'Review leases with the property team'],
    skills: ['excel', 'modeling', 'argus', 'lease', 'yardi'],
    pay: 'Analyst',
    next: ['Asset manager', 'Portfolio manager', 'Acquisitions']
  },
  {
    key: 'pm',
    title: 'Property management / leasing',
    match: /\bproperty manag|\bassistant (property|community) manager\b|\bleasing (consultant|agent|professional|specialist)\b|\bcommunity manager\b/i,
    sectors: ['Property Mgmt'],
    does: 'Runs a building day to day: tenants, rent collection, vendors, the budget and the leasing office. The fastest way to learn how buildings actually work.',
    day: ['Answer tenant requests and walk the property', 'Collect rent and chase late payers in Yardi or MRI', 'Show units and sign leases'],
    skills: ['yardi', 'mri', 'lease', 'excel'],
    pay: 'Manager',
    next: ['Property manager', 'Regional manager', 'Asset management']
  },
  {
    key: 'lending',
    title: 'Credit / lending analyst',
    match: /\b(credit|lending|loan|underwriter|underwriting|debt|mortgage)\b/i,
    sectors: ['Lending', 'Capital Markets'],
    does: 'Sizes loans on commercial property for a bank or debt fund: reads the borrower\'s numbers, stress-tests the building, and writes the credit memo.',
    day: ['Spread rent rolls and operating statements', 'Size the loan on coverage and loan-to-value', 'Write and present credit memos'],
    skills: ['underwriting', 'excel', 'modeling', 'writing'],
    pay: 'Analyst',
    next: ['Relationship manager / loan officer', 'Credit officer', 'Debt capital markets']
  },
  {
    key: 'appraisal',
    title: 'Appraisal trainee / valuation analyst',
    match: /\b(apprais|valuation)\w*/i,
    sectors: ['Appraisal', 'Property Tax'],
    does: 'Values properties with sales comps, income and cost approaches, under a certified appraiser. Trainee hours count toward the state appraiser license.',
    day: ['Inspect and photograph properties', 'Pull and adjust sales comps', 'Write sections of appraisal reports'],
    skills: ['uspap', 'research', 'excel', 'writing'],
    pay: 'Analyst',
    next: ['Certified general appraiser', 'Review appraiser', 'Valuation advisory']
  },
  {
    key: 'tax',
    title: 'Property tax consultant',
    match: /\bproperty tax\b|\btax (consultant|analyst|associate)\b/i,
    sectors: ['Property Tax'],
    does: 'Protests property tax values for building owners with the appraisal districts. Texas has one of the busiest protest seasons in the country (spring into summer).',
    day: ['Compare the district\'s value to sales and income evidence', 'Prepare evidence packets', 'Argue cases at informal and panel hearings'],
    skills: ['research', 'excel', 'writing'],
    pay: 'Analyst',
    next: ['Senior consultant', 'Valuation', 'Corporate real estate tax']
  },
  {
    key: 'title',
    title: 'Title / escrow',
    match: /\b(title|escrow|closing|closer|examiner)\b/i,
    sectors: ['Title & Escrow'],
    does: 'Makes sure a property can change hands cleanly: searches the records, clears liens, and runs the closing and the money.',
    day: ['Order and read title commitments', 'Clear curative items before closing', 'Balance and disburse closing funds'],
    skills: ['writing', 'research'],
    pay: 'Analyst',
    next: ['Escrow officer', 'Commercial closer', 'Title underwriting']
  },
  {
    key: 'construction',
    title: 'Project / construction coordinator',
    match: /\b(project|construction|preconstruction|estimat|superintendent|field)\w*\b.*\b(coordinator|engineer|analyst|assistant|manager)\b/i,
    sectors: ['Development', 'Homebuilder'],
    does: 'Keeps a building job on budget and schedule for the owner or builder: bids, change orders, submittals, draws and punch lists.',
    day: ['Track the schedule and change orders', 'Review contractor pay applications', 'Walk the job site'],
    skills: ['excel', 'entitlement'],
    pay: 'Project / construction',
    next: ['Project manager', 'Development manager', 'Owner\'s representative']
  },
  {
    key: 'accounting',
    title: 'Property / fund accountant',
    match: /\b(accountant|accounting|controller|fund admin|financial analyst|finance)\b/i,
    sectors: ['Finance & Accounting'],
    does: 'Keeps the books for buildings or the funds that own them: monthly closes, reconciliations, investor distributions and audits.',
    day: ['Close the month for a set of properties', 'Reconcile bank and tenant accounts', 'Prepare investor reports and the audit file'],
    skills: ['excel', 'yardi', 'mri'],
    pay: 'Analyst',
    next: ['Senior accountant', 'Fund controller', 'Asset management']
  },
  {
    key: 'research',
    title: 'Research analyst',
    match: /\bresearch\b/i,
    sectors: ['Brokerage', 'Investment'],
    does: 'Tracks a market\'s rents, vacancy, construction and sales, and writes the quarterly market reports brokers and investors quote.',
    day: ['Survey buildings for rents and availability', 'Clean and chart market data', 'Write market reports'],
    skills: ['research', 'costar', 'tableau', 'sql', 'writing'],
    pay: 'Analyst',
    next: ['Senior research analyst', 'Strategy', 'Acquisitions']
  }
];

/** The guide entry a job title fits best, or null. */
export function decodeTitle(role) {
  return TITLE_GUIDE.find((entry) => entry.match.test(String(role ?? ''))) ?? null;
}

/** Each guide entry with its open jobs and pay figures from the salary check. */
export function titleRows(jobs, salaries, city = '') {
  const pool = (jobs ?? []).filter((j) => !city || j.city === city);
  return TITLE_GUIDE.map((entry) => {
    const open = pool.filter((j) => decodeTitle(j.role)?.key === entry.key);
    const families = (salaries?.markets ?? [])
      .filter((m) => !city || m.city === city)
      .flatMap((m) => m.families.filter((f) => f.family === entry.pay));
    const filings = families.reduce((n, f) => n + f.filings, 0);
    // A filings-weighted mean of the market medians: close enough to show the level.
    const entryPay = weighted(families, 'entryMedian', 'entryFilings');
    const pay = weighted(families, 'median', 'filings');
    return { ...entry, jobs: open, pay: { family: entry.pay, median: pay, entry: entryPay, filings } };
  });
}

function weighted(rows, value, weight) {
  let total = 0;
  let n = 0;
  for (const row of rows) {
    if (!row[value] || !row[weight]) continue;
    total += row[value] * row[weight];
    n += row[weight];
  }
  return n >= 3 ? Math.round(total / n / 1000) * 1000 : null;
}

/* ------------------------------------------------------------ Skills in demand */

/** The matcher's skill vocabulary (backend/src/matching/skills.ts), by key. */
export const SKILL_LABELS = {
  excel: 'Excel',
  modeling: 'Financial modeling',
  underwriting: 'Underwriting',
  argus: 'Argus',
  costar: 'CoStar',
  yardi: 'Yardi',
  mri: 'MRI',
  sql: 'SQL',
  python: 'Python',
  tableau: 'Tableau / Power BI',
  gis: 'GIS',
  powerpoint: 'PowerPoint',
  research: 'Market research',
  writing: 'Writing',
  license: 'TX real estate license',
  lease: 'Lease analysis',
  entitlement: 'Entitlements / zoning',
  uspap: 'USPAP (appraisal)'
};

/**
 * How often each skill comes up, overall and in each sector: the share of
 * postings that ask for it. Rows are skills, most asked-for first; sectors
 * with fewer than minJobs postings are left out of the grid.
 */
export function skillDemand(jobs, city = '', minJobs = 3) {
  const pool = (jobs ?? []).filter((j) => !city || j.city === city);
  const bySector = new Map();
  for (const job of pool) bySector.set(job.sector, [...(bySector.get(job.sector) ?? []), job]);
  const sectors = [...bySector]
    .filter(([, list]) => list.length >= minJobs)
    .sort((a, b) => b[1].length - a[1].length)
    .map(([sector, list]) => ({ sector, jobs: list.length }));
  const asks = (job, key) => (job.match?.required ?? []).includes(key);
  const rows = Object.entries(SKILL_LABELS)
    .map(([key, label]) => {
      const count = pool.filter((j) => asks(j, key)).length;
      const cells = sectors.map(({ sector }) => {
        const list = bySector.get(sector);
        const n = list.filter((j) => asks(j, key)).length;
        return { sector, count: n, share: list.length ? n / list.length : 0 };
      });
      return { key, label, count, share: pool.length ? count / pool.length : 0, cells };
    })
    .filter((row) => row.count > 0)
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
  return { total: pool.length, sectors, rows };
}

/* ------------------------------------------------------------ Near campus */

/** Texas campuses in or next to Terra's markets, with the market whose map covers them. */
export const CAMPUSES = [
  { key: 'ut-austin', name: 'UT Austin', city: 'Austin', lat: 30.2849, lng: -97.7341 },
  { key: 'texas-state', name: 'Texas State', city: 'Austin', lat: 29.8884, lng: -97.9384 },
  { key: 'tamu', name: 'Texas A&M', city: 'College Station', lat: 30.6187, lng: -96.3365 },
  { key: 'uh', name: 'University of Houston', city: 'Houston', lat: 29.7199, lng: -95.3422 },
  { key: 'rice', name: 'Rice', city: 'Houston', lat: 29.7174, lng: -95.4018 },
  { key: 'tsu', name: 'Texas Southern', city: 'Houston', lat: 29.7226, lng: -95.3586 },
  { key: 'smu', name: 'SMU', city: 'Dallas', lat: 32.8412, lng: -96.7845 },
  { key: 'utd', name: 'UT Dallas', city: 'Dallas', lat: 32.9858, lng: -96.7501 },
  { key: 'unt', name: 'North Texas', city: 'Dallas', lat: 33.2075, lng: -97.1526 },
  { key: 'tcu', name: 'TCU', city: 'Fort Worth', lat: 32.7096, lng: -97.3628 },
  { key: 'uta', name: 'UT Arlington', city: 'Fort Worth', lat: 32.7299, lng: -97.114 },
  { key: 'utsa', name: 'UTSA', city: 'San Antonio', lat: 29.5831, lng: -98.6199 },
  { key: 'trinity', name: 'Trinity', city: 'San Antonio', lat: 29.4618, lng: -98.4834 },
  { key: 'stmarys', name: "St. Mary's", city: 'San Antonio', lat: 29.4524, lng: -98.5654 },
  { key: 'ttu', name: 'Texas Tech', city: 'Lubbock', lat: 33.5843, lng: -101.8783 },
  { key: 'utep', name: 'UTEP', city: 'El Paso', lat: 31.7709, lng: -106.5047 },
  { key: 'tamug', name: 'Texas A&M Galveston', city: 'Galveston', lat: 29.311, lng: -94.817 },
  { key: 'utpb', name: 'UT Permian Basin', city: 'Midland', lat: 31.889, lng: -102.327 }
];

/** Miles between two points (haversine). */
export function miles(a, b) {
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLng = (b.lng - a.lng) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 3958.8 * 2 * Math.asin(Math.sqrt(h));
}

const located = (p) => Number.isFinite(p?.lat) && Number.isFinite(p?.lng);

/**
 * The private projects within `radius` miles of a campus, nearest first, and
 * the firms on them: owners, tenants, architects and contractors, with the
 * jobs any of them have open in the feed.
 */
export function nearCampus(projects, jobs, campus, radius = 10) {
  const near = (projects ?? [])
    .filter((p) => located(p) && !p.isPublic)
    .map((p) => ({ ...p, miles: miles(campus, p) }))
    .filter((p) => p.miles <= radius)
    .sort((a, b) => a.miles - b.miles);
  const firms = new Map();
  for (const project of near) {
    for (const [field, role] of [['owner', 'Owner'], ['tenant', 'Tenant'], ['designFirm', 'Architect'], ['contractor', 'Contractor']]) {
      const name = project[field];
      if (!name || /^(n\/a|none|tbd)$/i.test(name)) continue;
      const key = [...significant(name)].sort().join(' ') || name.toLowerCase();
      const row = firms.get(key) ?? { name, roles: new Set(), projects: [], cost: 0 };
      row.roles.add(role);
      if (!row.projects.includes(project)) {
        row.projects.push(project);
        row.cost += project.cost > 0 ? project.cost : 0;
      }
      firms.set(key, row);
    }
  }
  const list = [...firms.values()].map((row) => ({
    ...row,
    roles: [...row.roles],
    jobs: (jobs ?? []).filter((j) => sameFirm(j.firm, row.name))
  }));
  list.sort((a, b) => b.jobs.length - a.jobs.length || b.projects.length - a.projects.length || b.cost - a.cost);
  return { projects: near, firms: list };
}

/* ------------------------------------------------------------ Market tour */

/** Google Maps takes up to nine stops between the start and the end in a directions link. */
export const TOUR_STOPS = 8;

/**
 * A driving loop through a market's biggest private projects with real street
 * addresses: the largest `pool` by cost, then up to `stops` of them ordered
 * by nearest neighbor from `start` (the market center, or a campus).
 */
export function tourStops(projects, city, start, { stops = TOUR_STOPS, pool = 30, minCost = 0 } = {}) {
  const candidates = (projects ?? [])
    .filter((p) => p.city === city && located(p) && !p.approximate && !p.isPublic && p.address && p.cost >= minCost)
    .sort((a, b) => b.cost - a.cost)
    .slice(0, pool);
  // Within the pool, keep the ones closest to the start so the route stays a drive, not a road trip.
  const picked = candidates
    .map((p) => ({ p, d: miles(start, p) }))
    .sort((a, b) => a.d - b.d)
    .slice(0, stops)
    .map(({ p }) => p);
  const route = [];
  let here = start;
  const left = [...picked];
  while (left.length) {
    let best = 0;
    for (let i = 1; i < left.length; i++) if (miles(here, left[i]) < miles(here, left[best])) best = i;
    const [next] = left.splice(best, 1);
    route.push({ ...next, leg: miles(here, next) });
    here = next;
  }
  return route;
}

/** A Google Maps directions link through the stops (free, no key; opens the app on phones). */
export function tourUrl(start, stops) {
  if (!stops.length) return '';
  const point = (p) => `${p.lat.toFixed(5)},${p.lng.toFixed(5)}`;
  const params = new URLSearchParams({
    api: '1',
    origin: point(start),
    destination: point(stops[stops.length - 1]),
    travelmode: 'driving'
  });
  if (stops.length > 1) params.set('waypoints', stops.slice(0, -1).map(point).join('|'));
  return `https://www.google.com/maps/dir/?${params}`;
}

/** Total driving distance of a tour, straight-line legs times a city-street factor. */
export function tourMiles(stops) {
  return Math.round(stops.reduce((n, s) => n + s.leg, 0) * 1.3);
}

/* ------------------------------------------------------------ Interview brief */

/** Whether a headline or agenda item names the firm: every identifying word of its name, as words. */
export function mentions(firm, text) {
  const words = [...significant(firm)];
  if (!words.length) return false;
  const haystack = ` ${String(text ?? '').toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ')} `;
  return words.every((w) => haystack.includes(` ${w} `));
}

/** The firms a brief can be built for: every firm in the feed, most open jobs first. */
export function briefFirms(jobs) {
  const counts = new Map();
  for (const job of jobs ?? []) counts.set(job.firm, (counts.get(job.firm) ?? 0) + 1);
  return [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([firm, n]) => ({ firm, jobs: n }));
}

/**
 * Everything Terra knows about one firm, for interview prep: its open jobs,
 * the projects it is on, headlines and zoning cases that name it, what it
 * offered on visa salary filings, and how many new agents it sponsors.
 */
export function buildBrief(firm, { jobs = [], projects = [], news = null, zoning = null, salaries = null, sponsors = null } = {}) {
  const open = jobs.filter((j) => j.firm === firm);
  const sector = mostCommon(open.map((j) => j.sector));
  const cities = [...new Set(open.map((j) => j.city))];
  const onProjects = projects
    .map((p) => ({ ...p, roles: rolesOn(firm, p) }))
    .filter((p) => p.roles.length)
    .sort((a, b) => (b.cost || 0) - (a.cost || 0));
  const headlines = [];
  const seen = new Set();
  for (const city of news?.cities ?? []) {
    for (const h of city.headlines ?? []) {
      if (seen.has(h.url) || !mentions(firm, h.title)) continue;
      seen.add(h.url);
      headlines.push({ ...h, city: city.city });
    }
  }
  headlines.sort((a, b) => String(b.publishedAt ?? '').localeCompare(String(a.publishedAt ?? '')));
  const cases = (zoning?.cases ?? []).filter((c) => mentions(firm, c.title));
  const pay = (salaries?.markets ?? [])
    .flatMap((m) => m.rows.map((row) => ({ ...row, city: m.city })))
    .filter((row) => sameFirm(firm, row.employer))
    .sort((a, b) => b.filings - a.filings);
  const sponsor = (sponsors?.brokers ?? []).find((b) => sameFirm(firm, b.name)) ?? null;
  const cost = onProjects.reduce((n, p) => n + (p.cost > 0 ? p.cost : 0), 0);
  return {
    firm,
    sector,
    cities,
    jobs: open,
    projects: onProjects,
    cost,
    headlines: headlines.slice(0, 8),
    cases: cases.slice(0, 6),
    pay: pay.slice(0, 6),
    sponsor,
    points: talkingPoints({ firm, open, onProjects, cost, headlines, cases, sponsor }),
    questions: QUESTIONS[sector] ?? QUESTIONS.default
  };
}

function mostCommon(values) {
  const counts = new Map();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  return [...counts].sort((a, b) => b[1] - a[1])[0]?.[0] ?? '';
}

const shortMoney = (n) => (n >= 1e9 ? `$${(n / 1e9).toFixed(1)}B` : n >= 1e6 ? `$${Math.round(n / 1e6)}M` : `$${Math.round(n / 1e3)}K`);

/** A few things to say in the interview, from the facts above. */
function talkingPoints({ firm, open, onProjects, cost, headlines, cases, sponsor }) {
  const points = [];
  if (onProjects.length) {
    const top = onProjects[0];
    const where = top.place || top.city;
    points.push(
      `${firm} is on ${onProjects.length} project${onProjects.length === 1 ? '' : 's'} registered with the state${cost ? ` worth about ${shortMoney(cost)}` : ''}. The biggest is ${top.facility || top.name} in ${where}${top.cost ? ` (${shortMoney(top.cost)})` : ''}, where it is the ${top.roles.join(' and ').toLowerCase()}.`
    );
  }
  if (headlines.length) points.push(`Recent news: "${headlines[0].title}". Ask how that deal or project is going.`);
  if (cases.length) points.push(`Its name is on a zoning case: ${cases[0].title} (${cases[0].place}). That is usually a project before construction starts.`);
  if (sponsor) points.push(`It sponsored ${sponsor.newAgents} new sales agents in the last year, so it trains people from scratch.`);
  const cities = [...new Set(open.map((j) => j.city))];
  if (open.length > 1) points.push(`It has ${open.length} entry-level openings on Terra${cities.length > 1 ? ` across ${cities.join(', ')}` : ` in ${cities[0]}`}, so it is building a junior bench.`);
  return points;
}

const QUESTIONS = {
  Investment: ['Which deals from the last year are you proudest of, and why did you win them?', 'How does a first-year analyst get time in front of the investment committee?', 'What makes you walk away from a deal in this market right now?'],
  Brokerage: ['How do new associates build their own book, and how long until they are on commission?', 'Which property types is the team busiest with this year?', 'How does the firm support getting the sales agent license?'],
  Development: ['Which project in the pipeline would I work on first?', 'How do you decide which sites are worth chasing through zoning?', 'Where in the project does an analyst spend most of their time?'],
  'Property Mgmt': ['How many units or square feet would I support?', 'What does the path from assistant manager to property manager look like here?', 'Which software do your sites run on?'],
  'Asset Mgmt': ['Which assets in the portfolio need the most attention right now?', 'How often do you re-forecast the hold model?', 'How much do analysts work with the property teams?'],
  Lending: ['Which property types is the bank leaning into or away from right now?', 'How big is a typical loan an analyst would underwrite?', 'How does credit training work for new analysts?'],
  Appraisal: ['How do trainee hours get logged toward the license here?', 'Which property types does the office value most?', 'How quickly do trainees start writing full reports?'],
  default: ['What does a strong first year in this seat look like?', 'Which project or deal would I be closest to in my first months?', 'Who did well in this role before, and where are they now?']
};

/* ------------------------------------------------------------ New-agent sponsors */

/** One market's brokerages (or every market's), most new agents first, filtered by a search. */
export function sponsorRows(sponsors, city = '', query = '') {
  const words = String(query).toLowerCase().split(/\s+/).filter(Boolean);
  return (sponsors?.brokers ?? [])
    .filter((b) => !city || b.city === city)
    .filter((b) => words.every((w) => b.name.toLowerCase().includes(w)))
    .sort((a, b) => b.newAgents - a.newAgents || b.agents - a.agents || a.name.localeCompare(b.name));
}
