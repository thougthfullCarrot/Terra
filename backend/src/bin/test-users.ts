/**
 * Create, check or remove the website's fifty test accounts (src/testUsers/people.ts).
 *
 *   npm run test-users -- seed     # create or refresh them, then check
 *   npm run test-users -- check    # sign in as each and report what they see
 *   npm run test-users -- remove   # delete them and their files
 *
 * Needs SUPABASE_URL, SUPABASE_ANON_KEY and SERVICE_ROLE_KEY. Everything goes
 * through the Supabase admin API: accounts are created already confirmed and
 * each check signs in with a one-time token the admin API hands back, so no
 * email is ever sent. Paid access is a row in `subscriptions` with made-up
 * Stripe ids; Stripe itself is never called.
 *
 * Only accounts that are both in the list and flagged
 * app_metadata.terra_test_user are ever changed or removed.
 *
 * With BROWSER=1 the check also opens the real website (site/, served
 * locally against the same Supabase project) as each account in headless
 * Chromium and clicks through it; see src/testUsers/browser.ts.
 *
 * The check writes a Markdown report to REPORT_PATH (default stdout) and
 * exits non-zero if any check failed.
 */
import { readFile, writeFile, appendFile } from 'node:fs/promises';
import { deflateSync, crc32 } from 'node:zlib';
import { createClient, type SupabaseClient, type User } from '@supabase/supabase-js';
import { PEOPLE, TEST_FLAG, type TestPerson } from '../testUsers/people.js';
import { scoreJobs, type SiteJob, type SiteMatch } from '../site/browserMatch.js';
import { SiteTester, type BrowserResult } from '../testUsers/browser.js';

// The site's own form and email rules. site/ has no package.json saying it is
// an ES module, so tsx would load it as CommonJS; import its source instead.
const siteAccess: typeof import('../../../site/access.js') = await import(
  `data:text/javascript,${encodeURIComponent(await readFile(new URL('../../../site/access.js', import.meta.url), 'utf8'))}`
);
const { isCollegeEmail, profileRow, alertRow } = siteAccess;

const DAY = 24 * 60 * 60 * 1000;

interface Env {
  url: string;
  anonKey: string;
  serviceKey: string;
}

function env(): Env {
  const url = process.env.SUPABASE_URL?.replace(/\/+$/, '');
  const anonKey = process.env.SUPABASE_ANON_KEY;
  const serviceKey = process.env.SERVICE_ROLE_KEY;
  if (!url || !anonKey || !serviceKey) {
    throw new Error('Set SUPABASE_URL, SUPABASE_ANON_KEY and SERVICE_ROLE_KEY.');
  }
  return { url, anonKey, serviceKey };
}

const noSession = { auth: { persistSession: false, autoRefreshToken: false } };

async function allUsers(admin: SupabaseClient): Promise<User[]> {
  const users: User[] = [];
  for (let page = 1; ; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw error;
    users.push(...data.users);
    if (data.users.length < 1000) return users;
  }
}

/** The listed test accounts that exist, by lower-cased email. Real accounts are never returned. */
async function testAccounts(admin: SupabaseClient): Promise<Map<string, User>> {
  const wanted = new Set(PEOPLE.map((person) => person.email.toLowerCase()));
  const found = new Map<string, User>();
  for (const user of await allUsers(admin)) {
    const email = user.email?.toLowerCase() ?? '';
    if (wanted.has(email) && user.app_metadata?.[TEST_FLAG] === true) found.set(email, user);
  }
  return found;
}

