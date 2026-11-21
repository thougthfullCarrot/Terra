// Targeted second pass: header/nav/menus/hero timing for SpaceX and Palantir.
const { chromium } = require('playwright');
const fs = require('fs'); const path = require('path');
const root = process.argv[2];
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const UA_D = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';
const UA_P = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';

const headerInfo = (sel) => (s) => {
  const el = document.querySelector(s); if (!el) return null;
  const cs = getComputedStyle(el); const r = el.getBoundingClientRect();
  return { sel: s, position: cs.position, top: Math.round(r.top), height: Math.round(r.height), bg: cs.backgroundColor, backdrop: cs.backdropFilter, transform: cs.transform, opacity: cs.opacity, color: cs.color };
};
const visibleTexts = () => [...document.querySelectorAll('a,button')].filter(a => { const r = a.getBoundingClientRect(); const cs = getComputedStyle(a); return r.width > 0 && r.height > 0 && r.top >= 0 && r.bottom <= innerHeight && r.left >= 0 && r.right <= innerWidth && cs.visibility !== 'hidden' && parseFloat(cs.opacity) > 0.1; }).map(a => (a.innerText || a.getAttribute('aria-label') || '').trim().replace(/\s+/g, ' ')).filter(Boolean);

async function spacex(b) {
  const out = path.join(root, 'spacex'); const res = {};
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 }, userAgent: UA_D });
  const p = await ctx.newPage();
  await p.goto('https://www.spacex.com/', { waitUntil: 'domcontentloaded' }); await sleep(6000);
  res.desktopHeader = await p.evaluate(headerInfo(), '.header');
  res.heroText = await p.evaluate(() => [...document.querySelectorAll('body *')].filter(e => { const r = e.getBoundingClientRect(); return r.top < innerHeight && r.bottom > 0 && e.children.length === 0 && (e.innerText || '').trim(); }).map(e => { const cs = getComputedStyle(e); return { t: e.innerText.trim().slice(0, 80), tag: e.tagName, fs: cs.fontSize, fw: cs.fontWeight, ff: cs.fontFamily.split(',')[0], tt: cs.textTransform, ls: cs.letterSpacing }; }).slice(0, 40));
  res.sectionTitles = await p.evaluate(() => [...document.querySelectorAll('body *')].filter(e => e.children.length === 0 && parseFloat(getComputedStyle(e).fontSize) >= 28 && (e.innerText || '').trim()).map(e => { const cs = getComputedStyle(e); return `${e.innerText.trim().replace(/\s+/g, ' ')} [${e.tagName} ${cs.fontSize} ${cs.fontWeight} ${cs.textTransform}]`; }).slice(0, 30));
  res.videos = await p.evaluate(() => [...document.querySelectorAll('video')].map(v => ({ paused: v.paused, muted: v.muted, loop: v.loop, autoplay: v.autoplay, controls: v.controls, src: (v.currentSrc || '').slice(0, 100), w: Math.round(v.getBoundingClientRect().width) })));
  res.docHeight = await p.evaluate(() => document.documentElement.scrollHeight);
  // top-level nav items
  const top = await p.evaluate(() => { const h = document.querySelector('.header'); return [...h.querySelectorAll('a,button,li,span,div')].filter(e => { const r = e.getBoundingClientRect(); const cs = getComputedStyle(e); return r.top < 70 && r.height > 5 && r.height < 50 && e.children.length === 0 && (e.innerText || '').trim() && cs.visibility !== 'hidden' && parseFloat(cs.opacity) > 0.2; }).map(e => { const r = e.getBoundingClientRect(); return { t: e.innerText.trim(), x: r.x + r.width / 2, y: r.y + r.height / 2 }; }); });
  res.topNav = top.map(t => t.t);
  res.hovers = [];
  for (const t of top) {
    await p.mouse.move(700, 600); await sleep(600);
    const before = await p.evaluate(visibleTexts);
    await p.mouse.move(t.x, t.y); await sleep(1200);
    const after = await p.evaluate(visibleTexts);
    const added = after.filter(x => !before.includes(x));
    const r = { item: t.t, added };
    if (added.length > 1) { r.shot = `desktop-hover-${t.t.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.png`; await p.screenshot({ path: path.join(out, r.shot) }); }
    res.hovers.push(r);
  }
  // header behaviour on scroll
  await p.mouse.move(700, 600);
  for (const y of [400, 1200]) { await p.mouse.wheel(0, y === 400 ? 400 : 800); await sleep(1200); res['headerAt' + y] = await p.evaluate(headerInfo(), '.header'); }
  await p.mouse.wheel(0, -300); await sleep(1200); res.headerAfterScrollUp = await p.evaluate(headerInfo(), '.header');
  // carousel autoplay check: compare carousel dots after 6s
  await p.evaluate(() => window.scrollTo(0, 900)); await sleep(1500);
  const shotA = await p.screenshot({ clip: { x: 0, y: 0, width: 1440, height: 900 } }); await sleep(6000);
  const shotB = await p.screenshot({ clip: { x: 0, y: 0, width: 1440, height: 900 } });
  res.carouselSectionChangedWithoutInput = Buffer.compare(shotA, shotB) !== 0;
  await ctx.close();

  // phone
  const pc = await b.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, userAgent: UA_P });
  const pp = await pc.newPage();
  await pp.goto('https://www.spacex.com/', { waitUntil: 'domcontentloaded' }); await sleep(9000);
  res.phoneDocHeight = await pp.evaluate(() => document.documentElement.scrollHeight);
  res.phoneHeader = await pp.evaluate(headerInfo(), '.header');
  await pp.screenshot({ path: path.join(out, 'phone-01.png') });
  res.phoneVisibleText = await pp.evaluate(() => document.body.innerText.trim().slice(0, 300));
  // re-take phone scroll shots now that it has had time
  const shots = [];
  for (let i = 1; i < 10; i++) {
    for (let k = 0; k < 6; k++) { await pp.mouse.wheel(0, 150); await sleep(80); }
    await pp.evaluate((y) => window.scrollTo(0, y), i * 900); await sleep(1200);
    const y = await pp.evaluate(() => scrollY); const max = await pp.evaluate(() => document.documentElement.scrollHeight - innerHeight);
    if (shots.length && y === shots[shots.length - 1]) break;
    const f = `phone-${String(i + 1).padStart(2, '0')}.png`; await pp.screenshot({ path: path.join(out, f) }); shots.push(y);
    if (y >= max - 5) break;
  }
  res.phoneShotsY = shots;
  await pp.evaluate(() => window.scrollTo(0, 0)); await sleep(1000);
  const burger = await pp.evaluate(() => { const c = [...document.querySelectorAll('.header *')].filter(e => { const r = e.getBoundingClientRect(); return r.right > innerWidth - 80 && r.top < 70 && r.width > 15 && r.width < 70 && r.height > 10; }); const e = c[0]; if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2, cls: String(e.className), tag: e.tagName }; });
  res.phoneBurger = burger;
  if (burger) { await pp.mouse.click(burger.x, burger.y); await sleep(1500); await pp.screenshot({ path: path.join(out, 'phone-menu.png') }); res.phoneMenuItems = await pp.evaluate(visibleTexts); }
  await pc.close();
  return res;
}

