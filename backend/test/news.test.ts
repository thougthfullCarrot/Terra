import { describe, expect, it } from 'vitest';
import {
  buildNewsFile,
  citiesNamedIn,
  cleanTitle,
  decodeXml,
  headlinesFrom,
  isCreHeadline,
  newsSearchUrl,
  parseRss,
  topicsFor,
  type NewsFile,
  yahooFinanceUrl,
  type RssItem
} from '../src/news/googleNews.js';
import { filterHeadlines, newsDate, readNewsHash, topicCounts, writeNewsHash } from '../../site/news.js';

const now = new Date('2026-10-05T12:00:00Z');

const RSS = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel><title>"Houston" - Google News</title>
<item>
  <title>Developer breaks ground on 30-story Montrose tower &amp; plaza - Houston Business Journal</title>
  <link>https://news.google.com/rss/articles/abc?oc=5</link>
  <guid isPermaLink="false">abc</guid>
  <pubDate>Sat, 04 Oct 2026 14:30:00 GMT</pubDate>
  <description>&lt;a href="https://news.google.com/rss/articles/abc"&gt;Developer breaks ground&lt;/a&gt;</description>
  <source url="https://www.bizjournals.com">Houston Business Journal</source>
</item>
<item>
  <title><![CDATA[Astros win Game 3 - Houston Chronicle]]></title>
  <link>https://news.google.com/rss/articles/def?oc=5</link>
  <pubDate>Sat, 04 Oct 2026 10:00:00 GMT</pubDate>
  <source url="https://www.houstonchronicle.com">Houston Chronicle</source>
</item>
<item>
  <title>Warehouse portfolio sold to REIT - Bisnow</title>
  <link>javascript:alert(1)</link>
  <source url="https://www.bisnow.com">Bisnow</source>
</item>
</channel></rss>`;

function item(title: string, publishedAt: string | null, link = `https://example.com/${encodeURIComponent(title)}`): RssItem {
  return { title, link, source: 'Example News', sourceUrl: null, publishedAt };
}

