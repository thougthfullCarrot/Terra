import { describe, expect, it } from 'vitest';
import {
  EMAIL_LIMIT,
  dueReminders,
  escapeHtml,
  pickJobs,
  renderEmail,
  type AlertRecipient,
  type TrackedJob
} from '../src/alerts/digest.js';
import { toSitePosting, type SitePosting } from '../src/site/snapshot.js';
import type { Posting } from '../src/types.js';

const now = new Date('2026-10-05T13:00:00Z');
const DAY = 24 * 60 * 60 * 1000;

function job(id: string, over: Partial<Posting> = {}): SitePosting {
  return toSitePosting({
    id,
    role: 'Acquisitions Analyst',
    firm: 'Hines',
    city: 'Austin',
    sector: 'Investment',
    kind: 'Entry-level',
    pay: null,
    deadline: null,
    postedAt: new Date(now.getTime() - DAY),
    description: 'Underwrite deals in Argus and Excel.',
    reqs: [],
    applyUrl: `https://example.com/${id}`,
    source: 'test',
    ...over
  } as Posting);
}

const member: AlertRecipient = {
  user_id: 'u1',
  email: 'a@example.com',
  school: null,
  grad_year: null,
  home_city: 'Austin',
  sectors: ['Investment'],
  relocation_open: false,
  resume_text: null,
  alert_cities: [],
  alert_kinds: [],
  alert_min_match: 0
};

describe('pickJobs', () => {
  it('sends jobs from the last week that the member has not had yet', () => {
    const jobs = [job('new'), job('sent'), job('old', { postedAt: new Date(now.getTime() - 8 * DAY) })];
    const picked = pickJobs(member, jobs, new Set(['sent']), now).map((p) => p.job.id);
    expect(picked).toEqual(['new']);
  });

  it('keeps to the cities and role types the member picked; empty means all', () => {
    const jobs = [job('austin'), job('houston', { city: 'Houston' }), job('intern', { kind: 'Internship' })];
    expect(pickJobs(member, jobs, new Set(), now)).toHaveLength(3);
    const picky = { ...member, alert_cities: ['Austin'], alert_kinds: ['Entry-level'] };
    expect(pickJobs(picky, jobs, new Set(), now).map((p) => p.job.id)).toEqual(['austin']);
  });

  it('applies the match threshold only when there is a resume to score', () => {
    const jobs = [
      job('fit'),
      job('far', { city: 'El Paso', sector: 'Brokerage', role: 'Leasing Coordinator', description: 'Answer phones.' })
    ];
    const noResume = { ...member, alert_min_match: 75 };
    expect(pickJobs(noResume, jobs, new Set(), now)).toHaveLength(2);

    const withResume = { ...noResume, resume_text: 'Argus Enterprise, Excel modeling, DCF, acquisitions.' };
    const picked = pickJobs(withResume, jobs, new Set(), now);
    expect(picked.map((p) => p.job.id)).toEqual(['fit']);
    expect(picked[0]!.match!.score).toBeGreaterThanOrEqual(75);
  });

  it('puts the best match first', () => {
    const jobs = [
      job('weak', { city: 'El Paso', sector: 'Brokerage', role: 'Leasing Coordinator', description: 'Answer phones.' }),
      job('strong')
    ];
    const withResume = { ...member, resume_text: 'Argus Enterprise, Excel modeling, DCF, acquisitions.' };
    expect(pickJobs(withResume, jobs, new Set(), now).map((p) => p.job.id)).toEqual(['strong', 'weak']);
  });
});

describe('renderEmail', () => {
  it('names the top job in the subject and links each job', () => {
    const picked = [{ job: job('a1'), match: null }, { job: job('a2', { firm: 'JLL' }), match: null }];
    const email = renderEmail(picked, 'https://terra.example/');
    expect(email.subject).toBe('2 new Texas CRE jobs for you, including Acquisitions Analyst at Hines');
    expect(email.text).toContain('Apply: https://example.com/a2');
    expect(email.html).toContain('https://terra.example/?job=a1');
  });

  it('lists at most EMAIL_LIMIT jobs and counts the rest', () => {
    const picked = Array.from({ length: EMAIL_LIMIT + 3 }, (_, i) => ({ job: job(`j${i}`), match: null }));
    const email = renderEmail(picked, 'https://terra.example');
    expect(email.text).toContain('And 3 more on Terra: https://terra.example/');
    expect(email.text.match(/^Apply: /gm)).toHaveLength(EMAIL_LIMIT);
  });

  it('escapes posting text and never links to a non-web apply URL', () => {
    const bad = job('x', { role: '<script>alert(1)</script>', applyUrl: 'javascript:alert(1)' });
    const email = renderEmail([{ job: bad, match: null }], 'https://terra.example/');
    expect(email.html).not.toContain('<script>');
    expect(email.html).not.toContain('javascript:');
    expect(email.text).toContain('Apply: https://terra.example/?job=x');
    expect(escapeHtml(`"&'`)).toBe('&quot;&amp;&#39;');
  });
});

describe('dueReminders', () => {
  const base: TrackedJob = {
    user_id: 'u1',
    job_id: 'j',
    stage: 'Applied',
    follow_up: null,
    reminded_on: null,
    job: { role: 'Analyst', firm: 'Hines', deadline: null }
  };
  const today = '2026-10-05';

  it('reminds once when a follow-up comes due, and again only if the date moves', () => {
    expect(dueReminders([{ ...base, follow_up: '2026-10-05' }], today).map((r) => r.why)).toEqual(['Follow up today']);
    expect(dueReminders([{ ...base, follow_up: '2026-10-03' }], today).map((r) => r.why)).toEqual(['Follow-up 2 days overdue']);
    expect(dueReminders([{ ...base, follow_up: '2026-10-03', reminded_on: '2026-10-03' }], today)).toEqual([]);
    expect(dueReminders([{ ...base, follow_up: '2026-10-05', reminded_on: '2026-10-03' }], today)).toHaveLength(1);
    expect(dueReminders([{ ...base, follow_up: '2026-10-06' }], today)).toEqual([]);
  });

  it('nudges saved jobs about to close, once', () => {
    const saved = { ...base, stage: 'Saved', job: { ...base.job, deadline: '2026-10-07' } };
    expect(dueReminders([saved], today).map((r) => r.why)).toEqual(['Applications close in 2 days']);
    expect(dueReminders([{ ...saved, reminded_on: '2026-10-04' }], today)).toEqual([]);
    expect(dueReminders([{ ...saved, job: { ...saved.job, deadline: '2026-10-20' } }], today)).toEqual([]);
    // Already applied: the deadline no longer matters.
    expect(dueReminders([{ ...saved, stage: 'Applied' }], today)).toEqual([]);
  });

  it('skips finished applications', () => {
    expect(dueReminders([{ ...base, stage: 'Offer', follow_up: today }], today)).toEqual([]);
  });

  it('can carry an email on reminders alone', () => {
    const reminders = dueReminders([{ ...base, follow_up: today }], today);
    const email = renderEmail([], 'https://terra.example/', reminders);
    expect(email.subject).toBe('Reminder: Analyst at Hines');
    expect(email.text).toContain('Follow up today: Analyst — Hines (Applied)');
    expect(email.html).toContain('https://terra.example/#tracker');
  });
});
