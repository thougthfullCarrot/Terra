// landing-fx.js: extra interactivity for the signed-out landing, on top of
// live.js (headline entrance, panel lean, scroll reveal). A cursor spotlight
// on the hero, a headline word that cycles through what Terra covers,
// magnetic primary buttons, and step and feature cards lit where the pointer is. Decoration only: with reduced motion, touch-only
// pointers or no script the page is unchanged and fully usable.
const still = () => Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches);
const fine = () => Boolean(window.matchMedia?.('(hover: hover) and (pointer: fine)').matches);

function spotlight(el) {
  el.classList.add('fx-spot');
  let raf = 0;
  el.addEventListener('pointermove', (e) => {
    if (raf) return;
    raf = requestAnimationFrame(() => {
      raf = 0;
      const r = el.getBoundingClientRect();
      el.style.setProperty('--fx-x', `${e.clientX - r.left}px`);
      el.style.setProperty('--fx-y', `${e.clientY - r.top}px`);
    });
  });
  el.addEventListener('pointerenter', () => el.classList.add('fx-on'));
  el.addEventListener('pointerleave', () => el.classList.remove('fx-on'));
}

function magnet(el, pull = 0.25) {
  el.classList.add('fx-magnet');
  el.addEventListener('pointermove', (e) => {
    const r = el.getBoundingClientRect();
    const x = e.clientX - (r.left + r.width / 2);
    const y = e.clientY - (r.top + r.height / 2);
    el.style.transform = `translate(${(x * pull).toFixed(1)}px, ${(y * pull).toFixed(1)}px)`;
  });
  el.addEventListener('pointerleave', () => (el.style.transform = ''));
}

// The <em> in the headline cycles; screen readers keep the original sentence.
function cycleWord(em, words) {
  const h1 = em.closest('h1');
  if (h1 && !h1.hasAttribute('aria-label')) h1.setAttribute('aria-label', h1.textContent.trim());
  em.setAttribute('aria-hidden', 'true');
  em.classList.add('fx-word');
  let i = 0;
  setInterval(() => {
    if (document.hidden || still()) return;
    i = (i + 1) % words.length;
    scramble(em, words[i], 520);
  }, 2600);
}


// Intro: a full-screen title card that plays once per browser session before
// the landing shows. The wordmark rises in letter by letter, a line draws
// under it, the tagline scrambles into place, then the card lifts away.
// Click, key or scroll skips it. Never plays for signed-in visitors.
function intro(gate) {
  try {
    if (sessionStorage.getItem('terra-intro-seen')) return;
    sessionStorage.setItem('terra-intro-seen', '1');
  } catch {}
  const card = document.createElement('div');
  card.className = 'fx-intro';
  card.setAttribute('aria-hidden', 'true');
  const word = document.createElement('div');
  word.className = 'fx-intro-word';
  [...'TERRA'].forEach((ch, k) => {
    const s = document.createElement('span');
    s.textContent = ch;
    s.style.setProperty('--k', k);
    word.append(s);
  });
  const line = document.createElement('div');
  line.className = 'fx-intro-line';
  const tag = document.createElement('p');
  tag.className = 'fx-intro-tag';
  card.append(word, line, tag);
  document.body.append(card);
  document.documentElement.classList.add('fx-intro-on');
  let done = false;
  const close = () => {
    if (done) return;
    done = true;
    card.classList.add('fx-intro-out');
    document.documentElement.classList.remove('fx-intro-on');
    setTimeout(() => card.remove(), 900);
    ['pointerdown', 'keydown', 'wheel', 'touchstart'].forEach((t) => removeEventListener(t, close));
  };
  ['pointerdown', 'keydown', 'wheel', 'touchstart'].forEach((t) => addEventListener(t, close, { passive: true }));
  setTimeout(() => scramble(tag, 'Texas real estate, live.'), 900);
  setTimeout(close, 2900);
  // If the page turns out to be signed in, drop the card at once.
  new MutationObserver(() => gate.hidden && close()).observe(gate, { attributes: true, attributeFilter: ['hidden'] });
}

// Letters flicker through random glyphs and settle left to right.
const GLYPHS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ#%&*+<>/';
function scramble(el, text, ms = 700) {
  const start = performance.now();
  const step = (now) => {
    const p = Math.min(1, (now - start) / ms);
    const fixed = Math.floor(p * text.length);
    let out = text.slice(0, fixed);
    for (let k = fixed; k < text.length; k++) out += text[k] === ' ' ? ' ' : GLYPHS[(Math.random() * GLYPHS.length) | 0];
    el.textContent = out;
    if (p < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

function start() {
  const gate = document.getElementById('gate');
  if (!gate || still()) return;
  document.documentElement.classList.add('fx');
  // Only signed-out visitors see the landing; wait until account.js decides.
  const go = () => !gate.hidden && intro(gate);
  if (!gate.hidden) go();
  else {
    const mo = new MutationObserver(() => !gate.hidden && (mo.disconnect(), go()));
    mo.observe(gate, { attributes: true, attributeFilter: ['hidden'] });
    setTimeout(() => mo.disconnect(), 4000);
  }
  const em = gate.querySelector('h1 em');
  if (em) setTimeout(() => cycleWord(gate.querySelector('h1 em'), [em.textContent.trim(), 'jobs.', 'development.', 'news.', 'events.']), 1800);
  if (!fine()) return;
  spotlight(gate);
  document.querySelectorAll('#welcome .feature, #welcome .steps li').forEach(spotlight);
  document.querySelectorAll('#gate .primary, #welcome-start').forEach((b) => magnet(b));
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
else start();
