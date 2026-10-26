// Contour: the topographic field behind the landing and the welcome screen,
// the landing's feature tabs, and the welcome counts rising once they arrive.
// Decoration only: everything here is skipped or held still without script or
// with reduced motion, and nothing on the page depends on it.
const still = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

/* ---------------------------------------------------------------------------
   The field: soft contour rings around one peak that leans toward the cursor.
   It draws only while its section is on screen and the tab is visible.
   --------------------------------------------------------------------------- */

function field(host, at) {
  const canvas = document.createElement('canvas');
  canvas.className = 'topo';
  canvas.setAttribute('aria-hidden', 'true');
  host.prepend(canvas);
  const cx = canvas.getContext('2d');
  const peak = at.slice();
  let mouse = [0.5, 0.5];
  let w = 0;
  let h = 0;
  let t = 0;
  let frame = 0;
  let seen = false;

  const size = () => {
    const r = Math.min(devicePixelRatio || 1, 2);
    w = canvas.clientWidth;
    h = canvas.clientHeight;
    canvas.width = Math.round(w * r);
    canvas.height = Math.round(h * r);
    cx.setTransform(r, 0, 0, r, 0, 0);
  };

  const draw = () => {
    peak[0] += (at[0] + (mouse[0] - 0.5) * 0.08 - peak[0]) * 0.04;
    peak[1] += (at[1] + (mouse[1] - 0.5) * 0.08 - peak[1]) * 0.04;
    cx.clearRect(0, 0, w, h);
    const ink = getComputedStyle(host).getPropertyValue('--accent').trim() || '#6a6fd6';
    const px = peak[0] * w;
    const py = peak[1] * h;
    const big = Math.max(w, h);
    cx.strokeStyle = ink;
    for (let i = 1; i < 26; i++) {
      const base = i * big * 0.03;
      cx.beginPath();
      for (let a = 0; a <= 120; a++) {
        const th = (a / 120) * Math.PI * 2;
        const wob = Math.sin(th * 3 + t + i * 0.4) * 10 + Math.sin(th * 5 - t * 0.7 + i) * 6 + Math.sin(th * 2 + i * 0.9) * i * 1.6;
        const x = px + Math.cos(th) * (base + wob) * 1.25;
        const y = py + Math.sin(th) * (base + wob) * 0.85;
        if (a) cx.lineTo(x, y);
        else cx.moveTo(x, y);
      }
      // Every fifth line is an index contour, as on a survey map.
      cx.globalAlpha = i % 5 === 0 ? 0.3 : 0.11;
      cx.lineWidth = i % 5 === 0 ? 1.4 : 1;
      cx.stroke();
    }
    cx.globalAlpha = 1;
    t += 0.004;
    frame = seen && !still() && !document.hidden ? requestAnimationFrame(draw) : 0;
  };

  const run = () => {
    if (!frame && seen && canvas.clientWidth) {
      size();
      frame = requestAnimationFrame(draw);
    }
  };

  new ResizeObserver(() => {
    if (!canvas.clientWidth) return;
    size();
    if (!frame) draw();
  }).observe(canvas);
  new IntersectionObserver(([entry]) => {
    seen = entry.isIntersecting;
    run();
  }).observe(host);
  document.addEventListener('visibilitychange', run);
  host.addEventListener('pointermove', (event) => {
    const box = host.getBoundingClientRect();
    mouse = [(event.clientX - box.left) / box.width, (event.clientY - box.top) / box.height];
  });
}

/* ---------------------------------------------------------------------------
   Landing features: the four cards become tabs over one panel, with a raised
   pill that slides to the picked tab. Without script they stay four cards.
   --------------------------------------------------------------------------- */

