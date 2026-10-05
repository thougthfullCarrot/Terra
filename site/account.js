// account.js — sign-in, access, and the profile page. Loaded by app.js only
// when config.js names a Supabase project.
//
// Who sees what:
//   signed out                     -> sign-in form (magic link to any email)
//   signed in, college (.edu)      -> the feed, free
//   signed in, active subscription -> the feed
//   signed in, neither             -> subscribe (Stripe Payment Link)
// The database enforces the same rule (access_level() in migration 0005);
// this file only decides which panel to show.
import { CONFIG } from './config.js';
import {
  ALERT_GOOD_MATCH,
  ALERT_KINDS,
  PROFILE_CITIES,
  PROFILE_SECTORS,
  alertRow,
  checkoutUrl,
  fileProblem,
  gradYears,
  initials,
  isCollegeEmail,
  isEmail,
  profileRow,
  resumeContentType,
  storagePath
} from './access.js';
import { schoolFor } from './school.js';

const $ = (id) => document.getElementById(id);
/** Resume text kept for matching. A long resume is a few thousand characters; this leaves room without storing a novel. */
const RESUME_TEXT_LIMIT = 50000;
/** After Stripe checkout, how long to wait for the webhook to record the subscription. */
const CHECKOUT_POLLS = 10;
const CHECKOUT_POLL_MS = 3000;

let supabase;
let app;
let user = null;
let access = null;
let profile = null;
let avatarUrl = null;

export async function startAccounts(hooks) {
  app = hooks;
  const { createClient } = await import('./vendor/supabase.js');
  supabase = createClient(CONFIG.supabaseUrl, CONFIG.supabaseAnonKey, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
  });

  bindSignIn();
  bindProfile();

  // Runs once at start (INITIAL_SESSION) and on every sign-in and sign-out.
  // Supabase warns against awaiting its own calls inside this callback, so
  // the work is deferred a tick.
  //
  // A page that opens with a stored session gets INITIAL_SESSION and then
  // SIGNED_IN for the same account, back to back. Both used to start
  // signedIn() before either had finished, and the two feed loads raced: one
  // cleared the list while the other drew it, leaving an empty job list or a
  // script error. The account is noted as soon as an event names it, so a
  // repeat (or a token refresh) is ignored.
  let shownUserId;
  supabase.auth.onAuthStateChange((_event, session) => {
    const next = session?.user ?? null;
    if ((next?.id ?? null) === shownUserId) return;
    shownUserId = next?.id ?? null;
    setTimeout(() => (next ? signedIn(next) : signedOut()), 0);
  });
}

// ---------------------------------------------------------------------------
// Views
// ---------------------------------------------------------------------------

function show(view) {
  for (const id of ['gate', 'paywall', 'profile', 'feed']) $(id).hidden = id !== view;
  $('welcome').hidden = view !== 'gate';
  $('account-button').hidden = !user || view === 'profile';
}

function signedOut() {
  user = null;
  access = null;
  profile = null;
  avatarUrl = null;
  app.hideFeed();
  app.setProfile(null);
  const price = CONFIG.paymentLink && CONFIG.priceLabel ? ` (${CONFIG.priceLabel})` : '';
  $('gate-lede').textContent = CONFIG.paymentLink
    ? `Terra is free with a college (.edu) email. Any other email can subscribe${price}.`
    : 'Terra is free for students. Sign in with your college (.edu) email.';
  $('plan-paid').hidden = !CONFIG.paymentLink;
  $('plan-price').textContent = CONFIG.priceLabel || 'Monthly';
  show('gate');
}

async function signedIn(next) {
  user = next;
  access = await accessLevel();
  await loadProfile();

  if (access === 'college' || access === 'subscriber') {
    clearCheckoutFlag();
    show('feed');
    await loadFeed();
    return;
  }

  app.hideFeed();
  showPaywall();
  if (new URLSearchParams(location.search).get('checkout') === 'success') await waitForSubscription();
}

async function accessLevel() {
  const { data, error } = await supabase.rpc('access_level');
  if (error) {
    console.error(error);
    return 'none';
  }
  return data ?? 'none';
}

