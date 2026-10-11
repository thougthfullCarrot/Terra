import type { SupabaseClient } from '@supabase/supabase-js';
import type { HistoryDay } from './history.js';
import type { SendRow, WatchStore } from './sendWatch.js';

/** The WatchStore over Supabase with the service role (tables from migration 0016). */
export function supabaseWatchStore(db: SupabaseClient): WatchStore {
  const check = <T>({ data, error }: { data: T; error: { message: string } | null }): T => {
    if (error) throw new Error(error.message);
    return data;
  };
  const now = () => new Date().toISOString();
  return {
    async history(from, to) {
      const rows = check(await db.from('market_history').select('day, data').gte('day', from).lte('day', to).order('day'));
      return (rows ?? []).map((r: { day: string; data: HistoryDay }) => ({ ...r.data, day: r.day }));
    },
    async sends(userId, eventIds) {
      const out: SendRow[] = [];
      // In slices, so a long list of ids never makes an over-long request URL.
      for (let i = 0; i < eventIds.length; i += 100) {
        const rows = check(
          await db.from('watch_sends').select('event_id, state, attempts').eq('user_id', userId).in('event_id', eventIds.slice(i, i + 100))
        );
        out.push(...((rows ?? []) as SendRow[]));
      }
      return out;
    },
    async claim(userId, rows) {
      check(
        await db.from('watch_sends').upsert(
          rows.map((r) => ({ user_id: userId, event_id: r.event_id, state: 'pending', attempts: r.attempts, last_error: null, updated_at: now() })),
          { onConflict: 'user_id,event_id' }
        )
      );
    },
    async markSent(userId, eventIds) {
      check(await db.from('watch_sends').update({ state: 'sent', sent_at: now(), updated_at: now() }).eq('user_id', userId).in('event_id', eventIds));
    },
    async markFailed(userId, eventIds, error, giveUp) {
      const fields = giveUp ? { state: 'failed', last_error: error, updated_at: now() } : { last_error: error, updated_at: now() };
      check(await db.from('watch_sends').update(fields).eq('user_id', userId).in('event_id', eventIds));
    },
    async setDigestDay(userId, day) {
      check(await db.from('watch_digests').upsert({ user_id: userId, last_day: day }, { onConflict: 'user_id' }));
    }
  };
}
