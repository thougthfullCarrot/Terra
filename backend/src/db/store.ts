import type { Match, Posting, Profile } from '../types.js';

export interface FirmRow {
  id: number;
  name: string;
  ats: 'greenhouse' | 'lever' | 'workday' | 'icims';
  atsSlug: string;
  atsHost?: string | null;
  active: boolean;
  slugVerified: boolean;
}

export interface UpsertResult {
  /** Ids that did not exist before this run; these are what get scored and pushed. */
  inserted: string[];
  /** Ids that already existed and had last_seen bumped. */
  updated: string[];
}

/**
 * Everything the collector needs from the database, behind one interface so the
 * pipeline can be tested without a Postgres instance and so a different backing
 * store stays possible.
 */
export interface Store {
  listFirms(): Promise<FirmRow[]>;
  markFirmPolled(id: number, result: { ok: boolean; error?: string }): Promise<void>;
  upsertPostings(postings: Posting[], seenAt: Date): Promise<UpsertResult>;
  /** Flip `active` off for rows not seen since `cutoff`. Returns the count. */
  deactivateStale(cutoff: Date): Promise<number>;
  listProfiles(): Promise<Profile[]>;
  upsertMatches(matches: Match[]): Promise<void>;
  getPostings(ids: string[]): Promise<Posting[]>;
}

/** In-memory store used by the tests and by `npm run collect -- --dry-run`. */
export class MemoryStore implements Store {
  readonly postings = new Map<string, Posting>();
  readonly matches = new Map<string, Match>();
  readonly polls: { id: number; ok: boolean; error?: string }[] = [];

  constructor(
    private readonly firms: FirmRow[] = [],
    private readonly profiles: Profile[] = []
  ) {}

  async listFirms(): Promise<FirmRow[]> {
    return this.firms.filter((firm) => firm.active);
  }

  async markFirmPolled(id: number, result: { ok: boolean; error?: string }): Promise<void> {
    this.polls.push({ id, ...result });
  }

  async upsertPostings(postings: Posting[], seenAt: Date): Promise<UpsertResult> {
    const inserted: string[] = [];
    const updated: string[] = [];

    for (const posting of postings) {
      const existing = this.postings.get(posting.id);
      if (existing) {
        updated.push(posting.id);
        this.postings.set(posting.id, {
          ...existing,
          ...posting,
          firstSeen: existing.firstSeen,
          lastSeen: seenAt,
          active: true
        });
      } else {
        inserted.push(posting.id);
        this.postings.set(posting.id, {
          ...posting,
          firstSeen: seenAt,
          lastSeen: seenAt,
          active: true
        });
      }
    }

    return { inserted, updated };
  }

  async deactivateStale(cutoff: Date): Promise<number> {
    let count = 0;
    for (const [id, posting] of this.postings) {
      if (posting.active !== false && posting.lastSeen && posting.lastSeen < cutoff) {
        this.postings.set(id, { ...posting, active: false });
        count++;
      }
    }
    return count;
  }

  async listProfiles(): Promise<Profile[]> {
    return this.profiles;
  }

  async upsertMatches(matches: Match[]): Promise<void> {
    for (const match of matches) {
      this.matches.set(`${match.profileId}:${match.postingId}`, match);
    }
  }

  async getPostings(ids: string[]): Promise<Posting[]> {
    return ids
      .map((id) => this.postings.get(id))
      .filter((posting): posting is Posting => Boolean(posting));
  }
}