async function loadFeed() {
  app.hideFeed('Loading postings…');
  const { data, error } = await supabase.from('site_snapshots').select('data').eq('id', 'current').maybeSingle();
  if (error || !data) {
    app.hideFeed(error ? `Couldn't load postings. ${error.message}` : 'The job list is being built. Check back in a few minutes.');
    return;
  }
  app.showFeed(data.data);
  app.setTracker(trackerStore());
  // Market data sits in the same members-only table, one row of its own.
  app.setMarketLoader(async () => {
    const market = await supabase.from('site_snapshots').select('data').eq('id', 'market').maybeSingle();
    if (market.error) throw new Error(market.error.message);
    return market.data?.data ?? null;
  });
}

/** The member's application tracker, kept in tracked_jobs (migration 0008). Each call throws on error. */
function trackerStore() {
  const table = () => supabase.from('tracked_jobs');
  const check = ({ data, error }) => {
    if (error) throw new Error(error.message);
    return data;
  };
  return {
    list: async () => check(await table().select('*').eq('user_id', user.id)) ?? [],
    save: async (row) => check(await table().upsert({ user_id: user.id, ...row }).select('*').single()),
    saveMany: async (rows) =>
      check(await table().upsert(rows.map((row) => ({ user_id: user.id, ...row }))).select('*')) ?? [],
    remove: async (jobId) => check(await table().delete().eq('user_id', user.id).eq('job_id', jobId))
  };
}

function showPaywall() {
  const link = CONFIG.paymentLink ? checkoutUrl(CONFIG.paymentLink, { userId: user.id, email: user.email }) : null;
  const subscribe = $('subscribe');
  if (link) {
    const price = CONFIG.priceLabel ? ` for ${CONFIG.priceLabel}` : '';
    $('paywall-title').textContent = 'Subscribe to see the jobs';
    $('paywall-lede').textContent = `You're signed in as ${user.email}. Terra is free with a college (.edu) email; any other email can subscribe${price}. Cancel anytime.`;
    subscribe.href = link;
    subscribe.textContent = CONFIG.priceLabel ? `Subscribe · ${CONFIG.priceLabel}` : 'Subscribe';
    subscribe.hidden = false;
  } else {
    $('paywall-title').textContent = 'A college email is required';
    $('paywall-lede').textContent = `You're signed in as ${user.email}. Terra is open to college (.edu) emails right now. Sign in with your school email to see the jobs.`;
    subscribe.hidden = true;
  }
  show('paywall');
}

/** Stripe sends people back with ?checkout=success; the webhook may land a few seconds later. */
async function waitForSubscription() {
  note('paywall-status', 'Confirming your payment…');
  for (let i = 0; i < CHECKOUT_POLLS; i++) {
    await new Promise((resolve) => setTimeout(resolve, CHECKOUT_POLL_MS));
    if ((await accessLevel()) === 'subscriber') {
      note('paywall-status', '');
      return signedIn(user);
    }
  }
  note('paywall-status', "We haven't seen your payment yet. Refresh in a minute; if it still doesn't show, reply to your Stripe receipt.", true);
}

function clearCheckoutFlag() {
  const params = new URLSearchParams(location.search);
  if (!params.has('checkout')) return;
  params.delete('checkout');
  const query = params.toString();
  history.replaceState(null, '', `${location.pathname}${query ? `?${query}` : ''}`);
}

// ---------------------------------------------------------------------------
// Sign-in
// ---------------------------------------------------------------------------

let pendingEmail = '';

