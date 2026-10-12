// Public TABS pages only (no database): learn the page labels and search form fields for followed-project refresh.
const UA = { 'user-agent': 'terra-collector (+https://thougthfullcarrot.github.io/Terra/)' };
const page = await (await fetch('https://www.tdlr.texas.gov/TABS/Search/Project/TABS2025026208', { headers: UA })).text();
const lines = page.replace(/<(script|style)[\s\S]*?<\/\1>/gi, '').replace(/<[^>]+>/g, '\n').replace(/&nbsp;/g, ' ').split('\n').map((l) => l.replace(/\s+/g, ' ').trim()).filter(Boolean);
const i = lines.indexOf('PROJECT');
console.log('PAGE LINES:\n' + lines.slice(Math.max(0, i - 5), i + 120).join('\n'));
const form = await (await fetch('https://www.tdlr.texas.gov/TABS/Search', { headers: UA })).text();
console.log('FORM FIELDS:', [...new Set([...form.matchAll(/name="([^"]+)"/g)].map((m) => m[1]))].join(', '));
const body = new URLSearchParams({ draw: '1', start: '0', length: '5', ProjectNumber: 'TABS2025026208', DataVersionId: '900001' });
const r = await fetch('https://www.tdlr.texas.gov/TABS/Search/SearchProjects', { method: 'POST', body, headers: { ...UA, 'x-requested-with': 'XMLHttpRequest', referer: 'https://www.tdlr.texas.gov/TABS/Search/' } });
const j = await r.json().catch(() => null);
console.log('SEARCH by ProjectNumber:', r.status, JSON.stringify(j?.data?.slice(0, 3) ?? j).slice(0, 1500), 'total', j?.recordsFiltered);
const robots = await (await fetch('https://www.tdlr.texas.gov/robots.txt', { headers: UA })).text();
console.log('ROBOTS:\n' + robots.slice(0, 800));
