import type { RawJob } from '../../types.js';
import { fetchText, type FetchJsonOptions } from '../../lib/http.js';
import { decodeEntities, stripHtml } from '../../lib/html.js';
import { classifyKind } from '../seniority.js';
import { resolveCity } from '../texas.js';

/**
 * iCIMS fetcher.
 *
 * iCIMS has a JSON API, but it is per-customer and behind credentials the
 * customer issues; nobody outside the firm gets one. What every tenant does
 * serve publicly is its career portal, so that is what this reads:
 *
 *   https://<host>/jobs/search?pr=<page>&in_iframe=1        list, 20 per page
 *   https://<host>/jobs/<id>/<slug>/job?in_iframe=1         one posting
 *
 * `in_iframe=1` asks for the bare portal the firm's own site embeds. Without
 * it the job page is a wrapper with meta tags and no body.
 *
 * A firm row carries the portal host, the same split as Workday:
 *
 *   ats_host = 'careers-hines.icims.com'
 *   ats_slug = 'careers-hines'              (what atsDetect reads off the host)
 *
 * `ats_host` may be left null when the portal is '<slug>.icims.com'.
 *
 * The list rows are scraped from HTML, so they are read loosely: a job is any
 * link of the shape /jobs/<id>/<slug>/job, its title is the link text, and its
 * location is whatever 'US-TX-Houston' style codes sit between it and the next
 * job link. The detail page carries a schema.org JobPosting block for Google
 * for Jobs, which is a far more stable contract than the markup, and is
 * preferred whenever it is present.
 */

/** Stop after this many list pages per firm. 25 x 20 is more than any CRE board carries. */
const MAX_PAGES = 25;

/** Same meaning as WorkdayStats: what the board listed, and what survived. */
export interface IcimsStats {
  listed: number;
  considered: number;
  fetched: number;
  sample?: string[];
}

export interface IcimsListing {
  id: string;
  slug: string;
  title: string;
  /** 'Houston, TX; Chicago, IL', or '' when the row named no location. */
  location: string;
}

interface JobPostingLd {
  '@type'?: string | string[];
  title?: string;
  description?: string;
  datePosted?: string;
  employmentType?: string | string[];
  url?: string;
  jobLocation?: LdPlace | LdPlace[];
}

interface LdPlace {
  address?: {
    addressLocality?: string;
    addressRegion?: string;
    addressCountry?: string | { name?: string };
  };
}

/**
 * The portal host for a firm row. Throws on a row that names neither, so a
 * half-configured firm fails loudly instead of returning nothing.
 */