function bindSignIn() {
  $('welcome-start').addEventListener('click', () => {
    $('gate').scrollIntoView({ behavior: 'smooth', block: 'center' });
    ($('verify').hidden ? $('signin-email') : $('verify-code')).focus({ preventScroll: true });
  });
  $('signin').addEventListener('submit', async (event) => {
    event.preventDefault();
    const email = $('signin-email').value.trim();
    if (!isEmail(email)) return note('signin-status', 'Enter your email address.', true);
    if (!isCollegeEmail(email) && !CONFIG.paymentLink) {
      return note('signin-status', 'Terra is open to college (.edu) emails right now. Use your school email.', true);
    }

    $('signin-submit').disabled = true;
    // A typed code rather than a link: school mail filters often flag sign-in
    // links as suspicious, and a code also works when the email is opened on
    // another device.
    const { error } = await supabase.auth.signInWithOtp({ email });
    $('signin-submit').disabled = false;

    if (error) {
      const busy = error.status === 429 || /rate limit/i.test(error.message);
      return note('signin-status', busy
        ? 'Too many sign-in emails were sent in the last hour. Please try again in a little while.'
        : `Couldn't send the code: ${error.message}`, true);
    }
    pendingEmail = email;
    $('verify').hidden = false;
    $('verify-code').focus();
    const extra = isCollegeEmail(email) ? '' : " Since it isn't a college email, you'll be asked to subscribe after signing in.";
    note('signin-status', `We emailed a code to ${email}. Enter it above. It expires in an hour.${extra}`);
  });

  $('verify').addEventListener('submit', async (event) => {
    event.preventDefault();
    const token = $('verify-code').value.replace(/\s/g, '');
    if (!pendingEmail || !/^\d{6,10}$/.test(token)) return note('signin-status', 'Enter the code from the email.', true);
    $('verify-submit').disabled = true;
    const { error } = await supabase.auth.verifyOtp({ email: pendingEmail, token, type: 'email' });
    $('verify-submit').disabled = false;
    if (error) return note('signin-status', "That code didn't work. Check it, or send a new one.", true);
    $('verify').hidden = true;
    $('verify-code').value = '';
    $('signin-status').hidden = true;
  });

  for (const id of ['paywall-signout', 'signout']) {
    $(id).addEventListener('click', () => supabase.auth.signOut());
  }
}

// ---------------------------------------------------------------------------
// Profile
// ---------------------------------------------------------------------------

function bindProfile() {
  const form = $('profile-form');
  for (const year of gradYears()) form.gradYear.append(new Option(String(year), String(year)));
  for (const city of PROFILE_CITIES) form.homeCity.append(new Option(city, city));
  $('sector-options').replaceChildren(...PROFILE_SECTORS.map((sector) => checkChip('sectors', sector)));
  $('alert-city-options').replaceChildren(...PROFILE_CITIES.map((city) => checkChip('alertCities', city)));
  $('alert-kind-options').replaceChildren(...ALERT_KINDS.map((kind) => checkChip('alertKinds', kind)));

  $('account-button').addEventListener('click', openProfile);
  $('profile-close').addEventListener('click', closeProfile);
  form.addEventListener('submit', saveProfile);
  $('avatar-file').addEventListener('change', (event) => uploadAvatar(event.target));
  $('resume-file').addEventListener('change', (event) => uploadResume(event.target));
  $('resume-remove').addEventListener('click', removeResume);
}

/** False when the profile row predates migration 0007's alert columns. */
function alertsReady() {
  return !profile || 'email_alerts' in profile;
}

function checkChip(name, value) {
  const label = document.createElement('label');
  label.className = 'check';
  const box = document.createElement('input');
  box.type = 'checkbox';
  box.name = name;
  box.value = value;
  label.append(box, document.createTextNode(value));
  return label;
}

function checked(form, name) {
  return [...form.querySelectorAll(`input[name="${name}"]:checked`)].map((box) => box.value);
}

function openProfile() {
  fillProfile();
  note('profile-status', '');
  note('upload-status', '');
  show('profile');
  window.scrollTo({ top: 0 });
}

function closeProfile() {
  if (access === 'college' || access === 'subscriber') show('feed');
  else showPaywall();
}

async function loadProfile() {
  const { data, error } = await supabase.from('profiles').select('*').eq('id', user.id).maybeSingle();
  if (error) console.error(error);
  profile = data ?? null;
  avatarUrl = null;
  if (profile?.avatar_path) {
    const signed = await supabase.storage.from('avatars').createSignedUrl(profile.avatar_path, 60 * 60);
    avatarUrl = signed.data?.signedUrl ?? null;
  }
  drawAvatars();
  app.setProfile(toMatchProfile(profile));
}

function toMatchProfile(row) {
  if (!row) return null;
  return {
    school: row.school,
    gradYear: row.grad_year,
    homeCity: row.home_city,
    sectors: row.sectors ?? [],
    relocationOpen: Boolean(row.relocation_open),
    resumeText: row.resume_text
  };
}

