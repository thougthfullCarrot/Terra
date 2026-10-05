/**
 * Clicks through the real website as a test account, in headless Chromium.
 *
 * site/ is served from a local port with a config.js naming the same Supabase
 * project, and the account's session is put in the page's storage before it
 * loads, exactly where supabase-js keeps it after a code sign-in. Nothing is
 * mocked past that point: the page reads access, the feed, the profile and the
 * tracker from Supabase like it does for a real visitor.
 *
 * Needs `npm run build:site` first (match.js and the vendor bundles) and a
 * Chromium that playwright-core can launch (CHROMIUM_PATH, or
 * `npx playwright-core install chromium`).
 */
import { createServer, type Server } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Session } from '@supabase/supabase-js';
import type { Browser, BrowserContext, ConsoleMessage, Page } from 'playwright-core';
import type { TestPerson } from './people.js';

const SITE_DIR = fileURLToPath(new URL('../../../site/', import.meta.url));
const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml'
};

export interface SiteConfig {
  supabaseUrl: string;
  supabaseAnonKey: string;
  paymentLink?: string;
  billingPortalLink?: string;
  priceLabel?: string;
}

export interface BrowserResult {
  ok: boolean;
  label: string;
  detail?: string;
}

export interface Expectations {
  /** Jobs that should carry a Best match badge, from the same scorer the page uses. */
  strong: number;
  /** True when the account has a resume, so every card shows a match %. */
  scored: boolean;
  /** Jobs in the feed. */
  jobs: number;
}

