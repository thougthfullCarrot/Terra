// Types for unsubscribe.js, so the backend's tests can import it under strict mode.

export function handleUnsubscribe(
  config: { supabaseUrl?: string; supabaseAnonKey?: string } | null,
  location: { search: string },
  fetchImpl?: typeof fetch
): Promise<null | { ok: boolean; text: string }>;
export function clearUnsubscribe(location: Location, history: History): void;