describe('Google News RSS', () => {
  it('asks Google News for the city and CRE topics within the window', () => {
    const url = new URL(newsSearchUrl('Fort Worth'));
    expect(url.host).toBe('news.google.com');
    expect(url.searchParams.get('q')).toContain('"Fort Worth"');
    expect(url.searchParams.get('q')).toContain('"commercial real estate"');
    expect(url.searchParams.get('q')).toMatch(/when:30d$/);
  });

  it('parses items, decoding entities and CDATA and skipping non-http links', () => {
    const items = parseRss(RSS);
    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({
      title: 'Developer breaks ground on 30-story Montrose tower & plaza - Houston Business Journal',
      link: 'https://news.google.com/rss/articles/abc?oc=5',
      source: 'Houston Business Journal',
      sourceUrl: 'https://www.bizjournals.com',
      publishedAt: '2026-10-04T14:30:00.000Z'
    });
    expect(items[1]!.title).toBe('Astros win Game 3 - Houston Chronicle');
  });

  it('decodes numeric entities', () => {
    expect(decodeXml('H&#8209;E&#x2011;B&#39;s new store')).toBe('H‑E‑B\'s new store');
  });

  it('drops the publisher suffix only when it matches the source', () => {
    expect(cleanTitle('Tower planned - Dallas Morning News', 'Dallas Morning News')).toBe('Tower planned');
    expect(cleanTitle('Plans - and more plans', 'Bisnow')).toBe('Plans - and more plans');
  });

  it('keeps CRE headlines and tags their topics', () => {
    expect(isCreHeadline('Astros win Game 3')).toBe(false);
    expect(isCreHeadline('Developer breaks ground on 30-story tower')).toBe(true);
    expect(topicsFor('Developer breaks ground on mixed-use project with 300 apartments')).toEqual(['Development', 'Multifamily']);
    expect(topicsFor('Blackstone acquires 1M square-foot warehouse portfolio')).toEqual(['Industrial', 'Deals']);
    expect(topicsFor('Law firm signs lease for new office headquarters')).toEqual(['Office', 'Deals']);
  });

  it('drops crime, sports, weather and same-name places, and merges one story from two papers', () => {
    const headlines = headlinesFrom(
      [
        item('Man critically injured in late-night shooting outside Dallas apartments', '2026-10-04T00:00:00Z'),
        item("Unexpected development on final injury report boosts the Dallas Cowboys' chances", '2026-10-04T00:00:00Z'),
        item('Tropical update: 40% chance for development in the Gulf', '2026-10-04T00:00:00Z'),
        item('Houston County candidates oppose data center development', '2026-10-04T00:00:00Z'),
        item('Letters — Public education, Mesquite apartments', '2026-10-04T00:00:00Z'),
        item('Machine Investment Group Acquires 490-Unit North Dallas Multifamily Community', '2026-10-03T00:00:00Z'),
        item('Machine Investment Group Acquires 490-Unit Multifamily Community in North Dallas', '2026-10-02T00:00:00Z'),
        item('Freehill Starts Work on 1.6M-SF Houston Warehouse Project', '2026-10-01T00:00:00Z')
      ],
      now
    );
    expect(headlines.map((h) => h.title)).toEqual([
      'Machine Investment Group Acquires 490-Unit North Dallas Multifamily Community',
      'Freehill Starts Work on 1.6M-SF Houston Warehouse Project'
    ]);
  });

  it('filters, dedupes and sorts a city’s headlines newest first', () => {
    const headlines = headlinesFrom(
      [
        item('Office tower sold downtown', '2026-10-01T00:00:00Z'),
        item('Astros win Game 3', '2026-10-04T00:00:00Z'),
        item('Office Tower Sold Downtown!', '2026-10-02T00:00:00Z', 'https://example.com/copy'),
        item('Old warehouse news', '2026-08-01T00:00:00Z'),
        item('New apartments planned', '2026-10-03T00:00:00Z')
      ],
      now
    );
    expect(headlines.map((h) => h.title)).toEqual(['New apartments planned', 'Office Tower Sold Downtown!']);
  });

  it('keeps a failed city’s earlier headlines and drops none it never had', async () => {
    const previous: NewsFile = {
      generatedAt: '2026-10-04T00:00:00Z',
      source: 'Google News',
      topics: [],
      cities: [{ city: 'Austin', fetchedAt: '2026-10-04T00:00:00Z', headlines: [{ title: 'Old', url: 'https://x', source: 'X', publishedAt: null, topics: [] }] }]
    };
    const file = await buildNewsFile(now, previous, {
      fetchCity: async (city) => {
        if (city === 'Austin' || city === 'El Paso') throw new Error('timeout');
        return [item(`${city} tower planned`, '2026-10-04T00:00:00Z')];
      },
      fetchShared: async () => [],
      log: () => {}
    });
    expect(file.cities.map((c) => c.city)).toEqual(['Dallas', 'Fort Worth', 'Houston', 'Austin', 'San Antonio', 'New Braunfels', 'College Station', 'Galveston', 'Lubbock', 'Midland']);
    expect(file.cities.find((c) => c.city === 'Austin')?.headlines[0]?.title).toBe('Old');
    expect(file.topics).toContain('Development');
  });

  it('adds Yahoo Finance stories to the cities they name', async () => {
    const yahoo: RssItem[] = [
      { ...item('Camden buys apartment community', '2026-10-03T00:00:00Z'), source: 'Yahoo Finance', summary: 'The 300-unit Houston property...' },
      { ...item('Prologis leases DFW warehouse', '2026-10-02T00:00:00Z'), source: 'Yahoo Finance' },
      { ...item('CBRE reports third-quarter property results', '2026-10-02T00:00:00Z'), source: 'Yahoo Finance' }
    ];
    const file = await buildNewsFile(now, null, { fetchCity: async () => [], fetchShared: async () => yahoo, log: () => {} });
    const titles = (city: string) => file.cities.find((c) => c.city === city)?.headlines.map((h) => h.title) ?? [];
    expect(titles('Houston')).toEqual(['Camden buys apartment community']);
    expect(titles('Dallas')).toEqual(['Prologis leases DFW warehouse']);
    expect(titles('Fort Worth')).toEqual(['Prologis leases DFW warehouse']);
    expect(file.cities.find((c) => c.city === 'Austin')?.headlines).toEqual([]);
  });

  it('asks Yahoo Finance for the real estate tickers and names cities in text', () => {
    expect(new URL(yahooFinanceUrl(['CBRE', 'PLD'])).searchParams.get('s')).toBe('CBRE,PLD');
    expect(citiesNamedIn('Hines plans San Antonio and Ft. Worth projects')).toEqual(['Fort Worth', 'San Antonio']);
    expect(citiesNamedIn('Austin Powers')).toEqual(['Austin']);
  });

  it('keeps the description out of parsed items’ published fields', () => {
    expect(parseRss(RSS)[0]!.summary).toBe('Developer breaks ground');
  });
});