/** A 64x64 PNG in one colour, so every test avatar is a real, distinct image. */
function solidPng([r, g, b]: [number, number, number]): Buffer {
  const size = 64;
  const row = Buffer.alloc(1 + size * 3);
  for (let x = 0; x < size; x++) row.set([r, g, b], 1 + x * 3);
  const raw = Buffer.concat(Array.from({ length: size }, () => row));
  const chunk = (type: string, data: Buffer): Buffer => {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body));
    return Buffer.concat([length, body, crc]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header.set([8, 2, 0, 0, 0], 8); // 8-bit RGB
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

/** Await a Supabase call and throw with a label if it failed. */
async function must<R extends { data: unknown; error: unknown }>(label: string, result: PromiseLike<R>): Promise<R['data']> {
  const { data, error } = await result;
  if (error) throw new Error(`${label}: ${(error as { message?: string }).message ?? String(error)}`);
  return data;
}

async function seed(admin: SupabaseClient): Promise<void> {
  const existing = await testAccounts(admin);
  const everyone = new Map((await allUsers(admin)).map((user) => [user.email?.toLowerCase() ?? '', user]));

  for (const [index, person] of PEOPLE.entries()) {
    const email = person.email.toLowerCase();
    let user = existing.get(email);
    if (!user && everyone.has(email)) {
      throw new Error(`${person.email} already exists but is not a test account; leaving it alone.`);
    }
    if (!user) {
      const created = await must(
        `create ${person.email}`,
        admin.auth.admin.createUser({
          email: person.email,
          email_confirm: true,
          app_metadata: { [TEST_FLAG]: true },
          user_metadata: { [TEST_FLAG]: true, name: person.name }
        })
      );
      user = created.user!;
      console.log(`created ${person.email}`);
    } else {
      console.log(`refreshing ${person.email}`);
    }
    const id = user.id;

    let avatarPath: string | null = null;
    if (person.avatar) {
      avatarPath = `${id}/avatar`;
      await must(
        `avatar for ${person.email}`,
        admin.storage.from('avatars').upload(avatarPath, solidPng(person.avatar), { upsert: true, contentType: 'image/png' })
      );
    }
    let resumePath: string | null = null;
    if (person.resume) {
      resumePath = `${id}/resume.txt`;
      await must(
        `resume for ${person.email}`,
        admin.storage.from('resumes').upload(resumePath, Buffer.from(person.resume, 'utf8'), { upsert: true, contentType: 'text/plain' })
      );
    }

    await must(
      `profile for ${person.email}`,
      admin.from('profiles').upsert({
        id,
        name: person.name,
        school: person.school,
        grad_year: person.gradYear,
        major: person.major,
        home_city: person.homeCity,
        relocation_open: person.relocationOpen,
        sectors: person.sectors,
        avatar_path: avatarPath,
        resume_path: resumePath,
        resume_text: person.resume
      })
    );

    if (person.subscription) {
      const n = String(index + 1).padStart(2, '0');
      const { periodEndDays, status } = person.subscription;
      await must(
        `subscription for ${person.email}`,
        admin.from('subscriptions').upsert(
          {
            user_id: id,
            stripe_customer_id: `cus_TERRA_TEST_${n}`,
            stripe_subscription_id: `sub_TERRA_TEST_${n}`,
            status,
            current_period_end: periodEndDays === null ? null : new Date(Date.now() + periodEndDays * DAY).toISOString()
          },
          { onConflict: 'user_id' }
        )
      );
    } else {
      await must(`clear subscription for ${person.email}`, admin.from('subscriptions').delete().eq('user_id', id));
    }
  }
}

async function remove(admin: SupabaseClient): Promise<void> {
  const accounts = await testAccounts(admin);
  for (const [email, user] of accounts) {
    for (const bucket of ['avatars', 'resumes']) {
      const files = await must(`list ${bucket} for ${email}`, admin.storage.from(bucket).list(user.id));
      if (files?.length) {
        await must(`remove ${bucket} for ${email}`, admin.storage.from(bucket).remove(files.map((file) => `${user.id}/${file.name}`)));
      }
    }
    // Profile and subscription rows go with the account (on delete cascade).
    await must(`delete ${email}`, admin.auth.admin.deleteUser(user.id));
    console.log(`removed ${email}`);
  }
  console.log(`${accounts.size} test account(s) removed.`);
}

// ---------------------------------------------------------------------------
// Checks
// ---------------------------------------------------------------------------

interface Result {
  ok: boolean;
  label: string;
  detail?: string;
}

interface PersonReport {
  person: TestPerson;
  access: string | null;
  results: Result[];
  scored: number;
  strong: number;
  top: { title: string; score: number; strong: boolean; note: string }[];
}

/**
 * Sign in as a user the way the site's code form would, without sending the
 * email. Supabase limits token checks per IP (30 every 5 minutes on the free
 * plan), so fifty accounts in a row wait out the limit rather than fail.
 */
async function signIn(env: Env, admin: SupabaseClient, email: string): Promise<SupabaseClient> {
  for (let attempt = 0; ; attempt++) {
    const link = await must('generate sign-in token', admin.auth.admin.generateLink({ type: 'magiclink', email }));
    const client = createClient(env.url, env.anonKey, noSession);
    const { error } = await client.auth.verifyOtp({ token_hash: link.properties!.hashed_token, type: 'magiclink' });
    if (!error) return client;
    const limited = error.status === 429 || /rate limit/i.test(error.message);
    if (!limited || attempt >= 8) throw new Error(`verify sign-in token: ${error.message}`);
    console.log(`sign-in rate limited for ${email}; waiting 40s`);
    await new Promise((resolve) => setTimeout(resolve, 40_000));
  }
}

type Snapshot = { jobs: (SiteJob & { role: string; firm: string; postedAt: string })[] };

async function checkPerson(
  env: Env,
  admin: SupabaseClient,
  person: TestPerson,
  user: User,
  other: User,
  snapshot: Snapshot | null,
  site: SiteTester | null,
  index: number
): Promise<PersonReport> {
  const results: Result[] = [];
  const check = (ok: boolean, label: string, detail?: string) => results.push({ ok, label, detail });
  const report: PersonReport = { person, access: null, results, scored: 0, strong: 0, top: [] };

  let client: SupabaseClient;
  try {
    client = await signIn(env, admin, user.email!);
    check(true, 'signs in with an emailed code');
  } catch (error) {
    check(false, 'signs in with an emailed code', String(error));
    return report;
  }

  const { data: access, error: accessError } = await client.rpc('access_level');
  report.access = (access as string | null) ?? null;
  check(!accessError && access === person.expected, `access is ${person.expected}`, accessError?.message ?? `got ${access}`);

  // What the sign-in page tells them up front must agree with the database.
  check(isCollegeEmail(person.email) === (person.expected === 'college'), 'page and database agree on college email');

  const member = person.expected !== 'none';
  for (const id of ['current', 'market']) {
    const { data, error } = await client.from('site_snapshots').select('id').eq('id', id);
    const sees = !error && (data?.length ?? 0) > 0;
    check(sees === member, `${member ? 'can' : 'cannot'} read the ${id === 'current' ? 'job feed' : 'market data'}`, error?.message);
  }

  const { data: own, error: ownError } = await client.from('profiles').select('*').eq('id', user.id).maybeSingle();
  check(
    !ownError && own?.name === person.name && own?.school === person.school && own?.grad_year === person.gradYear,
    'sees own profile',
    ownError?.message
  );

  // Save the profile the way the form does, then confirm it reads back the same.
  const row = profileRow({
    name: person.name,
    school: person.school ?? undefined,
    gradYear: person.gradYear ?? undefined,
    major: person.major ?? undefined,
    homeCity: person.homeCity ?? undefined,
    relocationOpen: person.relocationOpen,
    sectors: person.sectors
  });
  const { data: saved, error: saveError } = await client.from('profiles').upsert({ id: user.id, ...row }).select('*').single();
  check(
    !saveError && saved?.major === person.major && [...(saved?.sectors ?? [])].sort().join() === [...person.sectors].sort().join(),
    'saves own profile from the form',
    saveError?.message
  );

  const { data: theirs } = await client.from('profiles').select('id').eq('id', other.id);
  check((theirs?.length ?? 0) === 0, "cannot read another user's profile");
  const { data: theirSub } = await client.from('subscriptions').select('user_id').neq('user_id', user.id);
  check((theirSub?.length ?? 0) === 0, "cannot read anyone else's subscription");

  if (own?.avatar_path) {
    const { data, error } = await client.storage.from('avatars').createSignedUrl(own.avatar_path, 60);
    check(!error && Boolean(data?.signedUrl), 'can show own picture', error?.message);
  }
  if (own?.resume_path) {
    const { data, error } = await client.storage.from('resumes').download(own.resume_path);
    check(!error && (await data?.text()) === person.resume, 'can download own resume', error?.message);
  }
  const otherResume = await client.storage.from('resumes').download(`${other.id}/resume.txt`);
  check(Boolean(otherResume.error), "cannot download another user's resume");
  const intrude = await client.storage.from('resumes').upload(`${other.id}/intruder.txt`, Buffer.from('x'), { contentType: 'text/plain' });
  check(Boolean(intrude.error), "cannot upload into another user's folder");
  if (!intrude.error) await admin.storage.from('resumes').remove([`${other.id}/intruder.txt`]);

  // Daily alerts (migration 0007): save the settings the way the form does, read them back, then turn them off again.
  const alertChoice = alertRow({
    emailAlerts: true,
    alertCities: person.homeCity ? [person.homeCity] : [],
    alertKinds: person.gradYear && person.gradYear > new Date().getUTCFullYear() ? ['Internship'] : ['Entry-level'],
    goodMatchesOnly: Boolean(person.resume)
  });
  const { data: alertSaved, error: alertError } = await client.from('profiles').update(alertChoice).eq('id', user.id).select('*').single();
  check(
    !alertError &&
      alertSaved?.email_alerts === true &&
      [...(alertSaved?.alert_cities ?? [])].join() === alertChoice.alert_cities.join() &&
      [...(alertSaved?.alert_kinds ?? [])].join() === alertChoice.alert_kinds.join() &&
      alertSaved?.alert_min_match === alertChoice.alert_min_match,
    'saves daily alert settings',
    alertError?.message
  );
  await client.from('profiles').update({ email_alerts: false, alert_cities: [], alert_kinds: [], alert_min_match: 0 }).eq('id', user.id);
  const recipients = await client.rpc('alert_recipients');
  check(Boolean(recipients.error), "cannot list who gets alerts (other people's emails)");
  const { data: sends } = await client.from('alert_sends').select('user_id').neq('user_id', user.id);
  check((sends?.length ?? 0) === 0, "cannot read anyone else's alert history");

  // Application tracker (migration 0008): members add, move and remove a job; others can't add.
  const job = snapshot?.jobs[0];
  const jobId = job?.id ?? 'terra-test-job';
  const tracked = await client
    .from('tracked_jobs')
    .upsert({
      user_id: user.id,
      job_id: jobId,
      stage: 'Saved',
      job: { role: job?.role ?? 'Test role', firm: job?.firm ?? 'Test firm', city: job?.city ?? 'Dallas', kind: '', applyUrl: '', deadline: null }
    })
    .select('*');
  if (member) {
    check(!tracked.error && tracked.data?.length === 1, 'can save a job to the tracker', tracked.error?.message);
    const moved = await client
      .from('tracked_jobs')
      .update({ stage: 'Applied', note: `Applied as ${person.name}`, follow_up: '2026-12-01' })
      .eq('user_id', user.id)
      .eq('job_id', jobId)
      .select('*')
      .single();
    check(
      !moved.error && moved.data?.stage === 'Applied' && moved.data?.note === `Applied as ${person.name}` && moved.data?.follow_up === '2026-12-01',
      'can move a tracked job to Applied with a note and follow-up',
      moved.error?.message
    );
    const theirTracked = await client.from('tracked_jobs').select('user_id').neq('user_id', user.id);
    check((theirTracked.data?.length ?? 0) === 0, "cannot read anyone else's tracker");
    const removed = await client.from('tracked_jobs').delete().eq('user_id', user.id).eq('job_id', jobId).select('job_id');
    check(!removed.error && removed.data?.length === 1, 'can remove a tracked job', removed.error?.message);
  } else {
    check(Boolean(tracked.error) || (tracked.data?.length ?? 0) === 0, 'cannot add to the tracker without access');
    if (!tracked.error) await admin.from('tracked_jobs').delete().eq('user_id', user.id).eq('job_id', jobId);
  }

  // Best match, scored exactly as the site does in the browser.
  if (member && snapshot && own) {
    const scores = scoreJobs(
      {
        school: own.school,
        gradYear: own.grad_year,
        homeCity: own.home_city,
        sectors: own.sectors ?? [],
        relocationOpen: Boolean(own.relocation_open),
        resumeText: own.resume_text
      },
      snapshot.jobs
    );
    report.scored = scores.size;
    report.strong = [...scores.values()].filter((match) => match.strong).length;
    const byId = new Map(snapshot.jobs.map((job) => [job.id, job]));
    report.top = [...scores.entries()]
      .sort(([, a], [, b]) => b.score - a.score)
      .slice(0, 3)
      .map(([id, match]: [string, SiteMatch]) => {
        const job = byId.get(id)!;
        return { title: `${job.role} · ${job.firm} · ${job.city}`, score: match.score, strong: match.strong, note: match.note };
      });
    if (person.resume) check(scores.size === snapshot.jobs.length, 'every job gets a match score');
    else check(scores.size === 0, 'no match scores without a resume');
  }

  // The real page, as this account. Before signing out below, which ends every session the account has.
  if (site) {
    const { data } = await client.auth.getSession();
    const expect = { strong: report.strong, scored: report.scored > 0, jobs: member ? snapshot?.jobs.length ?? 0 : 0 };
    const pages: BrowserResult[] = data.session
      ? await site.checkPerson(person, user.id, data.session, expect)
      : [{ ok: false, label: 'browser: no session to open the site with' }];
    // Every fifth account also goes through on a phone-sized screen.
    if (data.session && index % 5 === 0) pages.push(...(await site.checkPerson(person, user.id, data.session, expect, { mobile: true })));
    for (const result of pages) check(result.ok, `site: ${result.label}`, result.detail);
  }

  await client.auth.signOut();
  return report;
}

async function check(env: Env, admin: SupabaseClient): Promise<boolean> {
  const accounts = await testAccounts(admin);
  const lines: string[] = ['# Test accounts', ''];
  let allOk = true;

  // Signed out, the feed must stay closed even to a direct API call.
  const anon = createClient(env.url, env.anonKey, noSession);
  const { data: anonRows } = await anon.from('site_snapshots').select('id');
  const anonOk = (anonRows?.length ?? 0) === 0;
  allOk &&= anonOk;
  lines.push(`${anonOk ? '✅' : '❌'} Signed out: the job feed and market data are ${anonOk ? 'not readable' : 'READABLE'}.`, '');

  const snapshotRow = await must('read snapshot', admin.from('site_snapshots').select('data, updated_at').eq('id', 'current').maybeSingle());
  const snapshot = (snapshotRow?.data as Snapshot | undefined) ?? null;
  lines.push(
    snapshot
      ? `Job feed: ${snapshot.jobs.length} jobs, stored ${snapshotRow!.updated_at}.`
      : 'Job feed: no snapshot stored yet, so matching was not checked.',
    ''
  );

  let site: SiteTester | null = null;
  if (process.env.BROWSER === '1') {
    site = await SiteTester.start({
      supabaseUrl: env.url,
      supabaseAnonKey: env.anonKey,
      paymentLink: process.env.STRIPE_PAYMENT_LINK ?? '',
      billingPortalLink: process.env.STRIPE_BILLING_PORTAL_LINK ?? '',
      priceLabel: process.env.PRICE_LABEL ?? ''
    });
    const signedOut = await site.checkSignedOut();
    for (const result of signedOut) {
      allOk &&= result.ok;
      lines.push(`${result.ok ? '✅' : '❌'} Site, ${result.label}${!result.ok && result.detail ? ` (${result.detail})` : ''}`);
    }
    lines.push('');
  }

  const reports: PersonReport[] = [];
  for (const [index, person] of PEOPLE.entries()) {
    const user = accounts.get(person.email.toLowerCase());
    if (!user) {
      allOk = false;
      lines.push(`❌ ${person.email}: account not found. Run seed first.`);
      continue;
    }
    const otherPerson = PEOPLE[(index + 1) % PEOPLE.length]!;
    const other = accounts.get(otherPerson.email.toLowerCase()) ?? user;
    console.log(`checking ${index + 1}/${PEOPLE.length} ${person.email}`);
    reports.push(await checkPerson(env, admin, person, user, other, snapshot, site, index));
  }
  await site?.stop();

  lines.push('| # | Name | Email | Expected | Got | Checks | Scored | Best matches | Top match |', '|---|---|---|---|---|---|---|---|---|');
  for (const [i, r] of reports.entries()) {
    const passed = r.results.filter((result) => result.ok).length;
    const top = r.top[0] ? `${r.top[0].score}% ${r.top[0].title}` : '–';
    lines.push(
      `| ${i + 1} | ${r.person.name} | ${r.person.email} | ${r.person.expected} | ${r.access ?? '–'} | ${passed}/${r.results.length} | ${r.scored} | ${r.strong} | ${top} |`
    );
  }
  lines.push('');

  const problems = reports.flatMap((r) =>
    r.results.filter((result) => !result.ok).map((result) => `- ${r.person.name}: ${result.label}${result.detail ? ` (${result.detail})` : ''}`)
  );
  lines.push('## Problems', '', ...(problems.length ? problems : ['None.']), '');

  for (const r of reports) {
    lines.push(`## ${r.person.name} (${r.person.email})`, '', `_${r.person.covers}_`, '');
    for (const result of r.results) {
      allOk &&= result.ok;
      lines.push(`- ${result.ok ? '✅' : '❌'} ${result.label}${!result.ok && result.detail ? ` (${result.detail})` : ''}`);
    }
    for (const top of r.top) lines.push(`- ${top.strong ? '⭐ ' : ''}${top.score}% ${top.title}${top.note ? ` (${top.note})` : ''}`);
    lines.push('');
  }

  // Different resumes should put different jobs first.
  const tops = reports.filter((r) => r.top[0]).map((r) => r.top[0]!.title);
  if (tops.length > 1) {
    const distinct = new Set(tops).size;
    lines.push(`Top matches: ${distinct} different jobs across ${tops.length} users with resumes and access.`, '');
  }

  const text = lines.join('\n') + '\n';
  if (process.env.REPORT_PATH) await writeFile(process.env.REPORT_PATH, text);
  if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, text);
  console.log(text);
  return allOk;
}

async function main(): Promise<void> {
  const command = process.argv[2] ?? 'check';
  const settings = env();
  const admin = createClient(settings.url, settings.serviceKey, noSession);
  if (command === 'remove') return remove(admin);
  if (command === 'seed') await seed(admin);
  else if (command !== 'check') throw new Error(`Unknown command "${command}". Use seed, check or remove.`);
  if (!(await check(settings, admin))) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
