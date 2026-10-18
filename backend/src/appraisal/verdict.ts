/**
 * How a verify case is judged. Each case carries up to four checks, kept apart so a report never counts one it
 * couldn't run as a pass:
 *   index     the lookup returned the status and accounts the case expects (offline, always run)
 *   accounts  the district's live layer returns the same accounts for the address
 *   values    the live layer holds the same total values
 *   page      the district's own account page shows the owner and value
 * A check is pass, fail, or unavailable (with the reason), or skipped when the district has nothing to check
 * against (a bulk-file district has no live layer).
 *
 * A full run requires every check that could run: index, accounts and values must pass, and a page check that
 * was read must find the owner and value. A page that robots.txt or a bot check keeps closed is unavailable, not
 * a pass. A quick run (push or pilot reads only part of each district) requires the index check alone and is
 * reported as quick, never as full verification.
 */
export type CheckState = 'pass' | 'fail' | 'unavailable' | 'skipped';
export interface Check { state: CheckState; note?: string }
export type Policy = 'full' | 'quick';
export interface CaseChecks { index: Check; accounts: Check; values: Check; page: Check }

const REQUIRED: Record<Policy, (keyof CaseChecks)[]> = { full: ['index', 'accounts', 'values', 'page'], quick: ['index'] };

/** Failed (or, on a full run, failed-to-run live) checks that this policy requires. */
export function failures(checks: CaseChecks, policy: Policy): string[] {
  const out: string[] = [];
  for (const name of REQUIRED[policy]) {
    const c = checks[name];
    if (c.state === 'fail') out.push(`${name}${c.note ? `: ${c.note}` : ''}`);
    // A live layer that should have answered but didn't is a failed required check; a closed page is only labeled.
    if (policy === 'full' && c.state === 'unavailable' && name !== 'page') out.push(`${name} could not run${c.note ? `: ${c.note}` : ''}`);
  }
  return out;
}

export function label(checks: CaseChecks): string {
  return (Object.keys(checks) as (keyof CaseChecks)[]).map((k) => `${k} ${checks[k].state}${checks[k].state !== 'pass' && checks[k].note ? ` (${checks[k].note})` : ''}`).join(', ');
}

/** The run's exit status: 1 when any case fails this policy, or when a full run checked nothing. */
export function runStatus(cases: { checks: CaseChecks }[], policy: Policy): { exitCode: 0 | 1; summary: string } {
  const failed = cases.filter((c) => failures(c.checks, policy).length).length;
  const count = (n: keyof CaseChecks, s: CheckState) => cases.filter((c) => c.checks[n].state === s).length;
  const parts = (['index', 'accounts', 'values', 'page'] as const).map((n) => `${n} ${count(n, 'pass')} pass / ${count(n, 'fail')} fail / ${count(n, 'unavailable')} unavailable / ${count(n, 'skipped')} skipped`);
  const empty = policy === 'full' && cases.length === 0;
  const head = policy === 'full' ? 'FULL verification' : 'QUICK check (index only required; not full verification)';
  return { exitCode: failed || empty ? 1 : 0, summary: `${head}: ${cases.length - failed}/${cases.length} cases pass${empty ? ', no cases ran' : ''}; ${parts.join('; ')}` };
}
