// pitch.js — the tour: a short, skippable introduction to Terra's four
// features (Jobs, Development map, News with Deal of the week, Events).
//
// account.js opens it once per visit for anyone signed out (sessionStorage, so
// moving between tabs or reloading doesn't bring it back), the "Take the tour"
// link on the sign-in panel and the welcome screen reopen it. The last slide's
// action fits the visitor: create an account or sign in when signed out, back
// to the welcome screen when signed in. ?tour opens it for anyone, which
// makes a shareable pitch link: https://thougthfullcarrot.github.io/Terra/?tour
//
// Arrow keys, the dots, swiping, and the Back/Next buttons all move between
// slides. Escape or "Skip the tour" closes it.
const $ = (id) => document.getElementById(id);
const SEEN_KEY = 'terra-pitch-seen';
/** How far a finger has to travel sideways before a swipe counts. */
const SWIPE_PX = 50;

let slides = [];
let index = 0;
let lastFocus = null;
let started = false;

export function startPitch() {
  if (started) return;
  started = true;
  slides = [...document.querySelectorAll('#pitch .pitch-slide')];
  const dots = $('pitch-dots');
  slides.forEach((slide, i) => {
    const dot = document.createElement('button');
    dot.type = 'button';
    dot.setAttribute('role', 'tab');
    dot.setAttribute('aria-label', slide.getAttribute('aria-label'));
    dot.addEventListener('click', () => go(i));
    dots.append(dot);
  });

  $('pitch-prev').addEventListener('click', () => go(index - 1));
  $('pitch-next').addEventListener('click', () => (index === slides.length - 1 ? start() : go(index + 1)));
  $('pitch-skip').addEventListener('click', closePitch);
  $('pitch-explore').addEventListener('click', closePitch);
  $('pitch-start').addEventListener('click', start);
  $('pitch-signin').addEventListener('click', () => start('signin'));
  $('pitch-open')?.addEventListener('click', () => openPitch());
  $('pitch').addEventListener('keydown', onKey);
  bindSwipe($('pitch-track'));


  const params = new URLSearchParams(location.search);
  if (params.has('tour')) openPitch();
}

/** Opens the deck if this visit hasn't shown it yet. Called by account.js when nobody is signed in. */
export function showPitchOnce() {
  let seen = false;
  try {
    seen = sessionStorage.getItem(SEEN_KEY) === '1';
  } catch {}
  if (!seen) openPitch();
}

export function openPitch(at = 0) {
  if (!started) startPitch();
  try {
    sessionStorage.setItem(SEEN_KEY, '1');
  } catch {}
  const pitch = $('pitch');
  if (!pitch.hidden) return;
  lastFocus = document.activeElement;
  pitch.hidden = false;
  document.body.classList.add('pitch-open');
  go(at, true);
  $('pitch-next').focus({ preventScroll: true });
}

export function closePitch() {
  const pitch = $('pitch');
  if (!pitch || pitch.hidden) return;
  pitch.hidden = true;
  document.body.classList.remove('pitch-open');
  if (new URLSearchParams(location.search).has('tour')) {
    const params = new URLSearchParams(location.search);
    params.delete('tour');
    const query = params.toString();
    history.replaceState(null, '', `${location.pathname}${query ? `?${query}` : ''}${location.hash}`);
  }
  if (lastFocus && document.contains(lastFocus)) lastFocus.focus({ preventScroll: true });
}

/**
 * The last slide's call to action: to the email form in "create" or "sign in"
 * mode when signed out, to the welcome screen when signed in, otherwise (the
 * open site, no accounts) just into the site.
 */
function start(mode = 'create') {
  closePitch();
  const gate = $('gate');
  if (gate && !gate.hidden) {
    $(mode === 'signin' ? 'mode-signin' : 'mode-create')?.click();
    gate.scrollIntoView({ behavior: 'smooth', block: 'center' });
    ($('verify').hidden ? $('signin-email') : $('verify-code')).focus({ preventScroll: true });
  } else if (signedIn()) {
    location.hash = 'home';
  }
}

