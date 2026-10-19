// Types for events.js, so the backend's tests can import it under strict mode.

export interface SiteEvent {
  id: string;
  title: string;
  url: string;
  start: string;
  end: string | null;
  city: string;
  organizer: string;
  venue: string | null;
  cost: string | null;
  timezone?: string;
  format?: 'in-person' | 'virtual' | 'hybrid';
  status?: string;
  free?: boolean;
  dateOnly?: boolean;
  timeUnconfirmed?: boolean;
  address?: string | null;
  registrationUrl?: string | null;
  registrationDeadline?: string | null;
  eligibility?: string | null;
  topic?: string;
  stale?: boolean;
  verifiedAt?: string;
  rescheduledFrom?: string | null;
  sessions?: Array<{ start: string; end: string | null }>;
  conflicts?: string[];
  enrollment?: 'open' | 'closed' | 'in-progress';
  spanUnverified?: boolean;
}

export interface MarketReport {
  city: string;
  state: 'events' | 'none-found' | 'unreadable' | 'no-sources';
  sourcesChecked: number;
  sourcesOk: number;
  sourcesFailed: number;
  upcoming: number;
  lastVerifiedAt: string | null;
}

export interface EventsFile {
  generatedAt: string;
  sources: Array<{ organizer: string; city: string | null; url: string; fetchedAt: string; count: number; ok?: boolean; error?: string }>;
  cities: Array<{ city: string; events: SiteEvent[] }>;
  report?: MarketReport[];
}

export interface EventsState {
  open: boolean;
  city: string;
}

export function readEventsHash(hash: string | null | undefined, file: EventsFile | null): EventsState;
export function writeEventsHash(state: Partial<EventsState>): string;
export function filterEvents(file: EventsFile | null, filter?: { city?: string }, now?: Date): SiteEvent[];
export function eventCounts(file: EventsFile | null, now?: Date): Map<string, number>;
export function eventEnds(event: { start: string; end?: string | null; timezone?: string; city?: string }): number;
export function groupByMonth(events: SiteEvent[], now?: Date): Array<{ month: string; events: SiteEvent[] }>;
export const ONLINE: string;
export function eventDate(iso: string, tz?: string): string;
export function eventWhen(event: SiteEvent, now?: Date): string;
export function occurrenceStart(event: Partial<SiteEvent>, now?: Date): string;
export function nextSession(event: SiteEvent, now?: Date): { start: string; end: string | null } | null;
export function canExport(event: SiteEvent): boolean;
export function eventBadges(event: SiteEvent): Array<{ text: string; kind: string; title?: string }>;
export function marketNote(file: EventsFile | null, city: string): { report: MarketReport | null; empty: string };
export function zoneOf(event: Partial<SiteEvent> | null | undefined): string;
export function zoneLabel(tz: string): string;
export function dateParts(iso: string, tz?: string): { month: string; day: string; weekday: string; ymd: string } | null;
export function eventIcs(event: SiteEvent, now?: Date): string | null;
export function googleCalendarUrl(event: SiteEvent, now?: Date): string | null;
export function monthGrid(month: string, events: SiteEvent[], now?: Date): Array<{ day: number; ymd: string; has: boolean } | null>;