const CAP_SVG =
  '<svg class="school-icon" viewBox="0 0 24 24" width="20" height="20" role="img" aria-label="Graduation cap"><path fill="currentColor" d="M12 3 1 9l11 6 9-4.9V17h2V9L12 3zm-6.8 9.2V16c0 1.7 3 3 6.8 3s6.8-1.3 6.8-3v-3.8L12 16l-6.8-3.8z"/></svg>';

/** The school icon and name for a .edu email; hidden for any other email. */
function drawSchool(email) {
  const line = $('profile-school');
  const school = schoolFor(email);
  line.replaceChildren();
  line.hidden = !school;
  if (!school) return;
  const img = document.createElement('img');
  img.className = 'school-icon';
  img.width = 20;
  img.height = 20;
  img.alt = school.alt;
  img.referrerPolicy = 'no-referrer';
  img.addEventListener('error', () => {
    const wrap = document.createElement('span');
    wrap.innerHTML = CAP_SVG;
    wrap.firstChild.setAttribute('aria-label', school.alt);
    img.replaceWith(wrap.firstChild);
  }, { once: true });
  img.src = school.iconUrl;
  const name = document.createElement('span');
  name.textContent = school.name;
  line.append(img, name);
}

function fillProfile() {
  const form = $('profile-form');
  form.elements.name.value = profile?.name ?? '';
  form.school.value = profile?.school ?? '';
  // A year older than the list still shows, so saving doesn't drop it.
  const year = profile?.grad_year ? String(profile.grad_year) : '';
  if (year && ![...form.gradYear.options].some((option) => option.value === year)) form.gradYear.append(new Option(year, year));
  form.gradYear.value = year;
  form.major.value = profile?.major ?? '';
  form.homeCity.value = profile?.home_city ?? '';
  form.relocationOpen.checked = Boolean(profile?.relocation_open);
  for (const box of form.querySelectorAll('input[name="sectors"]')) box.checked = (profile?.sectors ?? []).includes(box.value);
  $('alert-settings').hidden = !alertsReady();
  form.emailAlerts.checked = Boolean(profile?.email_alerts);
  for (const box of form.querySelectorAll('input[name="alertCities"]')) box.checked = (profile?.alert_cities ?? []).includes(box.value);
  for (const box of form.querySelectorAll('input[name="alertKinds"]')) box.checked = (profile?.alert_kinds ?? []).includes(box.value);
  form.goodMatchesOnly.checked = (profile?.alert_min_match ?? 0) >= ALERT_GOOD_MATCH;

  $('profile-email').textContent = user.email;
  drawSchool(user.email);
  $('profile-access').textContent =
    access === 'college' ? 'Student · free access' : access === 'subscriber' ? 'Subscriber' : 'No access yet';
  const billing = $('billing');
  billing.hidden = !(access === 'subscriber' && CONFIG.billingPortalLink);
  if (!billing.hidden) billing.href = CONFIG.billingPortalLink;

  drawResume();
}

async function drawResume() {
  const has = Boolean(profile?.resume_path);
  $('resume-button-label').textContent = has ? 'Replace resume' : 'Upload resume';
  $('resume-remove').hidden = !has;
  $('resume-state').textContent = has
    ? 'Resume on file. Jobs that fit it are marked Best match.'
    : 'PDF, Word or text, up to 5 MB. We use it to highlight your best matches.';

  let skills = [];
  if (profile?.resume_text) {
    try {
      skills = (await import('./match.js')).resumeSkills(profile.resume_text);
    } catch {
      skills = [];
    }
  }
  $('resume-skills').replaceChildren(
    ...skills.map((skill) => {
      const li = document.createElement('li');
      li.textContent = skill;
      return li;
    })
  );
}

function drawAvatars() {
  for (const node of [$('account-avatar'), $('profile-avatar')]) {
    node.replaceChildren();
    node.style.backgroundImage = avatarUrl ? `url("${avatarUrl}")` : '';
    if (!avatarUrl) node.textContent = initials(profile?.name, user?.email);
  }
}

