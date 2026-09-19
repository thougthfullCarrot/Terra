import { useCallback, useEffect, useMemo, useState } from 'react';
import { fetchFeed, simulateFailure, SOURCE } from './data/source';
import type { MatchIndex, Markets, Posting, Stage } from './data/types';
import { filterFeed, nextStage, sortByDeadline, stageNote, toggleFilter } from './logic/feed';

export type Status = 'loading' | 'ready' | 'error';
export type Tab = 'feed' | 'market' | 'pipeline' | 'saved' | 'profile';

export const CITIES = ['All Texas', 'Dallas', 'Fort Worth', 'Houston', 'Austin', 'San Antonio'] as const;
export const TYPES = ['All roles', 'Internship', 'Entry-level'] as const;
export const MARKET_CITIES = ['Austin', 'Dallas', 'Houston', 'San Antonio', 'Fort Worth', 'El Paso'] as const;
export const STAGES: Stage[] = ['Applied', 'Interview', 'Offer'];

export interface Application {
  stage: Stage;
  note: string;
}

export interface Prefs {
  digest: boolean;
  deadlines: boolean;
  internsOnly: boolean;
  market: boolean;
}

/**
 * The whole client state, exactly the list in the handoff.
 *
 * `saved`, `apps` and `prefs` live in memory here. In production they persist
 * per profile in Postgres — the swap is in this hook, not in any screen.
 */
export function useApp() {
  const [status, setStatus] = useState<Status>('loading');
  const [error, setError] = useState<string | null>(null);
  const [jobs, setJobs] = useState<Posting[]>([]);
  const [matchIndex, setMatchIndex] = useState<MatchIndex>({});
  const [markets, setMarkets] = useState<Markets>({});
  const [lastSync, setLastSync] = useState<Date | null>(null);

  const [tab, setTab] = useState<Tab>('feed');
  const [city, setCity] = useState<string>('All Texas');
  const [type, setType] = useState<string>('All roles');
  const [matchOnly, setMatchOnly] = useState(false);
  const [mktCity, setMktCity] = useState<string>('Texas');
  const [detail, setDetail] = useState<string | null>(null);

  const [saved, setSaved] = useState<Record<string, true>>({});
  const [apps, setApps] = useState<Record<string, Application>>({});
  const [prefs, setPrefs] = useState<Prefs>({
    digest: true,
    deadlines: true,
    internsOnly: false,
    market: true
  });

  const load = useCallback(async () => {
    setStatus('loading');
    setError(null);
    try {
      const feed = await fetchFeed({ state: 'TX' });
      setJobs(feed.jobs);
      setMatchIndex(feed.match);
      setMarkets(feed.markets);
      setLastSync(feed.syncedAt);
      setStatus('ready');
    } catch (cause) {
      // The error card prints this message verbatim, so it is shown as thrown.
      setError(cause instanceof Error ? cause.message : 'Source unreachable');
      setStatus('error');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const scoreOf = useCallback((id: string) => matchIndex[id]?.score ?? 0, [matchIndex]);
  const isStrong = useCallback((id: string) => scoreOf(id) >= 92, [scoreOf]);

  /** Feed order and filters. Re-tapping an active chip clears it; see setters below. */
  const feed = useMemo(
    () => filterFeed(jobs, { city, type, matchOnly }, scoreOf, isStrong),
    [jobs, city, type, matchOnly, isStrong, scoreOf]
  );

  const strongCount = useMemo(
    () => jobs.filter((job) => isStrong(job.id)).length,
    [jobs, isStrong]
  );

  const savedJobs = useMemo(
    () => sortByDeadline(jobs.filter((job) => saved[job.id])),
    [jobs, saved]
  );

  const toggleSave = useCallback((id: string) => {
    setSaved((current) => {
      const next = { ...current };
      if (next[id]) delete next[id];
      else next[id] = true;
      return next;
    });
  }, []);

  /** Applying moves a posting into the pipeline and clears it from Saved. */
  const apply = useCallback((id: string) => {
    setApps((current) =>
      current[id]
        ? current
        : { ...current, [id]: { stage: 'Applied', note: stageNote('Applied') } }
    );
    setSaved((current) => {
      const next = { ...current };
      delete next[id];
      return next;
    });
  }, []);

  const advance = useCallback((id: string) => {
    setApps((current) => {
      const app = current[id];
      if (!app) return current;
      const next = nextStage(app.stage);
      if (!next) return current;
      return { ...current, [id]: { stage: next, note: stageNote(next) } };
    });
  }, []);

  const removeSaved = useCallback((id: string) => {
    setSaved((current) => {
      const next = { ...current };
      delete next[id];
      return next;
    });
  }, []);

  const togglePref = useCallback((key: keyof Prefs) => {
    setPrefs((current) => ({ ...current, [key]: !current[key] }));
  }, []);

  /** Re-tapping the active chip clears the filter, per the handoff. */
  const pickCity = useCallback((value: string) => {
    setCity((current) => toggleFilter(current, value, 'All Texas'));
  }, []);
  const pickType = useCallback((value: string) => {
    setType((current) => toggleFilter(current, value, 'All roles'));
  }, []);
  const pickMarketCity = useCallback((value: string) => {
    setMktCity((current) => toggleFilter(current, value, 'Texas'));
  }, []);

  /** The Market screen's "See all Texas roles" jumps to a pre-filtered feed. */
  const seeJobsIn = useCallback((value: string) => {
    setCity(value === 'Texas' ? 'All Texas' : value);
    setType('All roles');
    setMatchOnly(false);
    setDetail(null);
    setTab('feed');
  }, []);

  const openTab = useCallback((next: Tab) => {
    setTab(next);
    setDetail(null);
  }, []);

  const breakSource = useCallback(() => {
    simulateFailure();
    void load();
  }, [load]);

  return {
    status,
    error,
    jobs,
    matchIndex,
    markets,
    lastSync,
    source: SOURCE,
    tab,
    city,
    type,
    matchOnly,
    mktCity,
    detail,
    saved,
    apps,
    prefs,

    feed,
    savedJobs,
    strongCount,
    scoreOf,
    isStrong,

    load,
    openTab,
    pickCity,
    pickType,
    pickMarketCity,
    seeJobsIn,
    setMatchOnly,
    setDetail,
    toggleSave,
    removeSaved,
    apply,
    advance,
    togglePref,
    breakSource
  };
}

export type App = ReturnType<typeof useApp>;
