// school.js — which school a .edu email belongs to, for the profile page's
// school icon. Pure: no DOM, so the backend's tests can import it.
//
// The icon is the school's own favicon, loaded straight from its site (no
// third-party favicon service, nothing downloaded or committed). School names
// and marks belong to the schools; they appear only small, on the profile.

/** Big Texas schools, keyed by their email domain. */
export const SCHOOLS = {
  'utexas.edu': { name: 'UT Austin', site: 'https://www.utexas.edu' },
  'tamu.edu': { name: 'Texas A&M', site: 'https://www.tamu.edu' },
  'uh.edu': { name: 'University of Houston', site: 'https://www.uh.edu' },
  'uhcl.edu': { name: 'UH–Clear Lake', site: 'https://www.uhcl.edu' },
  'rice.edu': { name: 'Rice University', site: 'https://www.rice.edu' },
  'smu.edu': { name: 'SMU', site: 'https://www.smu.edu' },
  'tcu.edu': { name: 'TCU', site: 'https://www.tcu.edu' },
  'baylor.edu': { name: 'Baylor University', site: 'https://www.baylor.edu' },
  'ttu.edu': { name: 'Texas Tech', site: 'https://www.ttu.edu' },
  'unt.edu': { name: 'University of North Texas', site: 'https://www.unt.edu' },
  'utdallas.edu': { name: 'UT Dallas', site: 'https://www.utdallas.edu' },
  'uta.edu': { name: 'UT Arlington', site: 'https://www.uta.edu' },
  'utsa.edu': { name: 'UTSA', site: 'https://www.utsa.edu' },
  'utep.edu': { name: 'UTEP', site: 'https://www.utep.edu' },
  'txstate.edu': { name: 'Texas State', site: 'https://www.txstate.edu' },
  'trinity.edu': { name: 'Trinity University', site: 'https://www.trinity.edu' },
  'stedwards.edu': { name: "St. Edward's University", site: 'https://www.stedwards.edu' },
  'utrgv.edu': { name: 'UTRGV', site: 'https://www.utrgv.edu' },
  'shsu.edu': { name: 'Sam Houston State', site: 'https://www.shsu.edu' },
  'tamucc.edu': { name: 'Texas A&M–Corpus Christi', site: 'https://www.tamucc.edu' },
  'tsu.edu': { name: 'Texas Southern', site: 'https://www.tsu.edu' },
  'pvamu.edu': { name: 'Prairie View A&M', site: 'https://www.pvamu.edu' }
};

/** The registrable .edu domain of an email (subdomains fold to the parent), or null. */
export function eduDomain(email) {
  const at = String(email ?? '').trim().toLowerCase().lastIndexOf('@');
  if (at < 1) return null;
  const host = String(email).trim().toLowerCase().slice(at + 1).replace(/\.$/, '');
  const labels = host.split('.');
  if (labels.length < 2 || labels.at(-1) !== 'edu' || labels.some((l) => !/^[a-z0-9-]+$/.test(l))) return null;
  return labels.slice(-2).join('.');
}

/** The school for an email: { domain, name, site, iconUrl, alt }, or null for non-.edu. */
export function schoolFor(email) {
  const domain = eduDomain(email);
  if (!domain) return null;
  const known = SCHOOLS[domain];
  const name = known?.name ?? domain;
  return {
    domain,
    name,
    site: known?.site ?? `https://${domain}`,
    iconUrl: `https://${domain}/favicon.ico`,
    alt: `${name} icon`
  };
}
