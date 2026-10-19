// Events tab check against a built site/events.json.
//
//   CHROMIUM_PATH=/opt/pw-browsers/chromium node test/browser/events-check.mjs [site dir] [screenshot dir]
//
// Serves the site folder, picks from events.json an evening event, an all-day
// event, one occurrence of a repeating event and a multi-day event (any shape
// missing from the data is reported as MISSING), and for each, on desktop and
// phone: opens the Events tab on the event's market, finds its card, compares
// the time line with one computed here from the raw ISO times (not with
// site/events.js), opens "Add to calendar" and reads the downloaded .ics, and
// reads the Google Calendar link's dates and zone. It also checks the per-market
// empty states against the collection report and that the phone page does not
// scroll sideways. Read-only; no network besides the local server.
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { extname, join, resolve } from 'node:path';
import { chromium } from 'playwright-core';

const siteDir = resolve(process.argv[2] ?? '../site');
const shots = process.argv[3] ? resolve(process.argv[3]) : null;
const file = JSON.parse(await readFile(join(siteDir, 'events.json'), 'utf8'));
const now = Date.now();
const all = file.cities.flatMap((c) => c.events).filter((e) => new Date(e.end ?? e.start).getTime() + 86_400_000 > now);
const zone = (e) => e.timezone || (e.city === 'El Paso' ? 'America/Denver' : 'America/Chicago');
const local = (iso, tz, o) => new Date(iso).toLocaleString('en-US', { timeZone: tz, ...o });
const hour = (e) => Number(local(e.start, zone(e), { hour: 'numeric', hourCycle: 'h23' }));
const ymd = (iso, tz) => new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(new Date(iso));
const midnight = (iso, tz) => local(iso, tz, { hour: 'numeric', minute: '2-digit' }) === '12:00 AM';
const multi = (e) => e.end && ymd(e.end, zone(e)) > ymd(e.start, zone(e));

const plain = all.filter((e) => !e.sessions && !e.spanUnverified);
const picks = {
  evening: plain.find((e) => !multi(e) && !midnight(e.start, zone(e)) && hour(e) >= 17 && e.format !== 'virtual'),
  'all-day': plain.find((e) => !multi(e) && midnight(e.start, zone(e))),
  recurring: plain.find((e) => e.seriesId),
  'multi-day': plain.find((e) => multi(e)),
  course: all.find((e) => e.sessions?.length)
};
const unverified = all.find((e) => e.spanUnverified);
// The session that is next (or running now), as the card's date block and the Google link use it.
const next = (e) => e.sessions.find((x) => new Date(x.end ?? x.start).getTime() >= now) ?? e.sessions.at(-1);

/** The card's time line, worked out from the raw times. */
function expectedWhen(e) {
  const tz = zone(e);
  const label = tz === 'America/Denver' ? 'MT' : 'CT';
  if (e.sessions) return `${e.sessions.length} sessions, ${local(e.sessions[0].start, tz, { month: 'short', day: 'numeric' })} \u2013 ${local(e.sessions.at(-1).start, tz, { month: 'short', day: 'numeric' })}`;
  const t = (iso) => local(iso, tz, { hour: 'numeric', minute: '2-digit' });
  const d = (iso) => local(iso, tz, { month: 'short', day: 'numeric' });
  if (multi(e)) return midnight(e.start, tz) ? `${d(e.start)} – ${d(e.end)}` : `${d(e.start)} – ${d(e.end)} · starts ${t(e.start)} ${label}`;
  if (e.timeUnconfirmed) return 'Time not confirmed';
  if (midnight(e.start, tz)) return e.dateOnly ? 'Time not listed' : 'All day';
  const end = e.end && !midnight(e.end, tz) && new Date(e.end) > new Date(e.start) ? ` – ${t(e.end)}` : '';
  return `${t(e.start)}${end} ${label}`;
}

