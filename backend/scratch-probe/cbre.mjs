// Temporary: can CBRE's Avature board be read from a runner? Removed before merge.
const H = { 'user-agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36', accept: 'text/html,application/xhtml+xml', 'accept-language': 'en-US,en;q=0.9' };
const base = 'https://careers.cbre.com/en_US/careers';
const urls = [
  `${base}/SearchJobs/?jobRecordsPerPage=25`,
  `${base}/SearchJobs/?9577=%5B17276%5D&9577_format=10224&listFilterMode=1&jobRecordsPerPage=25`,
  `${base}/SearchJobs/?jobRecordsPerPage=25&jobOffset=25`,
  `${base}/SearchJobs/?search=texas&jobRecordsPerPage=25`,
  `${base}/SearchJobs/feed/`,
  `${base}/SearchJobs/?jobRecordsPerPage=25&format=rss`
];
for (const url of urls) {
  try {
    const r = await fetch(url, { headers: H, redirect: 'follow', signal: AbortSignal.timeout(30000) });
    const t = await r.text();
    const links = [...t.matchAll(/href="([^"]*JobDetail[^"]*)"/g)].map((m) => m[1]);
    console.log(`\n== ${url}\n${r.status} ${t.length} bytes, ${links.length} JobDetail links, type ${r.headers.get('content-type')}`);
    console.log('first links:', [...new Set(links)].slice(0, 3).join(' | '));
    const i = t.indexOf('JobDetail');
    if (i > 0) console.log('ROW:', t.slice(Math.max(0, i - 600), i + 1400).replace(/\s+/g, ' '));
    else console.log('HEAD:', t.slice(0, 600).replace(/\s+/g, ' '));
    const next = t.match(/paginationNextLink[^>]*href="([^"]+)"|href="([^"]+)"[^>]*paginationNextLink/);
    if (next) console.log('NEXT:', next[1] ?? next[2]);
    const tx = [...t.matchAll(/([0-9]{6,8})[^<]{0,200}Texas|Texas[^<]{0,200}?([0-9]{6,8})/g)].slice(0, 5).map((m) => m[0].slice(0, 160));
    if (tx.length) console.log('TEXAS facet bits:', tx.join(' || '));
    const facet = [...t.matchAll(/name="(\d{4,6})"[^>]*value="(\d+)"[^>]*>[\s\S]{0,300}?Texas/g)].slice(0, 3).map((m) => `${m[1]}=${m[2]}`);
    if (facet.length) console.log('FACET:', facet.join(', '));
  } catch (e) {
    console.log(`\n== ${url}\nERR ${e}`);
  }
}
