// devreports.js — the rules behind "Report a development" and the map's
// coverage note, kept free of the page so the tests can run them. The
// database (supabase/pending/0019_development_reports.sql) enforces the same
// limits on every insert; these only spare members a round trip.

export const LIMITS = { name: 120, address: 200, description: 1000, minDescription: 10, url: 500, photoBytes: 5 * 1024 * 1024, perDay: 5 };
export const PHOTO_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

/** What a member sees for each review state. */
export const STATUS_LABELS = {
  pending: 'Waiting for review',
  approved: 'Verified and on the map',
  rejected: 'Not added',
  duplicate: 'Already reported'
};

const HTTP = /^https?:\/\/[^\s/$.?#][^\s]*$/i;

/**
 * The row to insert from the form's values, or the problems to fix. A filled
 * honeypot (a field people never see) means a bot: the caller drops it quietly.
 */
export function reportRow(input, city) {
  if (String(input.website ?? '').trim()) return { spam: true, errors: [] };
  const errors = [];
  const address = String(input.address ?? '').trim();
  const name = String(input.name ?? '').trim();
  const description = String(input.description ?? '').trim();
  const sourceUrl = String(input.sourceUrl ?? '').trim();
  const pin = input.pin && Number.isFinite(input.pin.lat) && Number.isFinite(input.pin.lng) ? input.pin : null;
  if (!address && !pin) errors.push('Add an address or drop a pin on the map.');
  if (address && (address.length < 5 || address.length > LIMITS.address)) errors.push(`Use an address of 5 to ${LIMITS.address} characters.`);
  if (name.length > LIMITS.name) errors.push(`Keep the project name under ${LIMITS.name} characters.`);
  if (description.length < LIMITS.minDescription) errors.push('Say a little about the project (at least 10 characters).');
  if (description.length > LIMITS.description) errors.push(`Keep the description under ${LIMITS.description} characters.`);
  if (sourceUrl && (!HTTP.test(sourceUrl) || sourceUrl.length > LIMITS.url)) errors.push('Use a link that starts with http:// or https://.');
  const photo = input.photo ?? null;
  if (photo && !PHOTO_TYPES.includes(photo.type)) errors.push('Photos can be JPEG, PNG or WebP.');
  if (photo && photo.size > LIMITS.photoBytes) errors.push('Photos can be up to 5 MB.');
  if (errors.length) return { errors };
  return {
    errors,
    row: {
      city,
      address: address || null,
      lat: pin ? Math.round(pin.lat * 1e6) / 1e6 : null,
      lng: pin ? Math.round(pin.lng * 1e6) / 1e6 : null,
      name: name || null,
      description,
      source_url: sourceUrl || null
    }
  };
}

/** The database's refusal in plain words. */
export function reportError(message = '') {
  if (/5 reports a day/.test(message)) return 'You can send 5 reports a day. Try again tomorrow.';
  if (/already reported|development_reports_once/.test(message)) return 'You already reported this place.';
  if (/check constraint.*(lat|lng)/.test(message)) return 'That pin is outside Texas.';
  if (/Sign in/.test(message)) return 'Sign in to report a development.';
  return `Couldn't send the report. ${message}`.trim();
}

/** A member's report as one status line. */
export function reportStatus(report) {
  const label = STATUS_LABELS[report.status] ?? report.status;
  const flagged = report.status === 'pending' && report.possible_duplicate_of ? ' (someone else reported a project here too)' : '';
  return `${label}${flagged}`;
}

const money = (n) => (n >= 1e6 ? `$${(n / 1e6).toFixed(n >= 1e7 ? 0 : 1)}M` : `$${Math.round(n / 1000)}K`);

/**
 * What the map covers and what it doesn't, in a sentence or three. `metro` is
 * the build's MetroCoverage row (absent on snapshots older than this note).
 */
export function coverageNote({ metro, smaller = 0, permits = null, reports = 0 }) {
  const parts = [];
  const n = (x) => x.toLocaleString('en-US');
  if (metro?.cutoff != null) {
    parts.push(
      `This map pins the ${n(metro.cap)} biggest of the ${n(metro.filings)} current state TABS filings collected for the metro${metro.reported != null ? ` (TABS lists ${n(metro.reported)} filings of every status in its counties over two years)` : ''}, so filings under about ${money(metro.cutoff)} get no pin.`
    );
    if (smaller) {
      parts.push(
        metro.skippedWindows
          ? `The smaller filings list below holds only the ${n(smaller)} smaller ones collected along the way: to save requests, ${n(metro.skippedWindows)} search ${metro.skippedWindows === 1 ? 'window' : 'windows'} holding only filings under the cutoff ${metro.skippedWindows === 1 ? 'was' : 'were'} not read in full, so it is partial.`
          : `The smaller filings list below holds the other ${n(smaller)}.`
      );
    }
  } else if (metro) {
    parts.push(`This map shows all ${n(metro.filings)} current state TABS filings the build read for the metro.`);
  }
  if (metro && !metro.complete) parts.push('Part of the latest state read came back short, so even those counts are low.');
  parts.push(
    `TABS only lists projects that file for state accessibility review (generally $50,000 or more of commercial or public work)${permits ? `, and ${permits} building permits fill in some of the rest` : ''}. Single-family homes, unfiled projects and most private work in other cities are not here, so the map is not a complete list.`
  );
  if (reports) parts.push(`${reports} community ${reports === 1 ? 'report is' : 'reports are'} shown after review.`);
  return parts.join(' ');
}

/** The smaller filings for one metro that match a search, biggest first. */
export function matchSmaller(list, city, query = '') {
  const q = query.trim().toLowerCase();
  return (list ?? [])
    .filter((s) => s.city === city && (!q || `${s.name} ${s.place ?? ''} ${s.id}`.toLowerCase().includes(q)))
    .sort((a, b) => b.cost - a.cost);
}