function featureTabs(box) {
  const cards = [...box.querySelectorAll('.feature')];
  if (cards.length < 2) return;
  const list = document.createElement('div');
  list.className = 'ftabs';
  list.setAttribute('role', 'tablist');
  list.setAttribute('aria-label', 'Terra features');
  const pill = document.createElement('i');
  pill.className = 'ftab-pill';
  pill.setAttribute('aria-hidden', 'true');
  const tabs = cards.map((card, n) => {
    const title = card.querySelector('h3');
    const tab = document.createElement('button');
    tab.type = 'button';
    tab.className = 'ftab';
    tab.id = `ftab-${n}`;
    tab.setAttribute('role', 'tab');
    tab.setAttribute('aria-controls', `fpane-${n}`);
    const icon = card.querySelector('svg')?.cloneNode(true);
    if (icon) tab.append(icon);
    tab.append(Object.assign(document.createElement('b'), { textContent: title?.textContent ?? '' }));
    card.id = `fpane-${n}`;
    card.setAttribute('role', 'tabpanel');
    card.setAttribute('aria-labelledby', tab.id);
    return tab;
  });
  list.append(...tabs, pill);
  box.before(list);
  box.classList.add('tabbed');

  let placed = false;
  const place = (tab) => {
    if (!tab.offsetWidth) return;
    if (!placed || still()) pill.style.transition = 'none';
    pill.style.width = `${tab.offsetWidth}px`;
    pill.style.height = `${tab.offsetHeight}px`;
    pill.style.transform = `translate(${tab.offsetLeft}px, ${tab.offsetTop}px)`;
    if (!placed || still()) {
      pill.offsetWidth;
      pill.style.transition = '';
    }
    placed = true;
  };
  const pick = (tab, focus = false) => {
    tabs.forEach((each, n) => {
      const on = each === tab;
      each.setAttribute('aria-selected', String(on));
      each.tabIndex = on ? 0 : -1;
      cards[n].classList.toggle('on', on);
    });
    place(tab);
    if (focus) tab.focus();
  };
  tabs.forEach((tab) => tab.addEventListener('click', () => pick(tab)));
  list.addEventListener('keydown', (event) => {
    const at = tabs.indexOf(document.activeElement);
    if (at < 0) return;
    const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[event.key];
    if (event.key === 'Home') pick(tabs[0], true);
    else if (event.key === 'End') pick(tabs.at(-1), true);
    else if (step) pick(tabs[(at + step + tabs.length) % tabs.length], true);
    else return;
    event.preventDefault();
  });
  new ResizeObserver(() => {
    placed = false;
    place(tabs.find((tab) => tab.getAttribute('aria-selected') === 'true') ?? tabs[0]);
  }).observe(list);
  pick(tabs[0]);
}

/* ---------------------------------------------------------------------------
   Welcome counts: home-view.js writes them once they are real; they rise from
   zero the first time each one shows.
   --------------------------------------------------------------------------- */

function riseOnce(node) {
  let done = false;
  new MutationObserver(() => {
    if (done || node.hidden || still()) return;
    const m = /^(\D*?)([\d,]+)(.*)$/s.exec(node.textContent);
    if (!m) return;
    done = true;
    const to = Number(m[2].replace(/,/g, ''));
    const text = node.textContent;
    const start = performance.now();
    const step = (now) => {
      const p = Math.min(1, (now - start) / 900);
      node.textContent = p < 1 ? `${m[1]}${Math.round(to * (1 - (1 - p) ** 4)).toLocaleString('en-US')}${m[3]}` : text;
      if (p < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }).observe(node, { attributes: true, attributeFilter: ['hidden'], childList: true, characterData: true, subtree: true });
}

const gate = document.getElementById('gate');
if (gate) field(gate, [0.74, 0.46]);
const home = document.querySelector('#home-view .home-head');
if (home) field(home, [0.82, 0.4]);
const features = document.querySelector('.core-features');
if (features) featureTabs(features);
for (const id of ['home-jobs-count', 'home-news-count', 'home-events-count']) {
  const node = document.getElementById(id);
  if (node) riseOnce(node);
}