export function portalHost(host: string | null | undefined, slug: string): string {
  const raw = host?.trim() || (slug.includes('.') ? slug : slug ? `${slug}.icims.com` : '');
  if (!raw) throw new Error('iCIMS firm needs ats_host or ats_slug');
  return raw.replace(/^https?:\/\//, '').replace(/\/.*$/, '');
}

export function searchUrl(host: string, page: number): string {
  return `https://${host}/jobs/search?pr=${page}&in_iframe=1`;
}

export function jobUrl(host: string, listing: Pick<IcimsListing, 'id' | 'slug'>): string {
  return `https://${host}/jobs/${listing.id}/${listing.slug}/job?in_iframe=1`;
}

/** Public, human-facing posting URL — what `apply_url` should point at. */
export function applyUrl(host: string, listing: Pick<IcimsListing, 'id' | 'slug'>): string {
  return `https://${host}/jobs/${listing.id}/${listing.slug}/job`;
}

/**
 * Fetch one iCIMS portal.
 *
 * Like Workday, the list carries title and location but no description, so the
 * cheap filters run on the list first and only survivors cost a detail request.
 */
export async function fetchIcims(
  firm: string,
  host: string | null | undefined,
  slug: string,
  options: FetchJsonOptions & { maxPages?: number; stats?: IcimsStats } = {}
): Promise<RawJob[]> {
  const portal = portalHost(host, slug);
  const maxPages = options.maxPages ?? MAX_PAGES;

  const listings = new Map<string, IcimsListing>();
  for (let page = 0; page < maxPages; page++) {
    const html = await fetchText(searchUrl(portal, page), options);
    const batch = parseSearchPage(html);

    let added = 0;
    for (const listing of batch) {
      if (listings.has(listing.id)) continue;
      listings.set(listing.id, listing);
      added++;
    }

    if (!batch.length) break;
    // The portal's order is not stable between requests: on Hines' board a
    // page can repeat most of an earlier one while the board shifts. So a page
    // of repeats only ends the walk when the portal has not said how many
    // pages there are; with a page count, the walk goes to the end.
    const pages = pageCount(html);
    if (pages === undefined ? !added : page + 1 >= pages) break;
  }

  const all = [...listings.values()];
  const candidates = all.filter(worthFetching);

  if (options.stats) {
    options.stats.listed = all.length;
    options.stats.considered = candidates.length;
    options.stats.sample = all
      .slice(0, 6)
      .map((listing) => `${listing.title} — ${listing.location || '?'}`);
  }

  const jobs: RawJob[] = [];
  // Three at a time: this is one firm's portal and we are a guest on it.
  for (let i = 0; i < candidates.length; i += 3) {
    const details = await Promise.all(
      candidates.slice(i, i + 3).map((listing) => fetchDetail(firm, portal, listing, options))
    );
    jobs.push(...details.filter((job): job is RawJob => job !== null));
  }

  if (options.stats) options.stats.fetched = jobs.length;

  return jobs;
}

/**
 * Is this listing worth a detail request? The same two signals as Workday's:
 * an entry-level title, and a location that is either Texas or unstated.
 */
export function worthFetching(listing: IcimsListing): boolean {
  if (!classifyKind(listing.title)) return false;
  if (listing.location && !resolveCity(listing.location)) return false;
  return true;
}

const JOB_LINK = /<a\b[^>]*\bhref\s*=\s*["']([^"']*\/jobs\/(\d+)\/([^/"'?#]+)\/job[^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi;

/**
 * Pull every job row out of one search results page.
 *
 * Each row labels its location 'Job Locations'. On Hines' portal that label
 * comes *before* the row's title link, so reading the codes after a link
 * credits every job with the next row's location — which is exactly what the
 * first live run did. So locations are tied to links through the labels, in
 * whichever direction the page uses: if the first label precedes the first
 * link, each label belongs to the link after it, otherwise to the link before.
 * A page with no labels falls back to the codes after each link.
 */
export function parseSearchPage(html: string): IcimsListing[] {
  const links = [...html.matchAll(JOB_LINK)];
  const byId = new Map<string, IcimsListing>();

  for (const link of links) {
    const id = link[2] as string;
    if (byId.has(id)) continue; // A title link and an 'Apply' button, say.
    const slug = link[3] as string;
    byId.set(id, { id, slug, title: linkTitle(link[0], link[4] ?? '') || titleFromSlug(slug), location: '' });
  }

  const labels = [...html.matchAll(/Job\s+Locations?/gi)].map((label) => label.index ?? 0);
  if (labels.length && links.length) {
    const before = (labels[0] as number) < (links[0]?.index ?? 0);

    for (const at of labels) {
      const owner = before
        ? links.find((link) => (link.index ?? 0) > at)
        : links.filter((link) => (link.index ?? 0) < at).pop();
      const listing = owner && byId.get(owner[2] as string);
      if (!listing || listing.location) continue;

      // The label's value runs to the next link or the next label.
      const rest = html.slice(at + 'Job Locations'.length);
      const stop = rest.search(/<a\b|Job\s+Locations?/i);
      listing.location = locationCodes(rest.slice(0, stop < 0 ? 600 : stop));
    }
  } else {
    links.forEach((link, index) => {
      const listing = byId.get(link[2] as string);
      if (!listing || listing.location) return;
      const next = links.slice(index + 1).find((other) => other[2] !== link[2]);
      listing.location = locationCodes(
        html.slice((link.index ?? 0) + link[0].length, next?.index ?? html.length)
      );
    });
  }

  return [...byId.values()];
}

function linkTitle(anchor: string, inner: string): string {
  // iCIMS puts '<id> - <title>' in the anchor's title attribute, which is
  // cleaner than the link text: that carries a screen-reader 'Title' label.
  const attr = /\btitle\s*=\s*(["'])(.*?)\1/i.exec(anchor)?.[2];
  const fromAttr = attr ? decodeEntities(attr).replace(/^\s*\d+\s*-\s*/, '').trim() : '';
  if (fromAttr) return fromAttr;

  const text = stripHtml(inner.replace(/<span[^>]*\bsr-only\b[^>]*>[\s\S]*?<\/span>/gi, ' '))
    .replace(/\s+/g, ' ')
    .trim();
  return text && !/^(apply|view|details?|more)\b/i.test(text) ? text : '';
}

function titleFromSlug(slug: string): string {
  return decodeURIComponent(slug).replace(/-+/g, ' ').trim();
}

/**
 * iCIMS writes locations as 'Country-State-City' codes: 'US-TX-Houston',
 * 'US-TX-Fort Worth', and joins several with ' | '. Rewritten as
 * 'Houston, TX' so resolveCity reads them the same way as every other board.
 * Codes without a state ('UK-London') are kept as 'London, UK'.
 */
export function locationCodes(html: string): string {
  const text = stripHtml(html);
  const found: string[] = [];
  // The state part is two letters in the US, but digits elsewhere ('FR-92-…',
  // 'JP-13-Tokyo'), and city names carry hyphens and accents.
  const code =
    /\b([A-Z]{2})-(?:([A-Z]{2}|\d{1,3})-)?(\p{Lu}[\p{L}\d.'’ -]*?)(?=\s*(?:\||\n|$|\b[A-Z]{2}-[A-Z\d]{1,3}-|\b(?:ID|Category|Type|Posted|Job|Req)\b))/gu;

  for (const match of text.matchAll(code)) {
    const [, country, state, city] = match;
    const place = state && !/\d/.test(state) ? `${city!.trim()}, ${state}` : `${city!.trim()}, ${country}`;
    if (!found.includes(place)) found.push(place);
  }

  return found.join('; ');
}

/** 'Page 1 of 10' → 10. Undefined when the page does not say. */
export function pageCount(html: string): number | undefined {
  const match = /Page\s*(?:<[^>]*>\s*)*\d+\s*(?:<[^>]*>\s*)*of\s*(?:<[^>]*>\s*)*(\d+)/i.exec(html);
  return match ? Number(match[1]) : undefined;
}

async function fetchDetail(
  firm: string,
  host: string,
  listing: IcimsListing,
  options: FetchJsonOptions
): Promise<RawJob | null> {
  let html: string;
  try {
    html = await fetchText(jobUrl(host, listing), options);
  } catch {
    // One posting failing is not the firm failing — a filled job answers 410
    // between the list request and this one. Drop it and keep going.
    return null;
  }

  return parseJobPage(firm, host, listing, html);
}

/** Build a RawJob from a posting page, preferring its JobPosting JSON-LD. */
export function parseJobPage(
  firm: string,
  host: string,
  listing: IcimsListing,
  html: string
): RawJob | null {
  const ld = jobPostingLd(html);

  const title = (ld?.title ? decodeEntities(ld.title) : listing.title).trim();
  if (!title) return null;

  return {
    title,
    firm,
    location: ldLocations(ld) || listing.location || ogLocation(html),
    description: ld?.description ? ldDescription(ld.description) : bodyDescription(html),
    applyUrl: applyUrl(host, listing),
    postedAt: date(ld?.datePosted),
    // 'FULL_TIME', 'INTERN', 'PART_TIME' — the schema.org vocabulary, and on an
    // intern posting the one explicit level signal iCIMS publishes.
    level: employmentType(ld?.employmentType),
    ats: 'icims'
  };
}

export function jobPostingLd(html: string): JobPostingLd | undefined {
  const scripts = html.matchAll(
    /<script[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi
  );

  for (const script of scripts) {
    let parsed: unknown;
    try {
      parsed = JSON.parse((script[1] ?? '').trim());
    } catch {
      continue;
    }
    const found = findJobPosting(parsed);
    if (found) return found;
  }

  return undefined;
}

function findJobPosting(node: unknown): JobPostingLd | undefined {
  if (Array.isArray(node)) {
    for (const item of node) {
      const found = findJobPosting(item);
      if (found) return found;
    }
    return undefined;
  }
  if (!node || typeof node !== 'object') return undefined;

  const record = node as JobPostingLd & { '@graph'?: unknown };
  const type = record['@type'];
  if (type === 'JobPosting' || (Array.isArray(type) && type.includes('JobPosting'))) return record;
  return record['@graph'] ? findJobPosting(record['@graph']) : undefined;
}

function ldLocations(ld: JobPostingLd | undefined): string {
  if (!ld?.jobLocation) return '';
  const places = Array.isArray(ld.jobLocation) ? ld.jobLocation : [ld.jobLocation];

  return places
    .map((place) => {
      const address = place?.address;
      const city = address?.addressLocality?.trim();
      const region = address?.addressRegion?.trim();
      return [city, region].filter(Boolean).join(', ');
    })
    .filter(Boolean)
    .join('; ');
}

/** The description is HTML, and some tenants entity-escape it a second time. */
function ldDescription(value: string): string {
  const html = /<[a-z]/i.test(value) ? value : decodeEntities(value);
  return stripHtml(html);
}

/**
 * No JSON-LD: fall back to the portal's own content blocks. iCIMS renders each
 * description section as an 'iCIMS_InfoMsg_Job' div; everything from the first
 * of them to the apply options is the posting.
 */
function bodyDescription(html: string): string {
  const start = html.search(/class\s*=\s*["'][^"']*iCIMS_InfoMsg_Job/i);
  if (start < 0) return '';
  const rest = html.slice(html.lastIndexOf('<', start));
  const end = rest.search(/iCIMS_JobOptions|iCIMS_Footer|<\/body>/i);
  return stripHtml(end > 0 ? rest.slice(0, rest.lastIndexOf('<', end)) : rest);
}

/** og:title reads 'Analyst in Houston, Texas | Careers at Hines'. */
function ogLocation(html: string): string {
  const content = /<meta[^>]*property\s*=\s*["']og:title["'][^>]*content\s*=\s*["']([^"']*)["']/i.exec(
    html
  )?.[1];
  if (!content) return '';
  const place = / in ([^|]+?)\s*(?:\||$)/.exec(decodeEntities(content))?.[1];
  return place?.trim() ?? '';
}

function employmentType(value: string | string[] | undefined): string | undefined {
  const first = Array.isArray(value) ? value[0] : value;
  return first?.trim() || undefined;
}

function date(value: string | undefined): Date | undefined {
  if (!value) return undefined;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}
