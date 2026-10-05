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
}

export interface EventsFile {
  generatedAt: string;
  sources: Array<{ organizer: string; city: string; url: string; fetchedAt: string; count: number }>;
  cities: Array<{ city: string; events: SiteEvent[] }>;
}

export interface EventsState {
  open: boolean;
  city: string;
}

export function readEventsHash(hash: string | null | undefined, file: EventsFile | null): EventsState;
export function writeEventsHash(state: Partial<EventsState>): string;
export function filterEvents(file: EventsFile | null, filter?: { city?: string }, now?: Date): SiteEvent[];
export function eventCounts(file: EventsFile | null, now?: Date): Map<string, number>;
export function groupByMonth(events: SiteEvent[]): Array<{ month: string; events: SiteEvent[] }>;
export function eventDate(iso: string): string;
