// access.js — rules for accounts and the profile form, kept free of the DOM
// so the backend's tests can run them. account.js wires them to the page.

/** A plausible address; the magic link is the real check. */
export function isEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value ?? '').trim());
}

/**
 * True for an address at a .edu domain or subdomain. Must agree with
 * public.is_college_email in migration 0005, which is what actually grants
 * access; this copy only decides what the page tells someone up front.
 */
export function isCollegeEmail(email) {
  const domain = String(email ?? '').trim().toLowerCase().split('@')[1] ?? '';
  return /(^|\.)edu$/.test(domain);
}

export function isConfigured(config) {
  return Boolean(config?.supabaseUrl && config?.supabaseAnonKey);
}

/**
 * The Stripe Payment Link for this user. client_reference_id carries their
 * Supabase user id through checkout, which is how the webhook knows whose
 * subscription it is; prefilled_email saves them retyping it.
 */
export function checkoutUrl(paymentLink, { userId, email }) {
  let url;
  try {
    url = new URL(paymentLink);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:') return null;
  url.searchParams.set('client_reference_id', userId);
  if (email) url.searchParams.set('prefilled_email', email);
  return url.toString();
}

export const PROFILE_CITIES = ['Dallas', 'Fort Worth', 'Houston', 'Austin', 'San Antonio', 'El Paso', 'New Braunfels', 'College Station', 'Galveston', 'Lubbock', 'Midland'];
export const PROFILE_SECTORS = [
  'Investment',
  'Brokerage',
  'Development',
  'Property Mgmt',
  'Asset Mgmt',
  'Appraisal',
  'Capital Markets',
  'Homebuilder',
  'Affordable Housing'
];

/**
 * Graduation years offered on the form, newest first: six years out back to
 * thirty years ago. Subscribers are often alumni changing careers, and a
 * student's own year falls into the past once they graduate; a narrower list
 * left their year blank on the form and wiped it on the next save.
 */
export function gradYears(now = new Date()) {
  const year = now.getUTCFullYear();
  return Array.from({ length: 37 }, (_, i) => year + 6 - i);
}

/**
 * Turn the form's raw values into a `profiles` row. Blank text becomes null,
 * and a city outside the offered choices, or a grad year past them, is
 * dropped rather than stored, since the matcher compares them exactly.
 */
export function profileRow(values, now = new Date()) {
  const text = (value, max = 120) => {
    const clean = String(value ?? '').trim().replace(/\s+/g, ' ').slice(0, max);
    return clean || null;
  };
  const year = Number(values.gradYear);
  const sectors = Array.isArray(values.sectors) ? values.sectors : [];
  return {
    name: text(values.name),
    school: text(values.school),
    // Any real year up to the last one offered: an older year an account already has is kept.
    grad_year: Number.isInteger(year) && year > 1900 && year <= gradYears(now)[0] ? year : null,
    major: text(values.major),
    home_city: PROFILE_CITIES.includes(values.homeCity) ? values.homeCity : null,
    relocation_open: Boolean(values.relocationOpen),
    sectors: PROFILE_SECTORS.filter((sector) => sectors.includes(sector))
  };
}

export const AVATAR_LIMIT = 2 * 1024 * 1024;
export const RESUME_LIMIT = 5 * 1024 * 1024;
const AVATAR_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
const RESUME_EXTENSIONS = ['.pdf', '.docx', '.txt'];

/** Why a picked file can't be uploaded, or null if it can. Mirrors the bucket limits in migration 0005. */
export function fileProblem(file, kind) {
  if (!file) return 'Pick a file first.';
  if (kind === 'avatar') {
    if (!AVATAR_TYPES.includes(file.type)) return 'Use a JPG, PNG, WebP or GIF image.';
    if (file.size > AVATAR_LIMIT) return 'Pictures can be up to 2 MB.';
    return null;
  }
  const name = String(file.name ?? '').toLowerCase();
  if (!RESUME_EXTENSIONS.some((ext) => name.endsWith(ext))) return 'Upload your resume as a PDF, Word (.docx) or text file.';
  if (file.size > RESUME_LIMIT) return 'Resumes can be up to 5 MB.';
  return null;
}

/** Storage path for a user's file. The bucket policies only allow '<user id>/...'. */
export function storagePath(userId, kind, fileName = '') {
  if (kind === 'avatar') return `${userId}/avatar`;
  const ext = String(fileName).toLowerCase().match(/\.(pdf|docx|txt)$/)?.[0] ?? '';
  return `${userId}/resume${ext}`;
}

/** Content type to store a resume under, so the bucket's allowed types accept it even when the browser reports none. */
export function resumeContentType(fileName) {
  const name = String(fileName).toLowerCase();
  if (name.endsWith('.pdf')) return 'application/pdf';
  if (name.endsWith('.docx')) return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  return 'text/plain';
}

/** One or two letters for the avatar placeholder. */
export function initials(name, email) {
  const words = String(name ?? '').trim().split(/\s+/).filter(Boolean);
  if (words.length) return words.slice(0, 2).map((word) => word[0].toUpperCase()).join('');
  return String(email ?? '?').trim().charAt(0).toUpperCase() || '?';
}

export const ALERT_KINDS = ['Internship', 'Entry-level'];
/** Match % behind "only jobs that fit my resume well"; the site's "good match" line (GOOD_MATCH in app.js). */
export const ALERT_GOOD_MATCH = 75;

/**
 * The email alert settings as `profiles` columns (migration 0007). Cities and
 * role types outside the offered choices are dropped; none picked means all.
 */
export function alertRow(values) {
  const list = (value) => (Array.isArray(value) ? value : []);
  return {
    email_alerts: Boolean(values.emailAlerts),
    alert_cities: PROFILE_CITIES.filter((city) => list(values.alertCities).includes(city)),
    alert_kinds: ALERT_KINDS.filter((kind) => list(values.alertKinds).includes(kind)),
    alert_min_match: values.goodMatchesOnly ? ALERT_GOOD_MATCH : 0
  };
}
