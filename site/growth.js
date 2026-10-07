// growth.js — who's hiring vs. who's building: the firms posting jobs in the
// feed lined up against the projects they own, lease or design on the
// development maps. The view lives in growth-view.js.
//
// The match is on company names, the same way the collector checks a job
// board belongs to a firm (backend/src/collector/nameMatch.ts): the words that
// identify a company, not the ones every company name has. State filings often
// name an owner LLC ("Hines Frisco Station LP"), so a one-word firm (Hines)
// still matches when the only other words are generic ones like "interests"
// or "development", and ALIASES covers the developers whose project entities
// carry a different name.

/** Words in half of all company names that identify none of them (nameMatch.ts FILLER). */
const FILLER = new Set([
  'the', 'inc', 'llc', 'company', 'corporation', 'corp', 'group', 'holdings', 'partners', 'real', 'estate',
  'properties', 'property', 'capital', 'realty', 'advisors', 'advisory', 'management', 'trust', 'reit'
]);

/** Words a project entity adds to its sponsor's name: "Hines Interests LP", "Lennar Homes of Texas". */
const GENERIC = new Set([
  'interests', 'development', 'developments', 'developers', 'ventures', 'venture', 'construction', 'constructors',
  'contractors', 'builders', 'building', 'homes', 'home', 'residential', 'commercial', 'investments', 'investors',
  'ltd', 'llp', 'texas', 'usa', 'america', 'americas', 'national', 'services', 'design', 'architects',
  'architecture', 'engineering', 'land', 'fund', 'partnership', 'operating', 'owner', 'phase', 'dallas',
  'houston', 'austin', 'antonio', 'san', 'fort', 'worth', 'paso', 'north', 'south', 'east', 'west', 'and'
]);

/**
 * Developers whose project entities rarely carry their own name, by the firm
 * name the feed uses (lowercase) → a pattern over the owner, tenant or design
 * firm on a filing. Add a firm here when its projects are known to be missing.
 */
export const ALIASES = {
  'trammell crow company': /\b(trammell crow|tcr\b|high street residential)/i,
  'trammell crow residential': /\b(trammell crow residential|tcr\b|alexan)/i,
  'lincoln property company': /\blincoln property\b|\blpc\b/i,
  'jpi': /\bjpi\b/i,
  'greystar': /\bgreystar\b/i,
  'hines': /\bhines\b/i,
  'stream realty partners': /\bstream (realty|data|industrial)\b/i,
  'hillwood': /\bhillwood\b/i,
  'kdc': /\bkdc\b/i,
  'cbre': /\bcbre\b/i,
  'jll': /\bjll\b|\bjones lang lasalle\b/i,
  'cushman & wakefield': /\bcushman\b/i,
  'transwestern': /\btranswestern\b/i,
  'weitzman': /\bweitzman\b/i,
  'howard hughes': /\bhoward hughes\b/i,
  'perry homes': /\bperry homes\b/i,
  'toll brothers': /\btoll (brothers|bros)\b/i,
  'lennar': /\blennar\b/i,
  'pulte': /\bpulte\b/i,
  'taylor morrison': /\btaylor morrison\b/i,
  'm/i homes': /\bm\/?i homes\b/i,
  'kb home': /\bkb home\b/i
};

/** The words that identify a company. */
export function significant(value) {
  return new Set(
    String(value ?? '')
      .toLowerCase()
      .replace(/&/g, ' and ')
      .split(/[^a-z0-9]+/)
      .filter((word) => word.length > 2 && !FILLER.has(word))
  );
}

function core(value) {
  return new Set([...significant(value)].filter((word) => !GENERIC.has(word)));
}

/** Whether a name on a filing (owner, tenant, design firm) is the firm posting the job. */
export function sameFirm(firm, party) {
  if (!firm || !party) return false;
  const alias = ALIASES[String(firm).toLowerCase().trim()];
  if (alias?.test(party)) return true;
  const a = significant(firm);
  const b = significant(party);
  if (!a.size || !b.size) return false;
  if (a.size === b.size && [...a].every((w) => b.has(w))) return true;
  if (a.size >= 2 && [...a].every((w) => b.has(w))) return true;
  // One-word firms (Hines, Greystar): only when nothing else distinctive is in the party's name,
  // so "Lincoln Electric" never counts as Lincoln Property.
  const ca = core(firm);
  const cb = core(party);
  return ca.size >= 1 && ca.size === cb.size && [...ca].every((w) => cb.has(w));
}

