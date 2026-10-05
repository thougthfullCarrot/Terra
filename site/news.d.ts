// Types for news.js, so the backend's tests can import it under strict mode.

export interface Headline {
  title: string;
  url: string;
  source: string;
  publishedAt: string | null;
  topics: string[];
}

export interface NewsFile {
  generatedAt: string;
  source?: string;
  topics: string[];
  cities: Array<{ city: string; fetchedAt: string; headlines: Headline[] }>;
}

export interface NewsState {
  open: boolean;
  city: string;
  topic: string;
}

export function readNewsHash(hash: string | null | undefined, file: NewsFile | null): NewsState;
export function writeNewsHash(state: Partial<NewsState>): string;
export function filterHeadlines(file: NewsFile | null, filter?: { city?: string; topic?: string }): Array<Headline & { cities: string[] }>;
export function topicCounts(file: NewsFile | null, city?: string): Map<string, number>;
export function newsDate(iso: string | null | undefined, now?: Date): string;
