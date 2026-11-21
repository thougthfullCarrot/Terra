// Usage: node capture.js <siteKey> <url> <outDir>
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const [, , key, url, outRoot] = process.argv;
const out = path.join(outRoot, key);
fs.mkdirSync(out, { recursive: true });
const UA_DESKTOP = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';
const UA_PHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
const log = [];
const note = (m) => { log.push(m); console.log(`[${key}] ${m}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function load(page) {
  let status = null;
  try {
    const resp = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
    status = resp && resp.status();
  } catch (e) { note('goto error: ' + e.message.split('\n')[0]); }
  try { await page.waitForLoadState('networkidle', { timeout: 15000 }); } catch { note('networkidle timeout (continuing)'); }
  await sleep(2500);
  note(`status=${status} title="${await page.title().catch(() => '')}" finalUrl=${page.url()}`);
  return status;
}

async function consent(page, label) {
  // Detect + record consent banners, then dismiss so the site can be observed.
  const found = await page.evaluate(() => {
    const sel = ['#onetrust-banner-sdk', '#onetrust-consent-sdk', '[id*="cookie" i]', '[class*="cookie" i]', '[id*="consent" i]', '[class*="consent" i]', '#truste-consent-track', '#CybotCookiebotDialog'];
    const hits = [];
    for (const s of sel) for (const el of document.querySelectorAll(s)) {
      const r = el.getBoundingClientRect(); const cs = getComputedStyle(el);
      if (r.width > 100 && r.height > 40 && cs.display !== 'none' && cs.visibility !== 'hidden' && cs.opacity !== '0') hits.push({ s, text: (el.innerText || '').trim().slice(0, 200) });
    }
    return hits.slice(0, 3);
  });
  if (found.length) {
    note(`${label}: consent banner visible: ${JSON.stringify(found[0]).slice(0, 300)}`);
    await page.screenshot({ path: path.join(out, `${label}-00-consent.png`) });
    const names = [/accept all/i, /accept/i, /agree/i, /allow all/i, /got it/i, /^ok$/i, /continue/i];
    for (const n of names) {
      const b = page.getByRole('button', { name: n }).first();
      if (await b.isVisible().catch(() => false)) { await b.click({ timeout: 3000 }).catch(() => {}); note(`${label}: clicked consent button ${n}`); await sleep(1200); break; }
    }
  } else note(`${label}: no consent banner detected`);
  return found;
}

async function extract(page) {
  return page.evaluate(() => {
    const pick = (el) => {
      if (!el) return null; const cs = getComputedStyle(el);
      return { tag: el.tagName.toLowerCase(), text: (el.innerText || '').trim().replace(/\s+/g, ' ').slice(0, 140), fontFamily: cs.fontFamily, fontSize: cs.fontSize, fontWeight: cs.fontWeight, lineHeight: cs.lineHeight, letterSpacing: cs.letterSpacing, textTransform: cs.textTransform, color: cs.color };
    };
    const vis = (el) => { const r = el.getBoundingClientRect(); const cs = getComputedStyle(el); return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none'; };
    const h1s = [...document.querySelectorAll('h1')].filter(vis).slice(0, 3).map(pick);
    const h2s = [...document.querySelectorAll('h2')].filter(vis).slice(0, 6).map(pick);
    const h3s = [...document.querySelectorAll('h3')].filter(vis).slice(0, 4).map(pick);
    const ps = [...document.querySelectorAll('p')].filter(vis).filter(p => p.innerText.trim().length > 40).slice(0, 3).map(pick);
    const header = document.querySelector('header') || document.querySelector('[role="banner"]') || document.querySelector('nav');
    let hdr = null;
    if (header) {
      // walk up to find positioned ancestor
      let el = header, pos = getComputedStyle(el).position;
      let anc = header;
      while (anc && anc !== document.body) { const p = getComputedStyle(anc).position; if (p === 'fixed' || p === 'sticky') { pos = p; el = anc; break; } anc = anc.parentElement; }
      const cs = getComputedStyle(el); const r = el.getBoundingClientRect();
      hdr = { tag: header.tagName.toLowerCase(), cls: (header.className && header.className.baseVal === undefined ? header.className : '').toString().slice(0, 120), position: pos, height: Math.round(r.height), top: Math.round(r.top), bg: cs.backgroundColor, backdrop: cs.backdropFilter || cs.webkitBackdropFilter, color: cs.color, zIndex: cs.zIndex };
    }
    const navRoot = (header && header.querySelector('nav')) || document.querySelector('nav') || header;
    const navLinks = navRoot ? [...navRoot.querySelectorAll('a, button')].filter(vis).map(a => ({ text: (a.innerText || a.getAttribute('aria-label') || '').trim().replace(/\s+/g, ' '), href: a.getAttribute('href'), ...(() => { const cs = getComputedStyle(a); return { fontFamily: cs.fontFamily, fontSize: cs.fontSize, fontWeight: cs.fontWeight, textTransform: cs.textTransform, letterSpacing: cs.letterSpacing, color: cs.color }; })() })).filter(x => x.text).slice(0, 40) : [];
    const body = getComputedStyle(document.body); const html = getComputedStyle(document.documentElement);
    // colour census
    const bg = {}, fg = {}, fonts = {};
    for (const el of document.querySelectorAll('body *')) {
      if (!vis(el)) continue; const cs = getComputedStyle(el); const r = el.getBoundingClientRect();
      const area = r.width * r.height;
      if (cs.backgroundColor !== 'rgba(0, 0, 0, 0)' && cs.backgroundColor !== 'transparent') bg[cs.backgroundColor] = (bg[cs.backgroundColor] || 0) + area;
      if (el.childNodes && [...el.childNodes].some(n => n.nodeType === 3 && n.textContent.trim())) {
        const len = el.innerText ? el.innerText.length : 1;
        fg[cs.color] = (fg[cs.color] || 0) + len;
        const f = cs.fontFamily.split(',')[0].trim().replace(/['"]/g, ''); fonts[f] = (fonts[f] || 0) + len;
      }
      if (cs.backgroundImage && cs.backgroundImage.includes('gradient')) bg['GRADIENT ' + cs.backgroundImage.slice(0, 160)] = (bg['GRADIENT ' + cs.backgroundImage.slice(0, 160)] || 0) + area;
    }
    const top = (o, n) => Object.entries(o).sort((a, b) => b[1] - a[1]).slice(0, n).map(([k, v]) => [k, Math.round(v)]);
    // CSS custom properties on :root
    const vars = {};
    for (const sh of document.styleSheets) { let rules; try { rules = sh.cssRules; } catch { continue; } for (const r of rules) { if (r.selectorText === ':root' && r.style) for (const p of r.style) if (p.startsWith('--') && /col|bg|accent|brand|primary|text|font|black|white|gray|grey/i.test(p)) vars[p] = r.style.getPropertyValue(p).trim(); } }
    const loadedFonts = [...document.fonts].filter(f => f.status === 'loaded').map(f => `${f.family} ${f.weight} ${f.style}`);
    // motion/tech hints
    const w = window;
    const libs = { gsap: !!w.gsap, ScrollTrigger: !!w.ScrollTrigger, lenis: !!w.lenis || !!document.querySelector('.lenis, html.lenis'), locomotive: !!document.querySelector('[data-scroll-container]'), swiper: !!document.querySelector('.swiper, .swiper-container'), slick: !!document.querySelector('.slick-slider'), splide: !!document.querySelector('.splide'), aos: !!document.querySelector('[data-aos]'), framer: !!document.querySelector('[data-framer-name], [data-framer-component-type]'), next: !!w.__NEXT_DATA__ || !!document.querySelector('#__next'), wordpress: !!document.querySelector('link[href*="wp-content"], script[src*="wp-content"]'), aem: !!document.querySelector('[class*="cmp-"]'), webflow: !!document.querySelector('html[data-wf-site]') };
    const videos = [...document.querySelectorAll('video')].map(v => ({ autoplay: v.autoplay, muted: v.muted, loop: v.loop, paused: v.paused, src: (v.currentSrc || v.src || '').slice(0, 120), w: Math.round(v.getBoundingClientRect().width), h: Math.round(v.getBoundingClientRect().height) }));
    const sticky = [...document.querySelectorAll('body *')].filter(el => ['sticky', 'fixed'].includes(getComputedStyle(el).position) && vis(el)).slice(0, 12).map(el => ({ tag: el.tagName.toLowerCase(), pos: getComputedStyle(el).position, cls: String(el.className && el.className.baseVal === undefined ? el.className : '').slice(0, 80), h: Math.round(el.getBoundingClientRect().height) }));
    const carousels = document.querySelectorAll('[class*="carousel" i], [class*="slider" i], [class*="swiper" i], [aria-roledescription="carousel"]').length;
    const canvases = [...document.querySelectorAll('canvas')].filter(vis).length;
    const iframes = [...document.querySelectorAll('iframe')].map(f => (f.src || '').slice(0, 100));
    return { docHeight: document.documentElement.scrollHeight, title: document.title, h1s, h2s, h3s, ps, header: hdr, navLinks, body: { bg: body.backgroundColor, htmlBg: html.backgroundColor, color: body.color, fontFamily: body.fontFamily, fontSize: body.fontSize }, bgCensus: top(bg, 10), fgCensus: top(fg, 10), fontCensus: top(fonts, 8), cssVars: Object.fromEntries(Object.entries(vars).slice(0, 60)), loadedFonts: [...new Set(loadedFonts)].slice(0, 30), libs, videos, sticky, carousels, canvases, iframes };
  });
}

async function snapshotStates(page) {
  // opacity/transform of content elements, used to detect scroll-triggered reveals
  return page.evaluate(() => {
    const els = [...document.querySelectorAll('h1,h2,h3,p,img,section > *, [class*="card" i]')].slice(0, 400);
    return els.map((el, i) => { el.dataset.__probe = i; const cs = getComputedStyle(el); return { i, op: cs.opacity, tf: cs.transform, vis: cs.visibility, top: Math.round(el.getBoundingClientRect().top + window.scrollY) }; });
  });
}

async function scrollCapture(page, label, vh) {
  const shots = [];
  const before = await snapshotStates(page);
  const hdrTop = await page.evaluate(() => { const h = document.querySelector('header'); if (!h) return null; const cs = getComputedStyle(h); return { bg: cs.backgroundColor, h: Math.round(h.getBoundingClientRect().height), top: Math.round(h.getBoundingClientRect().top) }; });
  let hdrScrolled = null; const parallax = [];
  for (let i = 0; i < 10; i++) {
    const y = i * 900;
    // slow scroll in steps to trigger observers
    const cur = await page.evaluate(() => window.scrollY);
    for (let s = cur; s < y; s += 150) { await page.mouse.wheel(0, 150); await sleep(90); }
    await page.evaluate((yy) => window.scrollTo(0, yy), y);
    await sleep(1100);
    const actualY = await page.evaluate(() => window.scrollY);
    const max = await page.evaluate(() => document.documentElement.scrollHeight - window.innerHeight);
    const f = `${label}-${String(i + 1).padStart(2, '0')}.png`;
    await page.screenshot({ path: path.join(out, f) });
    shots.push({ f, y: actualY });
    if (i === 1) hdrScrolled = await page.evaluate(() => { const h = document.querySelector('header'); if (!h) return null; const cs = getComputedStyle(h); return { bg: cs.backgroundColor, h: Math.round(h.getBoundingClientRect().height), top: Math.round(h.getBoundingClientRect().top), transform: cs.transform }; });
    if (actualY >= max - 5) break;
  }
  const after = await page.evaluate(() => [...document.querySelectorAll('[data-__probe]')].map(el => { const cs = getComputedStyle(el); return { i: +el.dataset.__probe, op: cs.opacity, tf: cs.transform, vis: cs.visibility }; }));
  const amap = Object.fromEntries(after.map(a => [a.i, a]));
  let opacityReveals = 0, transformChanges = 0;
  for (const b of before) { const a = amap[b.i]; if (!a) continue; if (b.top > vh && parseFloat(b.op) < 0.5 && parseFloat(a.op) > 0.9) opacityReveals++; if (b.tf !== a.tf) transformChanges++; }
  return { shots, hdrTop, hdrScrolled, opacityReveals, transformChanges };
}

async function navHovers(page) {
  await page.evaluate(() => window.scrollTo(0, 0)); await sleep(1000);
  const items = await page.evaluate(() => {
    const header = document.querySelector('header') || document.querySelector('nav');
    if (!header) return [];
    const els = [...header.querySelectorAll('a, button')].filter(el => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && r.top < 140 && (el.innerText || '').trim().length > 1 && (el.innerText || '').trim().length < 30; });
    return els.slice(0, 9).map(el => { const r = el.getBoundingClientRect(); return { text: el.innerText.trim().replace(/\s+/g, ' '), x: r.x + r.width / 2, y: r.y + r.height / 2, expanded: el.getAttribute('aria-expanded') }; });
  });
  const results = [];
  const visibleCount = () => page.evaluate(() => [...document.querySelectorAll('a')].filter(a => { const r = a.getBoundingClientRect(); const cs = getComputedStyle(a); return r.width > 0 && r.height > 0 && r.top >= 0 && r.top < window.innerHeight && cs.visibility !== 'hidden' && parseFloat(cs.opacity) > 0.1; }).length);
  for (const it of items) {
    await page.mouse.move(5, 600); await sleep(500);
    const base = await visibleCount();
    await page.mouse.move(it.x, it.y); await sleep(1000);
    const n = await visibleCount();
    const r = { text: it.text, linksBefore: base, linksAfter: n, ariaExpanded: await page.evaluate(({ x, y }) => { const el = document.elementFromPoint(x, y); const b = el && el.closest('a,button'); return b ? b.getAttribute('aria-expanded') : null; }, it) };
    if (n > base + 2) { const f = `desktop-hover-${it.text.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 24)}.png`; await page.screenshot({ path: path.join(out, f) }); r.screenshot = f; }
    results.push(r);
  }
  // also try click-to-open if nothing opened on hover
  if (!results.some(r => r.screenshot)) {
    for (const it of items.slice(0, 6)) {
      const before = await visibleCount();
      await page.mouse.click(it.x, it.y).catch(() => {}); await sleep(1200);
      if (page.url().split('#')[0] !== url.split('#')[0] && !page.url().startsWith(url)) { await page.goBack().catch(() => {}); await sleep(2000); continue; }
      const n = await visibleCount();
      if (n > before + 2) { const f = `desktop-click-${it.text.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 24)}.png`; await page.screenshot({ path: path.join(out, f) }); results.push({ text: it.text, clickOpened: true, screenshot: f }); await page.keyboard.press('Escape'); await page.mouse.click(it.x, it.y).catch(() => {}); await sleep(600); }
    }
  }
  return results;
}

async function cardHover(page) {
  // hover a few link-cards / buttons mid-page and record style deltas
  return page.evaluate(async () => {
    const sleep = (ms) => new Promise(r => setTimeout(r, ms));
    return [...document.querySelectorAll('a[class*="card" i], [class*="card" i] a, main a')].slice(0, 0).length; // placeholder (real hover done via mouse below)
  });
}

(async () => {
  const browser = await chromium.launch();
  const result = { key, url, when: new Date().toISOString(), notes: log };
  try {
    // DESKTOP
    const dctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, userAgent: UA_DESKTOP, locale: 'en-US' });
    const dp = await dctx.newPage();
    result.desktopStatus = await load(dp);
    result.desktopConsent = await consent(dp, 'desktop');
    result.desktop = await extract(dp);
    result.desktopNav = await navHovers(dp);
    await dp.evaluate(() => window.scrollTo(0, 0)); await sleep(800);
    result.desktopScroll = await scrollCapture(dp, 'desktop', 900);
    // card hover deltas
    result.cardHover = [];
    await dp.evaluate(() => window.scrollTo(0, 900)); await sleep(1000);
    const cands = await dp.evaluate(() => [...document.querySelectorAll('main a, section a, a')].filter(a => { const r = a.getBoundingClientRect(); return r.top > 100 && r.bottom < window.innerHeight && r.width > 150 && r.height > 60; }).slice(0, 3).map(a => { const r = a.getBoundingClientRect(); a.dataset.__h = '1'; return { x: r.x + r.width / 2, y: r.y + r.height / 2, text: a.innerText.trim().slice(0, 60) }; }));
    for (const c of cands) {
      const get = () => dp.evaluate(({ x, y }) => { const el = document.elementFromPoint(x, y); const a = el && el.closest('a'); if (!a) return null; const out = []; for (const n of [a, ...a.querySelectorAll('*')].slice(0, 25)) { const cs = getComputedStyle(n); out.push([cs.transform, cs.backgroundColor, cs.color, cs.opacity, cs.boxShadow, cs.textDecorationLine, cs.filter].join('|')); } return out; }, c);
      await dp.mouse.move(5, 5); await sleep(500); const a = await get();
      await dp.mouse.move(c.x, c.y); await sleep(900); const b = await get();
      let changed = 0; if (a && b) for (let i = 0; i < Math.min(a.length, b.length); i++) if (a[i] !== b[i]) changed++;
      result.cardHover.push({ text: c.text, changedElements: changed });
    }
    await dctx.close();

    // PHONE
    const pctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true, userAgent: UA_PHONE, locale: 'en-US' });
    const pp = await pctx.newPage();
    result.phoneStatus = await load(pp);
    result.phoneConsent = await consent(pp, 'phone');
    result.phone = await extract(pp);
    // menu
    const menuBtn = await pp.evaluate(() => {
      const c = [...document.querySelectorAll('button, a, [role="button"], div[class*="menu" i], div[class*="burger" i]')].filter(el => { const r = el.getBoundingClientRect(); const cs = getComputedStyle(el); return r.width > 10 && r.height > 10 && r.top < 120 && cs.visibility !== 'hidden' && cs.display !== 'none'; });
      const score = (el) => { const s = ((el.getAttribute('aria-label') || '') + ' ' + el.className + ' ' + (el.innerText || '') + ' ' + (el.id || '')).toLowerCase(); return /menu|burger|hamburger|nav-toggle|toggle|open navigation/.test(s) ? 2 : (el.getAttribute('aria-expanded') !== null ? 1 : 0); };
      const best = c.map(el => [score(el), el]).filter(x => x[0] > 0).sort((a, b) => b[0] - a[0])[0];
      if (!best) return null; const r = best[1].getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2, label: (best[1].getAttribute('aria-label') || best[1].innerText || best[1].className || '').toString().trim().slice(0, 60) };
    });
    result.phoneMenuButton = menuBtn;
    if (menuBtn) {
      await pp.mouse.click(menuBtn.x, menuBtn.y); await sleep(1500);
      await pp.screenshot({ path: path.join(out, 'phone-menu.png') });
      result.phoneMenuItems = await pp.evaluate(() => [...document.querySelectorAll('a, button')].filter(a => { const r = a.getBoundingClientRect(); const cs = getComputedStyle(a); return r.width > 0 && r.height > 0 && r.top >= 0 && r.top < window.innerHeight && cs.visibility !== 'hidden' && parseFloat(cs.opacity) > 0.1; }).map(a => (a.innerText || a.getAttribute('aria-label') || '').trim().replace(/\s+/g, ' ')).filter(Boolean).slice(0, 40));
      await pp.mouse.click(menuBtn.x, menuBtn.y).catch(() => {}); await sleep(800);
      await pp.keyboard.press('Escape').catch(() => {});
    } else note('phone: no menu button found');
    await pp.reload().catch(() => {}); await sleep(3000);
    await consent(pp, 'phone-reload');
    result.phoneScroll = await scrollCapture(pp, 'phone', 844);
    await pctx.close();
  } catch (e) { note('FATAL ' + e.stack); }
  fs.writeFileSync(path.join(out, 'measurements.json'), JSON.stringify(result, null, 2));
  await browser.close();
})();