async function palantir(b) {
  const out = path.join(root, 'palantir'); const res = {};
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 }, userAgent: UA_D });
  const p = await ctx.newPage();
  await p.goto('https://www.palantir.com/', { waitUntil: 'domcontentloaded' });
  // hero over time (video loop) — t=3s, 8s, 14s
  for (const [t, n] of [[3000, 'a'], [5000, 'b'], [6000, 'c']]) { await sleep(t); await p.screenshot({ path: path.join(out, `desktop-hero-${n}.png`) }); }
  res.heroText = await p.evaluate(() => [...document.querySelectorAll('body *')].filter(e => { const r = e.getBoundingClientRect(); const cs = getComputedStyle(e); return r.top < innerHeight && r.bottom > 0 && r.width > 0 && e.children.length === 0 && (e.innerText || '').trim() && cs.visibility !== 'hidden' && parseFloat(cs.opacity) > 0.1; }).map(e => { const cs = getComputedStyle(e); return { t: e.innerText.trim().slice(0, 100), tag: e.tagName, fs: cs.fontSize, ff: cs.fontFamily.split(',')[0], tt: cs.textTransform, color: cs.color }; }).slice(0, 30));
  res.bigText = await p.evaluate(() => [...document.querySelectorAll('body *')].filter(e => e.children.length === 0 && parseFloat(getComputedStyle(e).fontSize) >= 30 && (e.innerText || '').trim()).map(e => { const cs = getComputedStyle(e); return `${e.innerText.trim().replace(/\s+/g, ' ').slice(0, 120)} [${e.tagName} ${cs.fontSize}/${cs.lineHeight} ls ${cs.letterSpacing} ${cs.fontFamily.split(',')[0]} ${cs.textTransform} ${cs.color}]`; }).slice(0, 40));
  res.headerBar = await p.evaluate(() => { const cands = [...document.querySelectorAll('body *')].filter(e => { const r = e.getBoundingClientRect(); return r.top >= 0 && r.top < 80 && r.width > 1000 && r.height > 30 && r.height < 120; }); return cands.slice(0, 6).map(e => { const cs = getComputedStyle(e); const r = e.getBoundingClientRect(); return { tag: e.tagName, cls: String(e.className).slice(0, 80), top: Math.round(r.top), h: Math.round(r.height), pos: cs.position, bg: cs.backgroundColor, backdrop: cs.backdropFilter }; }); });
  res.topVisible = await p.evaluate(visibleTexts);
  // find hamburger (top-right)
  const btns = await p.evaluate(() => [...document.querySelectorAll('button,a')].filter(e => { const r = e.getBoundingClientRect(); return r.top < 120 && r.left > innerWidth - 400 && r.width > 0; }).map(e => { const r = e.getBoundingClientRect(); return { t: (e.innerText || e.getAttribute('aria-label') || '').trim(), x: r.x + r.width / 2, y: r.y + r.height / 2, exp: e.getAttribute('aria-expanded') }; }));
  res.topRightButtons = btns.map(b => b.t);
  for (const bt of btns) {
    if (/get started/i.test(bt.t)) {
      await p.mouse.move(bt.x, bt.y); await sleep(800); await p.screenshot({ path: path.join(out, 'desktop-hover-get-started.png'), clip: { x: 900, y: 0, width: 540, height: 160 } });
      continue;
    }
    const before = await p.evaluate(visibleTexts);
    await p.mouse.click(bt.x, bt.y); await sleep(1500);
    const after = await p.evaluate(visibleTexts);
    const slug = (bt.t || 'button').toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 20);
    await p.screenshot({ path: path.join(out, `desktop-click-${slug}.png`) });
    res['open_' + slug] = after.filter(x => !before.includes(x)).slice(0, 60);
    await p.keyboard.press('Escape'); await sleep(500);
    const still = await p.evaluate(visibleTexts); if (still.length > before.length + 3) { await p.mouse.click(bt.x, bt.y).catch(() => {}); await sleep(800); }
  }
  // header behaviour on scroll
  for (const y of [300, 1500]) { await p.evaluate((yy) => window.scrollTo(0, yy), y); await sleep(1200); res['headerAt' + y] = await p.evaluate(() => { const c = [...document.querySelectorAll('body *')].filter(e => { const r = e.getBoundingClientRect(); return r.top >= -5 && r.top < 60 && r.width > 1000 && r.height > 30 && r.height < 120; }); return c.slice(0, 3).map(e => { const cs = getComputedStyle(e); const r = e.getBoundingClientRect(); return { cls: String(e.className).slice(0, 60), top: Math.round(r.top), h: Math.round(r.height), pos: cs.position, bg: cs.backgroundColor }; }); }); }
  await p.evaluate(() => window.scrollTo(0, 1500)); await sleep(800);
  await p.screenshot({ path: path.join(out, 'desktop-scrolled-header.png'), clip: { x: 0, y: 0, width: 1440, height: 200 } });
  // the "traditional systems migration" scroll-driven module: capture a sequence while scrolling slowly through 900..2400
  await p.evaluate(() => window.scrollTo(0, 700)); await sleep(1000);
  for (let i = 0; i < 4; i++) { for (let k = 0; k < 3; k++) { await p.mouse.wheel(0, 120); await sleep(120); } await sleep(700); await p.screenshot({ path: path.join(out, `desktop-scrollseq-${i + 1}.png`) }); }
  res.pinned = await p.evaluate(() => [...document.querySelectorAll('body *')].filter(e => getComputedStyle(e).position === 'sticky').map(e => ({ cls: String(e.className).slice(0, 70), h: Math.round(e.getBoundingClientRect().height) })).slice(0, 15));
  // hover a platform row (AIP etc.)
  const row = await p.evaluate(() => { const e = [...document.querySelectorAll('a')].find(a => /^AIP/.test((a.innerText || '').trim()) && a.getBoundingClientRect().height > 50); if (!e) return null; e.scrollIntoView({ block: 'center' }); return true; });
  if (row) { await sleep(1200); const r = await p.evaluate(() => { const e = [...document.querySelectorAll('a')].find(a => /^AIP/.test((a.innerText || '').trim()) && a.getBoundingClientRect().height > 50); const b = e.getBoundingClientRect(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; }); await p.mouse.move(5, 5); await sleep(400); await p.screenshot({ path: path.join(out, 'desktop-platform-rest.png') }); await p.mouse.move(r.x, r.y); await sleep(1500); await p.screenshot({ path: path.join(out, 'desktop-platform-hover.png') }); res.platformHoverVideos = await p.evaluate(() => [...document.querySelectorAll('video')].map(v => ({ paused: v.paused, w: Math.round(v.getBoundingClientRect().width), src: (v.currentSrc || '').split('/').pop().slice(0, 40) }))); }
  await ctx.close();
  // phone menu
  const pc = await b.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, userAgent: UA_P });
  const pp = await pc.newPage();
  await pp.goto('https://www.palantir.com/', { waitUntil: 'domcontentloaded' }); await sleep(9000);
  await pp.screenshot({ path: path.join(out, 'phone-01.png') });
  const pb = await pp.evaluate(() => [...document.querySelectorAll('button,a')].filter(e => { const r = e.getBoundingClientRect(); return r.top > innerHeight - 120 && r.width > 0; }).map(e => { const r = e.getBoundingClientRect(); return { t: (e.innerText || e.getAttribute('aria-label') || '').trim(), x: r.x + r.width / 2, y: r.y + r.height / 2 }; }));
  res.phoneBottomButtons = pb.map(x => x.t);
  const menu = pb.find(x => /menu|navigation/i.test(x.t)) || pb[0];
  if (menu) { await pp.mouse.click(menu.x, menu.y); await sleep(1500); await pp.screenshot({ path: path.join(out, 'phone-menu.png') }); res.phoneMenuItems = await pp.evaluate(visibleTexts); }
  await pc.close();
  return res;
}

(async () => {
  const b = await chromium.launch(); const which = process.argv[3];
  const r = which === 'spacex' ? await spacex(b) : await palantir(b);
  fs.writeFileSync(path.join(root, which, 'measurements-pass2.json'), JSON.stringify(r, null, 2));
  await b.close(); console.log('done', which);
})().catch(e => { console.error(e); process.exit(1); });
