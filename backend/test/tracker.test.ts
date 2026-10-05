import { describe, expect, it } from 'vitest';
import {
  followUpLabel,
  groupByStage,
  importRows,
  STAGES,
  texasToday,
  trackedRow,
  trackerSummary
} from '../../site/tracker.js';

// 8pm in Texas on Oct 4 is already Oct 5 in UTC.
const now = new Date('2026-10-05T01:00:00Z');

const job = {
  id: 'j1',
  role: 'Analyst',
  firm: 'Hines',
  city: 'Houston',
  kind: 'Entry-level',
  applyUrl: 'https://example.com',
  deadline: null,
  desc: 'long text that is not kept'
};

describe('trackedRow', () => {
  it('keeps a summary of the job and cleans the inputs', () => {
    const row = trackedRow('j1', { stage: 'Applied', note: '  called the recruiter ', followUp: '2026-10-10', job });
    expect(row).toEqual({
      job_id: 'j1',
      stage: 'Applied',
      note: 'called the recruiter',
      follow_up: '2026-10-10',
      job: { role: 'Analyst', firm: 'Hines', city: 'Houston', kind: 'Entry-level', applyUrl: 'https://example.com', deadline: null }
    });
  });

  it('falls back to Saved and drops a bad date or empty note', () => {
    const row = trackedRow('j1', { stage: 'Hired!', note: '   ', followUp: 'next week' });
    expect(row.stage).toBe('Saved');
    expect(row.note).toBeNull();
    expect(row.follow_up).toBeNull();
  });
});

describe('dates', () => {
  it('uses the Texas calendar day', () => {
    expect(texasToday(now)).toBe('2026-10-04');
  });

  it('labels follow-ups relative to today in Texas', () => {
    expect(followUpLabel('2026-10-04', now)).toEqual({ text: 'Follow up today', due: true });
    expect(followUpLabel('2026-10-02', now)).toEqual({ text: 'Follow-up 2 days overdue', due: true });
    expect(followUpLabel('2026-10-05', now)).toEqual({ text: 'Follow up tomorrow', due: false });
    expect(followUpLabel('2026-10-09', now)).toEqual({ text: 'Follow up in 5 days', due: false });
    expect(followUpLabel(null, now)).toBeNull();
  });
});

describe('grouping and summary', () => {
  const rows = [
    { stage: 'Applied', follow_up: '2026-10-03', updated_at: '2026-10-01' },
    { stage: 'Applied', follow_up: null, updated_at: '2026-10-03' },
    { stage: 'Interviewing', follow_up: '2026-10-20', updated_at: '2026-10-02' }
  ];

  it('has every stage, newest change first', () => {
    const groups = groupByStage(rows);
    expect([...groups.keys()]).toEqual(STAGES);
    expect(groups.get('Applied')!.map((r) => r.updated_at)).toEqual(['2026-10-03', '2026-10-01']);
    expect(groups.get('Offer')).toEqual([]);
  });

  it('counts stages and due follow-ups', () => {
    expect(trackerSummary(rows, now)).toBe('2 applied · 1 interviewing · 1 follow-up due');
    expect(trackerSummary([], now)).toBe('');
  });
});

describe('importRows', () => {
  it('brings over device-saved jobs still in the feed and not already tracked', () => {
    const rows = importRows(['j1', 'gone', 'j2'], [job, { ...job, id: 'j2' }], new Set(['j2']));
    expect(rows.map((r) => [r.job_id, r.stage])).toEqual([['j1', 'Saved']]);
  });
});