/** The roles a firm can play on a project, in the order they are shown. */
export const ROLES = [
  ['owner', 'Owner'],
  ['tenant', 'Tenant'],
  ['designFirm', 'Architect'],
  ['contact', 'Permit contact']
];

/** The roles a firm plays on one project, e.g. ['Owner']. */
export function rolesOn(firm, project) {
  return ROLES.filter(([key]) => sameFirm(firm, project[key])).map(([, label]) => label);
}

/** "Building and hiring", "Hiring, nothing on the map", for one firm's counts. */
export function growthLabel(jobs, projects) {
  if (jobs && projects) return 'Building and hiring';
  if (projects) return 'Building, not hiring here yet';
  return 'Hiring, nothing on the map';
}

/**
 * One row per firm hiring in the city (every market when city is ''), with its
 * open jobs and the projects it is on in the same market, ranked: firms both
 * building and hiring first (most project dollars first), then the rest by
 * open jobs.
 */
export function growthRows(jobs, projects, city = '') {
  const inCity = (item) => !city || item.city === city;
  const firms = new Map();
  for (const job of (jobs ?? []).filter(inCity)) {
    const row = firms.get(job.firm) ?? { firm: job.firm, sector: job.sector, jobs: [], projects: [], cost: 0 };
    row.jobs.push(job);
    firms.set(job.firm, row);
  }
  const pool = (projects ?? []).filter(inCity);
  for (const row of firms.values()) {
    const markets = new Set(row.jobs.map((j) => j.city));
    for (const project of pool) {
      // A Dallas job and a Houston project are not the same growth story.
      if (!markets.has(project.city)) continue;
      const roles = rolesOn(row.firm, project);
      if (!roles.length) continue;
      row.projects.push({ ...project, roles });
      row.cost += project.cost > 0 ? project.cost : 0;
    }
    row.projects.sort((a, b) => b.cost - a.cost);
    row.label = growthLabel(row.jobs.length, row.projects.length);
  }
  return [...firms.values()].sort(
    (a, b) =>
      Number(b.projects.length > 0) - Number(a.projects.length > 0) ||
      b.cost - a.cost ||
      b.jobs.length - a.jobs.length ||
      a.firm.localeCompare(b.firm)
  );
}

/**
 * Private developers with the most money in the ground in a city who have no
 * jobs in the feed: firms to watch or cold-email. Grouped by owner name,
 * public projects (schools, cities) left out.
 */
export function buildingNotHiring(jobs, projects, city = '', limit = 12) {
  const firms = [...new Set((jobs ?? []).map((j) => j.firm))];
  const owners = new Map();
  for (const project of (projects ?? []).filter((p) => (!city || p.city === city) && !p.isPublic && p.owner)) {
    if (firms.some((firm) => sameFirm(firm, project.owner))) continue;
    const key = [...core(project.owner)].sort().join(' ') || project.owner.toLowerCase();
    const row = owners.get(key) ?? { owner: project.owner, projects: [], cost: 0 };
    row.projects.push(project);
    row.cost += project.cost > 0 ? project.cost : 0;
    owners.set(key, row);
  }
  return [...owners.values()]
    .filter((row) => row.projects.length >= 2 || row.cost >= 20_000_000)
    .sort((a, b) => b.cost - a.cost || b.projects.length - a.projects.length)
    .slice(0, limit);
}

/** The firms in the feed with open jobs tied to a project, for the development map's pins. */
export function hiringOn(project, jobs) {
  const out = new Map();
  for (const job of jobs ?? []) {
    if (job.city !== project.city || out.has(job.firm)) continue;
    if (rolesOn(job.firm, project).length) out.set(job.firm, (jobs ?? []).filter((j) => j.firm === job.firm && j.city === project.city).length);
  }
  return [...out].map(([firm, count]) => ({ firm, count }));
}

/** The job feed filtered to one firm (app.js reads ?firm= on load). */
export function firmJobsHref(firm, path = '') {
  return `${path}?${new URLSearchParams({ firm })}`;
}

/* The job list markets-view.js hands over, so the map and this view can use it. */
let current = [];
export function setGrowthJobs(jobs) {
  current = Array.isArray(jobs) ? jobs : [];
}
export function growthJobs() {
  return current;
}