describe('news page rules', () => {
  const file = {
    generatedAt: now.toISOString(),
    topics: ['Development', 'Office', 'Deals'],
    cities: [
      {
        city: 'Dallas',
        fetchedAt: now.toISOString(),
        headlines: [
          { title: 'A', url: 'https://a', source: 'S', publishedAt: '2026-10-01T00:00:00Z', topics: ['Development'] },
          { title: 'Shared', url: 'https://shared', source: 'S', publishedAt: '2026-10-04T00:00:00Z', topics: ['Deals'] }
        ]
      },
      {
        city: 'Fort Worth',
        fetchedAt: now.toISOString(),
        headlines: [{ title: 'Shared', url: 'https://shared', source: 'S', publishedAt: '2026-10-04T00:00:00Z', topics: ['Deals'] }]
      }
    ]
  };

  it('reads and writes the hash, ignoring unknown values', () => {
    expect(readNewsHash('#news&city=Dallas&topic=Office', file)).toEqual({ open: true, city: 'Dallas', topic: 'Office' });
    expect(readNewsHash('#news&city=Paris&topic=Nope', file)).toEqual({ open: true, city: '', topic: '' });
    expect(readNewsHash('#markets', file).open).toBe(false);
    expect(writeNewsHash({ city: 'Fort Worth', topic: '' })).toBe('#news&city=Fort+Worth');
    expect(writeNewsHash({})).toBe('#news');
  });

  it('lists a story found for two cities once, under both', () => {
    const all = filterHeadlines(file);
    expect(all.map((h) => h.title)).toEqual(['Shared', 'A']);
    expect(all[0]!.cities).toEqual(['Dallas', 'Fort Worth']);
    expect(filterHeadlines(file, { city: 'Fort Worth' }).map((h) => h.title)).toEqual(['Shared']);
    expect(filterHeadlines(file, { topic: 'Development' }).map((h) => h.title)).toEqual(['A']);
  });

  it('counts topics under the chosen city', () => {
    expect(Object.fromEntries(topicCounts(file))).toEqual({ Development: 1, Office: 0, Deals: 1 });
    expect(Object.fromEntries(topicCounts(file, 'Fort Worth'))).toEqual({ Development: 0, Office: 0, Deals: 1 });
  });

  it('labels dates relative to today', () => {
    const local = new Date(2026, 9, 5, 12);
    expect(newsDate(new Date(2026, 9, 5, 8).toISOString(), local)).toBe('Today');
    expect(newsDate(new Date(2026, 9, 4, 8).toISOString(), local)).toBe('Yesterday');
    expect(newsDate(new Date(2026, 9, 2, 8).toISOString(), local)).toBe('3 days ago');
    expect(newsDate(new Date(2026, 8, 20, 8).toISOString(), local)).toBe('Sep 20');
    expect(newsDate(null, local)).toBe('');
  });
});
