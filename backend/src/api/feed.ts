import type { SupabaseClient } from '@supabase/supabase-js';
import type { FeedPayload, Match, MarketData, UiMarkets } from '../types.js';
import { rowToPosting } from '../db/supabase.js';
import { buildFeed } from './serialize.js';

export interface FeedQuery {
  /** Only 'TX' is served; the parameter exists because the contract has it. */
  state?: string;
  /** Optional narrowing, mirroring the feed screen's filters. */
  city?: string;
  kind?: 'Internship' | 'Entry-level';
  /** Whose match scores to attach. Anonymous callers get postings with no scores. */
  profileId?: string | null;
  limit?: number;
}

/**
 * Read side of the API. One round trip per table, assembled into the exact
 * payload `fetchFeed()` resolves with, so the client does no joining.
 */
export class FeedReader {
  constructor(private readonly db: SupabaseClient) {}

  async getFeed(query: FeedQuery = {}, now = new Date()): Promise<FeedPayload> {
    const { state = 'TX', city, kind, profileId = null, limit = 200 } = query;
    if (state.toUpperCase() !== 'TX') {
      throw new Error(`Only TX is served; got ${state}`);
    }

    let postingsQuery = this.db
      .from('postings')
      .select('*')
      .eq('active', true)
      .order('posted_at', { ascending: false })
      .limit(limit);

    if (city) postingsQuery = postingsQuery.eq('city', city);
    if (kind) postingsQuery = postingsQuery.eq('kind', kind);

    const [{ data: postingRows, error: postingError }, markets] = await Promise.all([
      postingsQuery,
      this.getMarkets()
    ]);
    if (postingError) throw new Error(`getFeed (postings): ${postingError.message}`);

    const postings = (postingRows ?? []).map(rowToPosting);
    const matches = profileId
      ? await this.getMatches(
          profileId,
          postings.map((posting) => posting.id)
        )
      : [];

    return buildFeed({ postings, matches, markets, now });
  }

  async getMatches(profileId: string, postingIds: string[]): Promise<Match[]> {
    if (!postingIds.length) return [];
    const { data, error } = await this.db
      .from('matches')
      .select('profile_id, posting_id, score, note, lines')
      .eq('profile_id', profileId)
      .in('posting_id', postingIds);
    if (error) throw new Error(`getMatches: ${error.message}`);

    return (data ?? []).map((row) => ({
      profileId: row.profile_id as string,
      postingId: row.posting_id as string,
      score: row.score as number,
      note: (row.note as string | null) ?? '',
      lines: (row.lines as string[] | null) ?? []
    }));
  }

  /** The Market screen's whole dataset: one entry per city plus 'Texas'. */
  async getMarkets(): Promise<UiMarkets> {
    const { data, error } = await this.db.from('markets').select('city, data');
    if (error) throw new Error(`getMarkets: ${error.message}`);

    const markets: UiMarkets = {};
    for (const row of data ?? []) {
      markets[row.city as string] = row.data as MarketData;
    }
    return markets;
  }
}