/** Serve site/ with config.js replaced, so the checked-in file is never touched. */
async function serveSite(config: SiteConfig): Promise<{ server: Server; origin: string }> {
  const configJs = `export const CONFIG = ${JSON.stringify({ paymentLink: '', billingPortalLink: '', priceLabel: '', ...config })};\n`;
  const server = createServer(async (request, response) => {
    const path = decodeURIComponent(new URL(request.url ?? '/', 'http://localhost').pathname);
    if (path === '/config.js') {
      response.writeHead(200, { 'content-type': TYPES['.js']! }).end(configJs);
      return;
    }
    const file = normalize(join(SITE_DIR, path.endsWith('/') ? `${path}index.html` : path));
    if (!file.startsWith(SITE_DIR)) {
      response.writeHead(403).end();
      return;
    }
    try {
      const body = await readFile(file);
      response.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' }).end(body);
    } catch {
      response.writeHead(404).end('not found');
    }
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  return { server, origin: `http://127.0.0.1:${port}` };
}

/** Console noise that says nothing about the site: web fonts and the school logo service can be unreachable from CI. */
function ignorable(message: ConsoleMessage): boolean {
  const text = message.text();
  const url = message.location().url;
  return (
    /fonts\.(googleapis|gstatic)\.com|favicon|logo|clearbit|icon/i.test(url + text) ||
    /Failed to load resource: the server responded with a status of 404/.test(text)
  );
}

export class SiteTester {
  private constructor(
    private browser: Browser,
    private server: Server,
    readonly origin: string,
    private storageKey: string,
    private setup?: (context: BrowserContext) => Promise<void>
  ) {}

  /** `setup` runs on each new browser context, e.g. to stand in for Supabase when trying the checks offline. */
  static async start(config: SiteConfig, setup?: (context: BrowserContext) => Promise<void>): Promise<SiteTester> {
    const { chromium } = await import('playwright-core');
    const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
    const { server, origin } = await serveSite(config);
    // supabase-js keeps the session under sb-<project ref>-auth-token.
    const ref = new URL(config.supabaseUrl).hostname.split('.')[0];
    return new SiteTester(browser, server, origin, `sb-${ref}-auth-token`, setup);
  }

  async stop(): Promise<void> {
    await this.browser.close();
    await new Promise((resolve) => this.server.close(resolve));
  }

  private async open(session: Session | null, mobile: boolean): Promise<{ context: BrowserContext; page: Page; errors: string[] }> {
    const context = await this.browser.newContext(
      mobile ? { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 } : { viewport: { width: 1280, height: 900 } }
    );
    await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: this.origin });
    await this.setup?.(context);
    if (session) {
      await context.addInitScript(
        ([key, value]) => {
          try {
            localStorage.setItem(key!, value!);
          } catch {}
        },
        [this.storageKey, JSON.stringify(session)]
      );
    }
    const page = await context.newPage();
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(`page error: ${error.message}`));
    page.on('console', (message) => {
      if (message.type() === 'error' && !ignorable(message)) errors.push(`console: ${message.text()}`);
    });
    return { context, page, errors };
  }

  /** The signed-out page: sign-in form and the welcome section, no feed. */
  async checkSignedOut(): Promise<BrowserResult[]> {
    const results: BrowserResult[] = [];
    const check = (ok: boolean, label: string, detail?: string) => results.push({ ok, label, detail });
    const { context, page, errors } = await this.open(null, false);
    try {
      await page.goto(this.origin + '/');
      await page.locator('#gate').waitFor({ state: 'visible', timeout: 20_000 });
      check(true, 'signed out: sign-in form shows');
      check(await page.locator('#welcome').isVisible(), 'signed out: welcome section shows');
      check(!(await page.locator('#feed').isVisible()), 'signed out: job list is hidden');
      check((await page.locator('#list .card').count()) === 0, 'signed out: no job cards in the page');
      await page.fill('#signin-email', 'not-an-email');
      await page.click('#signin-submit');
      const status = (await page.locator('#signin-status').textContent()) ?? '';
      check(/Enter your email/.test(status), 'signed out: a bad email is caught before sending', status);
      check(errors.length === 0, 'signed out: no script errors', errors.join(' | '));
    } catch (error) {
      check(false, 'signed out: page loads', String(error));
    } finally {
      await context.close();
    }
    return results;
  }

  async checkPerson(
    person: TestPerson,
    userId: string,
    session: Session,
    expect: Expectations,
    { mobile = false } = {}
  ): Promise<BrowserResult[]> {
    const results: BrowserResult[] = [];
    const tag = mobile ? 'phone: ' : '';
    const check = (ok: boolean, label: string, detail?: string) => results.push({ ok, label: `${tag}${label}`, detail });
    const member = person.expected !== 'none';
    const { context, page, errors } = await this.open(session, mobile);
    try {
      await page.goto(this.origin + '/');
      const landed = member ? '#feed' : '#paywall';
      try {
        await page.locator(landed).waitFor({ state: 'visible', timeout: 25_000 });
        check(true, member ? 'site opens on the job list' : 'site opens on the subscribe page');
      } catch {
        const visible = [];
        for (const id of ['gate', 'paywall', 'profile', 'feed']) if (await page.locator(`#${id}`).isVisible()) visible.push(id);
        check(false, member ? 'site opens on the job list' : 'site opens on the subscribe page', `showing: ${visible.join(', ') || 'nothing'}`);
        return results;
      }
      check(await page.locator('#account-button').isVisible(), 'Profile button shows');

      if (member) {
        await this.checkFeed(page, person, expect, check);
      } else {
        const lede = (await page.locator('#paywall-lede').textContent()) ?? '';
        check(lede.toLowerCase().includes(person.email.toLowerCase()), 'subscribe page names the signed-in email', lede);
        check((await page.locator('#list .card').count()) === 0, 'no job cards behind the paywall');
        const subscribe = page.locator('#subscribe');
        if (await subscribe.isVisible()) {
          const href = (await subscribe.getAttribute('href')) ?? '';
          check(href.includes(`client_reference_id=${userId}`), 'subscribe link carries the account id to Stripe', href);
        }
      }

      await this.checkProfile(page, person, check);
      if (member) await this.checkTracker(page, check);
      if (member && !mobile) await this.checkTabs(page, check);

      const overflow = await page.evaluate<number>('document.documentElement.scrollWidth - window.innerWidth');
      check(overflow <= 1, 'page fits the screen width (no sideways scroll)', `${overflow}px too wide`);
      // Markup typed into a profile or resume must stay text.
      const injected = await page.evaluate<number>(`document.querySelectorAll('img[src="x"], #profile b, #resume-skills script').length`);
      check(injected === 0, 'profile text is never run as HTML', `${injected} injected element(s)`);
      check(errors.length === 0, 'no script errors', errors.slice(0, 5).join(' | '));
    } catch (error) {
      check(false, 'clicks through without getting stuck', String(error).split('\n')[0]);
    } finally {
      await context.close();
    }
    return results;
  }

  private async checkFeed(
    page: Page,
    person: TestPerson,
    expect: Expectations,
    check: (ok: boolean, label: string, detail?: string) => void
  ): Promise<void> {
    if (!expect.jobs) return;
    await page.locator('#list .card').first().waitFor({ timeout: 20_000 });
    const cards = await page.locator('#list .card').count();
    check(cards === expect.jobs, 'every job in the feed is listed', `${cards} cards for ${expect.jobs} jobs`);
    const count = (await page.locator('#count').textContent()) ?? '';
    check(count.startsWith(`${expect.jobs} `), 'role count matches the list', count);

    // Scores are drawn once the profile and match.js arrive, which can be just after the cards.
    if (expect.scored) {
      await page.locator('#list .card .score').first().waitFor({ timeout: 10_000 }).catch(() => {});
    }
    const scores = await page.locator('#list .card .score').count();
    check(expect.scored ? scores === cards : scores === 0, expect.scored ? 'every card shows a match %' : 'no match % without a resume', `${scores} of ${cards}`);
    const best = await page.locator('#list .card.best').count();
    check(best === expect.strong, 'Best match badges agree with the scorer', `${best} on the page, ${expect.strong} expected`);
    if (expect.scored) {
      const sort = await page.locator('#sort').inputValue();
      check(sort === 'match', 'best matches sort first by default', `sort is ${sort}`);
    }

    // Filter by the person's city when the feed has it, then clear.
    const city = person.homeCity && page.locator(`#city-chips .chip[data-value="${person.homeCity}"]`);
    if (city && (await city.count())) {
      await city.click();
      const firms = await page.locator('#list .card .firm').allTextContents();
      check(firms.every((text) => text.endsWith(`· ${person.homeCity}`)) || firms.length === 0, `city filter shows only ${person.homeCity} jobs`);
      await page.click('#clear');
      check((await page.locator('#list .card').count()) === cards, 'clearing filters brings every job back');
    }

    // Search: a word from the first card's title should keep it.
    const firstRole = ((await page.locator('#list .card .role').first().textContent()) ?? '').trim();
    const word = firstRole.split(/\s+/).find((w) => w.length > 3) ?? firstRole;
    if (word) {
      await page.fill('#q', word);
      await page.waitForTimeout(300);
      const roles = await page.locator('#list .card .role').allTextContents();
      check(roles.some((role) => role.trim() === firstRole), `search for "${word}" finds the job`);
      await page.fill('#q', '');
      await page.waitForTimeout(300);
    }

    // The detail panel opens, steps forward and closes.
    await page.locator('#list .card .open').first().click();
    const panel = page.locator('#job-panel');
    await panel.waitFor({ state: 'visible', timeout: 5_000 });
    const panelRole = ((await page.locator('#jp-role').textContent()) ?? '').trim();
    check(panelRole === firstRole, 'job details open from the card', panelRole);
    check(page.url().includes('job='), 'the open job is in the link');
    if (cards > 1) {
      await page.click('#jp-next');
      check(((await page.locator('#jp-position').textContent()) ?? '').startsWith('2 of'), 'Next steps to the second job');
    }
    await page.click('#jp-close');
    check(!(await panel.isVisible()), 'job details close');
  }

  private async checkProfile(page: Page, person: TestPerson, check: (ok: boolean, label: string, detail?: string) => void): Promise<void> {
    await page.click('#account-button');
    await page.locator('#profile').waitFor({ state: 'visible', timeout: 5_000 });
    const form = page.locator('#profile-form');
    const value = (name: string) => form.locator(`[name="${name}"]`).inputValue();
    const sectors = await form.locator('input[name="sectors"]:checked').evaluateAll((boxes) => boxes.map((b) => (b as unknown as { value: string }).value));
    const filled =
      (await value('name')) === person.name &&
      (await value('school')) === (person.school ?? '') &&
      (await value('gradYear')) === (person.gradYear ? String(person.gradYear) : '') &&
      (await value('major')) === (person.major ?? '') &&
      (await value('homeCity')) === (person.homeCity ?? '') &&
      sectors.sort().join() === [...person.sectors].sort().join();
    check(filled, 'profile form shows the saved profile', filled ? undefined : `name=${await value('name')} year=${await value('gradYear')} city=${await value('homeCity')} sectors=${sectors}`);

    const accessText = ((await page.locator('#profile-access').textContent()) ?? '').trim();
    const wanted = { college: 'Student · free access', subscriber: 'Subscriber', none: 'No access yet' }[person.expected];
    check(accessText === wanted, 'profile shows the right plan', accessText);

    const resumeState = ((await page.locator('#resume-state').textContent()) ?? '').trim();
    check(person.resume ? /Resume on file/.test(resumeState) : /PDF, Word or text/.test(resumeState), 'resume status is right', resumeState);

    // Save through the form, unchanged, and expect a plain "Saved."
    await page.click('#profile-save');
    const status = page.locator('#profile-status');
    await status.waitFor({ state: 'visible', timeout: 10_000 });
    const saved = ((await status.textContent()) ?? '').trim();
    check(/^Saved/.test(saved) && !(await status.evaluate((n) => n.classList.contains('error'))), 'saving the profile works', saved);

    await page.click('#profile-close');
  }

  private async checkTracker(page: Page, check: (ok: boolean, label: string, detail?: string) => void): Promise<void> {
    await page.locator('#tab-tracker').waitFor({ state: 'visible', timeout: 10_000 }).catch(() => {});
    if (!(await page.locator('#tab-tracker').isVisible())) {
      check(false, 'Tracker tab shows for members');
      return;
    }
    const card = page.locator('#list .card').first();
    if (!(await card.count())) return;
    const role = ((await card.locator('.role').textContent()) ?? '').trim();
    await card.locator('.save').click();
    await page.waitForFunction(`document.querySelector('#list .card .save')?.getAttribute('aria-pressed') === 'true'`, null, { timeout: 10_000 });
    check(true, 'bookmarking a job saves it to the tracker');
    await page.click('#tab-tracker');
    await page.locator('#tracker-view').waitFor({ state: 'visible', timeout: 5_000 });
    const body = (await page.locator('#t-body').textContent()) ?? '';
    check(body.includes(role), 'the saved job shows on the Tracker tab');
    await page.click('#tab-jobs');
    await page.locator('#list .card').first().locator('.save').click();
    await page.waitForFunction(`document.querySelector('#list .card .save')?.getAttribute('aria-pressed') === 'false'`, null, { timeout: 10_000 });
    check(true, 'bookmarking it again removes it');
  }

  private async checkTabs(page: Page, check: (ok: boolean, label: string, detail?: string) => void): Promise<void> {
    await page.click('#tab-markets');
    await page.locator('#markets-view').waitFor({ state: 'visible', timeout: 5_000 });
    await page.waitForFunction(`!/Loading/.test(document.querySelector('#markets-view')?.textContent ?? '')`, null, { timeout: 15_000 }).catch(() => {});
    const market = ((await page.locator('#markets-view').textContent()) ?? '').replace(/\s+/g, ' ');
    check(!/Couldn't load|being built/.test(market) && market.length > 200, 'Market data tab loads', market.slice(0, 120));

    for (const [tab, view] of [['news', 'n-list'], ['events', 'e-list']] as const) {
      await page.click(`#tab-${tab}`);
      await page.locator(`#${tab}-view`).waitFor({ state: 'visible', timeout: 5_000 });
      await page.waitForFunction(`!/Loading/.test(document.getElementById('${view}')?.textContent ?? '')`, null, { timeout: 10_000 }).catch(() => {});
      const text = ((await page.locator(`#${view}`).textContent()) ?? '').replace(/\s+/g, ' ');
      check(!/Couldn't load/.test(text) && text.length > 40, `${tab === 'news' ? 'News' : 'Events'} tab loads`, text.slice(0, 120));
    }
    await page.click('#tab-jobs');
    const back = await page.locator('#jobs-view').waitFor({ state: 'visible', timeout: 5_000 }).then(() => true, () => false);
    check(back, 'back to Jobs from the tabs');
  }
}