async function saveProfile(event) {
  event.preventDefault();
  const form = event.target;
  const row = profileRow({
    name: form.elements.name.value,
    school: form.school.value,
    gradYear: form.gradYear.value,
    major: form.major.value,
    homeCity: form.homeCity.value,
    relocationOpen: form.relocationOpen.checked,
    sectors: checked(form, 'sectors')
  });
  const alerts = alertRow({
    emailAlerts: form.emailAlerts.checked,
    alertCities: checked(form, 'alertCities'),
    alertKinds: checked(form, 'alertKinds'),
    goodMatchesOnly: form.goodMatchesOnly.checked
  });
  const turnedOn = alerts.email_alerts && !profile?.email_alerts;

  $('profile-save').disabled = true;
  const saved = await writeProfile({ ...row, ...alerts });
  // The alert columns arrive with migration 0007; until it has run, save the rest.
  if (!saved && (await writeProfile(row))) {
    $('profile-save').disabled = false;
    $('alert-settings').hidden = true;
    return note('profile-status', "Saved. Job alerts aren't available yet.");
  }
  $('profile-save').disabled = false;
  if (saved) note('profile-status', turnedOn ? `Saved. Job alerts will go to ${user.email} each morning.` : 'Saved.');
}

/** Upsert part of the user's profile row and refresh everything that reads it. */
async function writeProfile(fields) {
  const { data, error } = await supabase
    .from('profiles')
    .upsert({ id: user.id, ...fields })
    .select('*')
    .single();
  if (error) {
    note('profile-status', `Couldn't save: ${error.message}`, true);
    return false;
  }
  profile = data;
  drawAvatars();
  drawResume();
  app.setProfile(toMatchProfile(profile));
  return true;
}

async function uploadAvatar(input) {
  const file = input.files?.[0];
  input.value = '';
  const problem = fileProblem(file, 'avatar');
  if (problem) return note('upload-status', problem, true);

  note('upload-status', 'Uploading picture…');
  const path = storagePath(user.id, 'avatar');
  const { error } = await supabase.storage.from('avatars').upload(path, file, { upsert: true, contentType: file.type });
  if (error) return note('upload-status', `Couldn't upload: ${error.message}`, true);

  if (await writeProfile({ avatar_path: path })) {
    const signed = await supabase.storage.from('avatars').createSignedUrl(path, 60 * 60);
    avatarUrl = signed.data?.signedUrl ?? null;
    drawAvatars();
    note('upload-status', 'Picture updated.');
  }
}

async function uploadResume(input) {
  const file = input.files?.[0];
  input.value = '';
  const problem = fileProblem(file, 'resume');
  if (problem) return note('upload-status', problem, true);

  note('upload-status', 'Reading your resume…');
  let text;
  try {
    const { extractResumeText } = await import('./vendor/resume.js');
    text = (await extractResumeText(file)).replace(/\s+/g, ' ').trim().slice(0, RESUME_TEXT_LIMIT);
  } catch (error) {
    console.error(error);
    return note('upload-status', "Couldn't read that file. Try saving your resume as a PDF.", true);
  }
  if (!text) {
    return note('upload-status', "That file has no text we can read (a scanned image?). Try a PDF exported from Word or Google Docs.", true);
  }

  note('upload-status', 'Uploading resume…');
  const path = storagePath(user.id, 'resume', file.name);
  const { error } = await supabase.storage
    .from('resumes')
    .upload(path, file, { upsert: true, contentType: resumeContentType(file.name) });
  if (error) return note('upload-status', `Couldn't upload: ${error.message}`, true);

  // A resume of a different type lands at a different path; drop the old one.
  if (profile?.resume_path && profile.resume_path !== path) {
    await supabase.storage.from('resumes').remove([profile.resume_path]);
  }
  if (await writeProfile({ resume_path: path, resume_text: text })) {
    note('upload-status', 'Resume saved. Your best matches are now marked in the job list.');
  }
}

async function removeResume() {
  if (!profile?.resume_path) return;
  const { error } = await supabase.storage.from('resumes').remove([profile.resume_path]);
  if (error) return note('upload-status', `Couldn't remove: ${error.message}`, true);
  if (await writeProfile({ resume_path: null, resume_text: null })) note('upload-status', 'Resume removed.');
}

function note(id, message, isError = false) {
  const node = $(id);
  node.textContent = message;
  node.hidden = !message;
  node.classList.toggle('error', isError);
}
