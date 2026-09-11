import type { Posting, Profile } from '../types.js';
import type { Notifier } from '../collector/run.js';

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';

/**
 * Expo push, used for the 'new strong match' alert the collector fires on
 * insert. A profile with no push token is skipped rather than treated as an
 * error — most profiles will not have granted permission.
 */
export class ExpoNotifier implements Notifier {
  constructor(
    private readonly options: {
      accessToken?: string;
      fetchImpl?: typeof fetch;
    } = {}
  ) {}

  async notify(profile: Profile, postings: Posting[]): Promise<void> {
    if (!profile.pushToken || !postings.length) return;

    const fetchImpl = this.options.fetchImpl ?? fetch;
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (this.options.accessToken) {
      headers.authorization = `Bearer ${this.options.accessToken}`;
    }

    const response = await fetchImpl(EXPO_PUSH_URL, {
      method: 'POST',
      headers,
      body: JSON.stringify([
        {
          to: profile.pushToken,
          title: title(postings),
          body: body(postings),
          data: { postingIds: postings.map((posting) => posting.id) },
          sound: 'default'
        }
      ])
    });

    if (!response.ok) {
      throw new Error(`Expo push failed: ${response.status}`);
    }
  }
}

function title(postings: Posting[]): string {
  return postings.length === 1
    ? 'New match in your feed'
    : `${postings.length} new matches in your feed`;
}

function body(postings: Posting[]): string {
  const first = postings[0] as Posting;
  const lead = `${first.role} at ${first.firm} · ${first.city}`;
  return postings.length === 1 ? lead : `${lead}, and ${postings.length - 1} more.`;
}
