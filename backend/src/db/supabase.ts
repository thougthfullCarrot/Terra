import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Match, Posting, Profile } from '../types.js';
import type { FirmRow, Store, UpsertResult } from './store.js';

/**
 * Supabase-backed Store. Constructed with the service role key: the collector
 * writes postings and matches for every profile, which RLS deliberately blocks
 * for an end user. Never ship this key to a client.
 */
export class SupabaseStore implements Store {
  constructor(private readonly db: SupabaseClient) {}

  static fromEnv(env: Record<string, string | undefined> = process.env): SupabaseStore {
    const url = env.SUPABASE_URL;
    const key = env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) {
      throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set');
    }
    return new SupabaseStore(
      createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })
    );
  }

  async listFirms(): Promise<FirmRow[]> {
    const { data, error } = await this.db
      .from('firms')
      .select('id, name, ats, ats_slug, ats_host, active, slug_verified')
      .eq('active', true)
      .order('id');
    if (error) throw new Error(`listFirms: ${error.message}`);

    return (data ?? []).map((row) => ({
      id: row.id as number,
      name: row.name as string,
      ats: row.ats as FirmRow['ats'],
      atsSlug: row.ats_slug as string,
      atsHost: (row.ats_host as string | null) ?? null,
      active: row.active as boolean,
      slugVerified: row.slug_verified as boolean
    }));
  }

  async markFirmPolled(id: number, result: { ok: boolean; error?: string }): Promise<void> {
    const patch: Record<string, unknown> = {
      last_polled: new Date().toISOString(),
      last_error: result.ok ? null : (result.error ?? 'unknown error')
    };
    // A board that answered once is a board whose slug is right.
    if (result.ok) patch.slug_verified = true;

    const { error } = await this.db.from('firms').update(patch).eq('id', id);
    if (error) throw new Error(`markFirmPolled: ${error.message}`);
  }

  async upsertPostings(postings: Posting[], seenAt: Date): Promise<UpsertResult> {
    if (!postings.length) return { inserted: [], updated: [] };

    const ids = postings.map((posting) => posting.id);
    const { data: existing, error: readError } = await this.db
      .from('postings')
      .select('id')
      .in('id', ids);
    if (readError) throw new Error(`upsertPostings (read): ${readError.message}`);

    const known = new Set((existing ?? []).map((row) => row.id as string));
    const iso = seenAt.toISOString();

    const rows = postings.map((posting) => ({
      id: posting.id,
      role: posting.role,
      firm: posting.firm,
      city: posting.city,
      sector: posting.sector,
      kind: posting.kind,
      pay: posting.pay,
      deadline: posting.deadline,
      posted_at: posting.postedAt.toISOString(),
      description: posting.description,
      reqs: posting.reqs,
      apply_url: posting.applyUrl,
      source: posting.source,
      last_seen: iso,
      active: true,
      // first_seen has a default; sending it only for new rows keeps the
      // original discovery time intact on re-upsert.
      ...(known.has(posting.id) ? {} : { first_seen: iso })
    }));

    const { error } = await this.db.from('postings').upsert(rows, { onConflict: 'id' });
    if (error) throw new Error(`upsertPostings (write): ${error.message}`);

    return {
      inserted: ids.filter((id) => !known.has(id)),
      updated: ids.filter((id) => known.has(id))
    };
  }

  async deactivateStale(cutoff: Date): Promise<number> {
    const { data, error } = await this.db
      .from('postings')
      .update({ active: false })
      .eq('active', true)
      .lt('last_seen', cutoff.toISOString())
      .select('id');
    if (error) throw new Error(`deactivateStale: ${error.message}`);
    return data?.length ?? 0;
  }

  async listProfiles(): Promise<Profile[]> {
    const { data, error } = await this.db
      .from('profiles')
      .select(
        'id, name, school, grad_year, home_city, skills, sectors, relocation_open, resume_url, alert_digest, alert_deadlines, alert_interns, alert_market, push_token'
      );
    if (error) throw new Error(`listProfiles: ${error.message}`);

    return (data ?? []).map((row) => ({
      id: row.id as string,
      name: (row.name as string | null) ?? null,
      school: (row.school as string | null) ?? null,
      gradYear: (row.grad_year as number | null) ?? null,
      homeCity: (row.home_city as string | null) ?? null,
      skills: (row.skills as string[] | null) ?? [],
      sectors: (row.sectors as string[] | null) ?? [],
      relocationOpen: Boolean(row.relocation_open),
      resumeUrl: (row.resume_url as string | null) ?? null,
      alerts: {
        digest: Boolean(row.alert_digest),
        deadlines: Boolean(row.alert_deadlines),
        internsOnly: Boolean(row.alert_interns),
        market: Boolean(row.alert_market)
      },
      pushToken: (row.push_token as string | null) ?? null
    }));
  }

  async upsertMatches(matches: Match[]): Promise<void> {
    if (!matches.length) return;

    // Chunked: a busy run can produce profiles x postings rows, which outgrows
    // a single request quickly.
    for (const chunk of chunks(matches, 500)) {
      const { error } = await this.db.from('matches').upsert(
        chunk.map((match) => ({
          profile_id: match.profileId,
          posting_id: match.postingId,
          score: match.score,
          note: match.note,
          lines: match.lines,
          scored_at: new Date().toISOString()
        })),
        { onConflict: 'profile_id,posting_id' }
      );
      if (error) throw new Error(`upsertMatches: ${error.message}`);
    }
  }

  async getPostings(ids: string[]): Promise<Posting[]> {
    if (!ids.length) return [];
    const { data, error } = await this.db.from('postings').select('*').in('id', ids);
    if (error) throw new Error(`getPostings: ${error.message}`);
    return (data ?? []).map(rowToPosting);
  }
}

export function rowToPosting(row: Record<string, unknown>): Posting {
  return {
    id: row.id as string,
    role: row.role as string,
    firm: row.firm as string,
    city: row.city as Posting['city'],
    sector: row.sector as Posting['sector'],
    kind: row.kind as Posting['kind'],
    pay: (row.pay as string | null) ?? null,
    deadline: (row.deadline as string | null) ?? null,
    postedAt: new Date(row.posted_at as string),
    description: (row.description as string | null) ?? '',
    reqs: (row.reqs as string[] | null) ?? [],
    applyUrl: row.apply_url as string,
    source: (row.source as string | null) ?? '',
    active: (row.active as boolean | undefined) ?? true,
    firstSeen: row.first_seen ? new Date(row.first_seen as string) : undefined,
    lastSeen: row.last_seen ? new Date(row.last_seen as string) : undefined
  };
}

function* chunks<T>(items: T[], size: number): Generator<T[]> {
  for (let i = 0; i < items.length; i += size) yield items.slice(i, i + size);
}
