/**
 * TEMPORARY discovery helper (removed before merge): prints raw shapes of candidate event feeds from a runner.
 */
import { fetchText } from '../lib/http.js';

const URLS = [
  'https://calendar.tamu.edu/live/json/events/search/real%20estate/max/3',
  'https://events.rice.edu/live/json/events/search/real%20estate/max/2',
  'https://events.utep.edu/',
  'https://events.utep.edu/api/2/events?pp=2',
  'https://events.ttu.edu/',
  'https://www.abor.com/events',
  'https://events.tcu.edu/',
  'https://calendar.tcu.edu/api/2/events?pp=2&days=120&keyword=real%20estate',
  'https://events.trinity.edu/api/2/events?pp=2&days=120&keyword=business',
  'https://www.galvestonchamber.com/events',
  'https://www.lubbockeda.org/events',
  'https://www.sabor.com/events',
  'https://www.gepar.org/events',
  'https://www.gcar.net/events',
  'https://www.bisnow.com/events/houston',
  'https://www.bisnow.com/events/dallas-ft-worth',
  'https://www.bisnow.com/events/austin-san-antonio',
  'https://www.dallaschamber.org/events',
  'https://www.houston.org/events',
  'https://www.austinchamber.com/events',
  'https://www.sachamber.org/events'
];

async function main(): Promise<void> {
  for (const url of URLS) {
    try {
      const body = await fetchText(url, { retries: 1, timeoutMs: 15_000, accept: '*/*' });
      const ld = [...body.matchAll(/application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)].map((m) => (m[1] ?? '').slice(0, 300)).filter((t) => /Event/.test(t)).slice(0, 2);
      const hints = [...new Set([...body.matchAll(/(localist|livewhale|trumba|growthzone|tribe-events|wp-json|eventbrite|ical|\.ics|starchapter|wix|squarespace|hubspot|novi|cvent|ymcdn|memberclicks|yourmembership|webcal)/gi)].map((m) => m[1]!.toLowerCase()))].join(',');
      const ics = [...new Set([...body.matchAll(/href="([^"]*(?:ical|\.ics|webcal|rss)[^"]*)"/gi)].map((m) => m[1]))].slice(0, 4).join(' ');
      console.log(`RAW ${url} len=${body.length} hints=${hints} feeds=${ics}\n  head=${body.slice(0, 500).replace(/\s+/g, ' ')}\n  ld=${ld.join(' || ')}`);
    } catch (e) {
      console.log(`RAW ${url} ERR ${(e as Error).message.slice(0, 100)}`);
    }
  }
}
main();
