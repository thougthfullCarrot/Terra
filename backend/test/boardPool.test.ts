import { describe, expect, it } from 'vitest';
import { inPool } from '../src/collector/run.js';

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

describe('inPool (board read scheduling)', () => {
  it('never runs more than the cap at once and visits every item once', async () => {
    let live = 0;
    let peak = 0;
    const seen: number[] = [];
    await inPool([...Array(23).keys()], 4, async (i) => {
      live++;
      peak = Math.max(peak, live);
      await sleep((i * 7) % 13);
      seen.push(i);
      live--;
    });
    expect(peak).toBe(4);
    expect(seen.sort((a, b) => a - b)).toEqual([...Array(23).keys()]);
  });

  it('does not let one slow board hold the other slots (fixed batches did)', async () => {
    // One board retrying 5xx answers (slow) per batch of 4, the rest quick.
    const durations = [...Array(16).keys()].map((i) => (i % 4 === 0 ? 80 : 10));
    const t0 = Date.now();
    await inPool(durations, 4, (ms) => sleep(ms));
    const pooled = Date.now() - t0;
    const t1 = Date.now();
    for (let i = 0; i < durations.length; i += 4) await Promise.all(durations.slice(i, i + 4).map((ms) => sleep(ms)));
    const batched = Date.now() - t1;
    // Batches: 4 × 80 = 320 ms. Pool: 4 slow boards run side by side, ≈ 80–100 ms.
    expect(pooled).toBeLessThan(batched * 0.6);
  });

  it('handles an empty firm list', async () => {
    await inPool([], 4, async () => { throw new Error('never called'); });
  });
});