/** DTSTART/DTEND the .ics must carry: dates for all-day (DTEND the day after the last), UTC instants otherwise. */
function expectedIcs(e) {
  if (e.sessions) e = { ...e, ...next(e), sessions: undefined };
  const tz = zone(e);
  const stamp = (ms) => new Date(ms).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  if (midnight(e.start, tz)) {
    const last = e.end ? ymd(e.end, tz) : ymd(e.start, tz);
    const after = new Date(`${last}T12:00:00Z`);
    after.setUTCDate(after.getUTCDate() + 1);
    return { start: `DTSTART;VALUE=DATE:${ymd(e.start, tz).replace(/-/g, '')}`, end: `DTEND;VALUE=DATE:${after.toISOString().slice(0, 10).replace(/-/g, '')}` };
  }
  const s = new Date(e.start).getTime();
  const end = e.end && new Date(e.end).getTime() > s ? new Date(e.end).getTime() : s + 3_600_000;
  return { start: `DTSTART:${stamp(s)}`, end: `DTEND:${stamp(end)}` };
}

const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml' };
const server = createServer(async (req, res) => {
  const raw = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  const path = raw.endsWith('/') ? `${raw}index.html` : raw;
  try {
    const body = await readFile(join(siteDir, path));
    res.writeHead(200, { 'content-type': types[extname(path)] ?? 'application/octet-stream' }).end(body);
  } catch {
    res.writeHead(404).end();
  }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}/`;

let failed = 0;
const pass = (m) => console.log(`PASS  ${m}`);
const fail = (m) => {
  failed++;
  console.log(`FAIL  ${m}`);
};
const check = (ok, m) => (ok ? pass(m) : fail(m));

for (const [shape, e] of Object.entries(picks)) {
  if (!e) console.log(`MISSING  no ${shape} event in events.json`);
  else console.log(`PICK  ${shape}: "${e.title}" (${e.organizer}, ${e.city}) ${e.start} → ${e.end ?? 'no end'} ${e.url}`);
}

// Sample results for every market: the report line and the first few events, so a reviewer sees real data.
for (const r of file.report ?? []) {
  const events = file.cities.find((c) => c.city === r.city)?.events ?? [];
  console.log(`MARKET  ${r.city}: ${r.state}, ${r.sourcesOk}/${r.sourcesChecked} sources read, ${r.upcoming} upcoming, ${r.virtual} virtual, ${r.duplicatesRemoved} duplicates merged, ${r.stale} kept from earlier, last verified ${r.lastVerifiedAt ?? 'never'}`);
  for (const e of events.slice(0, 3)) console.log(`  SAMPLE  ${e.start} ${e.end ? `→ ${e.end} ` : ''}| ${e.title} | ${e.organizer} | ${e.venue ?? 'venue not listed'}${e.cost ? ` | ${e.cost}` : ''}${e.format ? ` | ${e.format}` : ''}${e.status ? ` | ${e.status}` : ''}${e.seriesId ? ' | repeats' : ''}`);
}
// Place audit: an event whose venue or address names a different market than the one it is listed under.
const MARKETS = file.cities.map((c) => c.city);
for (const e of all) {
  if (e.format === 'virtual') continue;
  const text = `${e.venue ?? ''} ${e.address ?? ''}`;
  const named = MARKETS.filter((m) => m !== e.city && new RegExp(`\\b${m}\\b(?!\\s+(?:St|Street|Ave|Avenue|Blvd|Rd|Road|Hwy)\\b)`, 'i').test(text));
  if (named.length) console.log(`PLACE CHECK  "${e.title}" listed under ${e.city}, venue "${text.trim()}" names ${named.join(', ')}`);
}
const law = all.filter((e) => /\bLEB\b|Law (?:and|&) Education Building/i.test(`${e.venue ?? ''}`) && /Texas A&M/.test(e.organizer));
for (const e of law) check(e.city === 'Fort Worth', `"${e.title}" (Texas A&M Law, ${e.venue}) is listed under Fort Worth, not ${e.city}`);
for (const e of all.filter((x) => x.sessions)) console.log(`COURSE  "${e.title}" (${e.organizer}) ${e.sessions.length} sessions ${e.sessions.map((x) => x.start).join(', ')} enrollment ${e.enrollment}${e.conflicts ? ` CONFLICT ${e.conflicts.join(' ')}` : ''}`);
for (const e of all.filter((x) => x.spanUnverified)) console.log(`LONG RANGE, NO SESSIONS  "${e.title}" (${e.organizer}) ${e.start} → ${e.end}`);
for (const s of file.sources ?? []) if (s.ok === false) console.log(`SOURCE FAILED  ${s.organizer} (${s.city ?? 'all'}): ${s.error ?? ''}`);

const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
if (shots) await mkdir(shots, { recursive: true });
for (const vp of [
  { name: 'desktop', width: 1366, height: 1000 },
  { name: 'phone', width: 390, height: 844, mobile: true },
  // 200% browser zoom on a 1366px window: the page lays out at 683 CSS px.
  { name: 'zoom200', width: 683, height: 500, scale: 2 }
]) {
  const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, isMobile: !!vp.mobile, hasTouch: !!vp.mobile, deviceScaleFactor: vp.scale ?? 1, acceptDownloads: true });
  await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => r.abort());
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (err) => errors.push(err.message));

  for (const [shape, e] of Object.entries(picks)) {
    if (!e) continue;
    const city = e.format === 'virtual' ? 'Online' : e.city;
    await page.goto(`${base}#events&city=${encodeURIComponent(city)}`);
    await page.waitForSelector('#e-list .event-card, #e-list .state', { timeout: 20000 });
    const card = page.locator('.event-card', { has: page.locator('.event-title', { hasText: e.title }) }).filter({ has: page.locator(`time[datetime="${e.sessions ? next(e).start : e.start}"]`) }).first();
    if (!(await card.count())) {
      fail(`${vp.name} ${shape}: card for "${e.title}" not shown under ${city}`);
      continue;
    }
    await card.scrollIntoViewIfNeeded();
    const where = (await card.locator('.event-where').innerText()).split(' · ');
    const want = expectedWhen(e);
    check(where.join(' · ').startsWith(want), `${vp.name} ${shape}: time line "${where.join(' · ')}" starts with "${want}"`);
    const block = await card.locator('time.date-block').innerText();
    const day = local(e.sessions ? next(e).start : e.start, zone(e), { day: 'numeric' });
    check(block.replace(/\s+/g, ' ').includes(day), `${vp.name} ${shape}: date block "${block.replace(/\s+/g, ' ')}" shows day ${day}`);

    if (e.sessions) {
      check(await card.locator('.badge-status, .badge-topic', { hasText: /Course/ }).count() > 0 || (await card.innerText()).includes('Registration closed'), `${vp.name} course: labelled as a course (${e.enrollment})`);
      check(e.enrollment === 'open' || !(await card.locator('a', { hasText: 'Register' }).count()), `${vp.name} course: no Register link while ${e.enrollment}`);
      // Month heading and mini calendar follow the same next-session date as the card.
      const nd = ymd(next(e).start, zone(e));
      const heading = await card.evaluate((n) => n.closest('.events-month')?.querySelector('.events-month-title')?.textContent ?? '');
      const wantMonth = local(next(e).start, zone(e), { month: 'long', year: 'numeric' });
      check(heading === wantMonth, `${vp.name} course: listed under "${heading}", the month of its next session (${wantMonth})`);
      for (let i = 0; i < 12 && !(await page.locator(`#e-cal button[aria-label^="${nd}:"]`).count()); i++) {
        const fwd = page.locator('#e-cal .cal-nav').last();
        if (await fwd.isDisabled()) break;
        await fwd.click();
      }
      check((await page.locator(`#e-cal button[aria-label^="${nd}:"]`).count()) > 0, `${vp.name} course: mini calendar marks ${nd}, its next session`);
      for (const c of e.conflicts ?? []) check((await card.innerText()).includes(c), `${vp.name} course: shows the page conflict "${c}"`);
    }
    const google = new URL(await card.locator('a', { hasText: 'Google Calendar' }).getAttribute('href'));
    const ics = expectedIcs(e);
    const dates = google.searchParams.get('dates');
    check(dates === `${ics.start.split(':')[1]}/${ics.end.split(':')[1]}`, `${vp.name} ${shape}: Google dates ${dates}`);
    check(google.searchParams.get('ctz') === zone(e), `${vp.name} ${shape}: Google zone ${google.searchParams.get('ctz')}`);

    const [download] = await Promise.all([page.waitForEvent('download'), card.locator('button', { hasText: /Add (to calendar|all sessions)/ }).click()]);
    const text = await readFile(await download.path(), 'utf8');
    check(text.includes(`${ics.start}\r\n`) && text.includes(`${ics.end}\r\n`), `${vp.name} ${shape}: .ics has ${ics.start} and ${ics.end}`);
    if (e.sessions) check((text.match(/BEGIN:VEVENT/g) ?? []).length === e.sessions.length && !/VALUE=DATE/.test(text), `${vp.name} course: .ics has one timed entry per session (${e.sessions.length}), no all-day block`);
    check(text.includes(`URL:${e.url.replace(/([,;])/g, '\\$1')}`), `${vp.name} ${shape}: .ics links the event page`);
    if (shots) await card.screenshot({ path: join(shots, `${shape}-${vp.name}.png`) });
  }

  if (unverified) {
    await page.goto(`${base}#events&city=${encodeURIComponent(unverified.city)}`);
    await page.waitForSelector('#e-list .event-card', { timeout: 20000 });
    const card = page.locator('.event-card').filter({ has: page.locator(`time[datetime="${unverified.start}"]`) }).filter({ hasText: unverified.title }).first();
    check((await card.count()) && !(await card.locator('button', { hasText: /Add (to calendar|all sessions)/ }).count()), `${vp.name}: "${unverified.title}" (no session dates) offers no calendar export`);
  }

  // Times a page lists as TBD: the card says so and both exports keep the date with a note, no clock time.
  for (const u of all.filter((x) => x.timeUnconfirmed).slice(0, 3)) {
    await page.goto(`${base}#events&city=${encodeURIComponent(u.city)}`);
    await page.waitForSelector('#e-list .event-card', { timeout: 20000 });
    const card = page.locator('.event-card').filter({ has: page.locator(`time[datetime="${u.start}"]`) }).filter({ hasText: u.title }).first();
    if (!(await card.count())) {
      fail(`${vp.name}: card for "${u.title}" (time TBD) not shown`);
      continue;
    }
    const day = ymd(u.start, zone(u)).replace(/-/g, '');
    check((await card.locator('.event-where').innerText()).startsWith('Time not confirmed') && !/\b\d{1,2}:\d{2}\b/.test(await card.locator('.event-where').innerText()), `${vp.name}: "${u.title}" (${u.organizer}) reads "Time not confirmed"`);
    const g = new URL(await card.locator('a', { hasText: 'Google Calendar' }).getAttribute('href'));
    check(g.searchParams.get('dates').startsWith(`${day}/`) && /Time not confirmed/.test(g.searchParams.get('details')), `${vp.name}: "${u.title}" Google link ${g.searchParams.get('dates')}, notes the time is not confirmed`);
    const [dl] = await Promise.all([page.waitForEvent('download'), card.locator('button', { hasText: 'Add to calendar' }).click()]);
    const t = await readFile(await dl.path(), 'utf8');
    check(t.includes(`DTSTART;VALUE=DATE:${day}\r\n`) && /Time not confirmed/.test(t), `${vp.name}: "${u.title}" .ics is date-only (${day}) and notes the time is not confirmed`);
    check(!(await card.innerText()).includes('Moved from') && !(await card.innerText()).includes('Rescheduled'), `${vp.name}: "${u.title}" is not labelled as moved`);
  }

  // Empty markets: the sentence must match the report (unreadable vs nothing found).
  for (const r of file.report ?? []) {
    if (r.state === 'events') continue;
    await page.goto(`${base}#events&city=${encodeURIComponent(r.city)}`);
    await page.waitForSelector('#e-list .state, #e-list .event-card', { timeout: 20000 });
    const text = await page.locator('#e-list').innerText();
    const ok = r.state === 'unreadable' ? /Couldn't read/.test(text) : r.state === 'no-sources' ? /can be read automatically yet/.test(text) : /No upcoming events found/.test(text);
    check(ok, `${vp.name} ${r.city} (${r.state}): "${text.trim().slice(0, 90)}"`);
  }

  await page.goto(`${base}#events`);
  await page.waitForSelector('#e-list .event-card', { timeout: 20000 });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  // Name what sticks out, so a failure says which card or label to fix.
  const wide = await page.evaluate(() => {
    const limit = document.documentElement.clientWidth;
    return [...document.querySelectorAll('#events-view *')]
      .filter((n) => n.getBoundingClientRect().right > limit + 1 && !n.closest('.chip-row'))
      .slice(0, 3)
      .map((n) => `${n.tagName.toLowerCase()}.${[...n.classList].join('.')} "${(n.textContent || '').trim().slice(0, 50)}"`);
  });
  // Date blocks: month, day and weekday sit inside the card's padding, none clipped.
  const clipped = await page.evaluate(() =>
    [...document.querySelectorAll('#e-list .event-card')].flatMap((card) => {
      const c = card.getBoundingClientRect();
      const pad = parseFloat(getComputedStyle(card).paddingLeft) + parseFloat(getComputedStyle(card).borderLeftWidth);
      return [...card.querySelectorAll('.date-block > *')]
        .filter((k) => { const q = k.getBoundingClientRect(); return q.left < c.left + pad - 0.5 || q.right > c.right || k.scrollWidth > k.clientWidth + 1 || pad < 8; })
        .map((k) => `"${k.textContent}" in "${card.querySelector('.event-title')?.textContent?.slice(0, 40)}"`);
    })
  );
  check(!clipped.length, `${vp.name}: every date block clear of the card edge${clipped.length ? ` (clipped: ${clipped.slice(0, 3).join(', ')})` : ''}`);
  // Order: the dates the cards show never go backwards (a course shows and sorts by its next session).
  const shown = await page.$$eval('#e-list .event-card time.date-block', (ts) => ts.map((t) => t.dateTime));
  const back = shown.findIndex((d, i) => i && new Date(d) < new Date(shown[i - 1]));
  check(back < 0, `${vp.name}: ${shown.length} cards in the order of the dates they show${back < 0 ? '' : ` (${shown[back - 1]} before ${shown[back]})`}`);
  check(overflow <= 1, `${vp.name}: no sideways scroll (${overflow}px)${wide.length ? ` widest: ${wide.join(' | ')}` : ''}`);
  await page.locator('.events-report summary').click();
  check((await page.locator('.events-report-list li').count()) === (file.report ?? []).length, `${vp.name}: collection report lists every market`);
  if (shots) await page.screenshot({ path: join(shots, `events-${vp.name}.png`), fullPage: false });
  check(!errors.length, `${vp.name}: no page errors ${errors.join(' | ')}`);
  await ctx.close();
}
await browser.close();
server.close();
console.log(failed ? `\n${failed} checks failed` : '\nAll checks passed');
process.exit(failed ? 1 : 0);