function go(next, instant = false) {
  index = Math.max(0, Math.min(slides.length - 1, next));
  const track = $('pitch-track');
  track.classList.toggle('instant', instant);
  track.style.transform = `translateX(${-100 * index}%)`;
  slides.forEach((slide, i) => {
    const current = i === index;
    slide.classList.toggle('current', current);
    slide.setAttribute('aria-hidden', String(!current));
    slide.inert = !current;
  });
  [...$('pitch-dots').children].forEach((dot, i) => dot.setAttribute('aria-selected', String(i === index)));
  $('pitch-count').textContent = `${index + 1} / ${slides.length}`;
  $('pitch-progress').style.width = `${((index + 1) / slides.length) * 100}%`;
  $('pitch-prev').disabled = index === 0;
  const last = index === slides.length - 1;
  const out = gateShown();
  const member = !out && signedIn();
  const action = out ? 'Create free account' : member ? 'Go to my welcome screen' : 'Start exploring';
  $('pitch-next').textContent = last ? action : 'Next';
  $('pitch-start').textContent = action;
  $('pitch-signin').hidden = !out;
  $('pitch-explore').hidden = !out;
  $('pitch-final-title').textContent = out ? 'Free for everyone.' : member ? "You're all set." : 'Ready when you are.';
  $('pitch-final-lede').textContent = out
    ? 'Create an account with any email address. No credit card required.'
    : member
      ? 'Your welcome screen links straight to each feature.'
      : 'Jump in and look around.';
}

/** A member is signed in when the profile button shows (account.js). */
function signedIn() {
  const button = $('account-button');
  return Boolean(button && !button.hidden);
}

function gateShown() {
  const gate = $('gate');
  return Boolean(gate && !gate.hidden);
}

function onKey(event) {
  if (event.key === 'Escape') {
    event.preventDefault();
    closePitch();
  } else if (event.key === 'ArrowRight' || event.key === 'PageDown') {
    event.preventDefault();
    go(index + 1);
  } else if (event.key === 'ArrowLeft' || event.key === 'PageUp') {
    event.preventDefault();
    go(index - 1);
  } else if (event.key === 'Home') {
    event.preventDefault();
    go(0);
  } else if (event.key === 'End') {
    event.preventDefault();
    go(slides.length - 1);
  } else if (event.key === 'Tab') {
    trapFocus(event);
  }
}

/** Keeps Tab inside the deck while it is open. */
function trapFocus(event) {
  const focusable = [...$('pitch').querySelectorAll('button, a[href]')].filter(
    (node) => !node.disabled && !node.hidden && node.offsetParent !== null && !node.closest('[inert]')
  );
  if (!focusable.length) return;
  const first = focusable[0];
  const last = focusable.at(-1);
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}

function bindSwipe(track) {
  let startX = null;
  let startY = 0;
  let width = 1;
  track.addEventListener('pointerdown', (event) => {
    if (event.pointerType === 'mouse') return;
    startX = event.clientX;
    startY = event.clientY;
    width = track.parentElement.clientWidth || 1;
  });
  track.addEventListener('pointermove', (event) => {
    if (startX == null) return;
    const dx = event.clientX - startX;
    if (Math.abs(dx) < Math.abs(event.clientY - startY)) return;
    track.classList.add('instant');
    track.style.transform = `translateX(calc(${-100 * index}% + ${dx}px))`;
  });
  const end = (event) => {
    if (startX == null) return;
    const dx = event.clientX - startX;
    startX = null;
    const turned = Math.abs(dx) > Math.min(SWIPE_PX, width / 4);
    go(turned ? index + (dx < 0 ? 1 : -1) : index);
  };
  track.addEventListener('pointerup', end);
  track.addEventListener('pointercancel', end);
}
