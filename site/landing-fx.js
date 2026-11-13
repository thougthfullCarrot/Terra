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
    em.classList.add('fx-out');
    setTimeout(() => {
      i = (i + 1) % words.length;
      em.textContent = words[i];
      em.classList.remove('fx-out');
    }, 320);
  }, 2600);
}

function start() {
  const gate = document.getElementById('gate');
  if (!gate || still()) return;
  document.documentElement.classList.add('fx');
  const em = gate.querySelector('h1 em');
  if (em) setTimeout(() => cycleWord(gate.querySelector('h1 em'), [em.textContent.trim(), 'jobs.', 'development.', 'news.', 'events.']), 1800);
  if (!fine()) return;
  spotlight(gate);
  document.querySelectorAll('#welcome .feature, #welcome .steps li').forEach(spotlight);
  document.querySelectorAll('#gate .primary, #welcome-start').forEach((b) => magnet(b));
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
else start();
