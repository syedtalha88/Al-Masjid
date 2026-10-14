import { describe, expect, it } from 'vitest';

import { releaseVelocity } from '../src/components/Sheet.tsx';

// The Sheet's release velocity must reflect the finger, not event-delivery hiccups (found by CI on Linux WebKit,
// 14 Oct 2026: a 40 px nudge was occasionally read as a dismissing flick).

/** Samples [y, time ms] for a drag of `step` px every `every` ms, `count` times, starting at y=0, t=0. */
const steady = (count: number, step: number, every: number): [number, number][] =>
  Array.from({ length: count }, (_, index): [number, number] => [index * step, index * every]);

describe('releaseVelocity', () => {
  it('a steady slow drag gives its real speed', () => {
    // 5 px every 50 ms = 100 px/s.
    const samples = steady(8, 5, 50);
    expect(releaseVelocity(samples, 40, 400)).toBeCloseTo(100, 0);
  });

  it('a real flick keeps its high speed', () => {
    // 30 px every 16 ms ≈ 1875 px/s over the last 100 ms.
    const samples = steady(8, 30, 16);
    expect(releaseVelocity(samples, 240, 128)).toBeGreaterThan(1500);
  });

  it('moves delivered in a bunch after a stall are not mistaken for a flick', () => {
    // Finger moved 5 px / 50 ms, but the last moves arrived 1 ms apart after a 230 ms main-thread stall.
    const samples: [number, number][] = [
      [0, 0],
      [5, 50],
      [10, 100],
      [15, 150],
      [20, 380],
      [25, 381],
      [30, 382],
      [35, 383],
    ];
    const velocity = releaseVelocity(samples, 40, 384);
    expect(velocity).toBeLessThan(200); // the naive 100 ms window said ≈ 5000 px/s → dismiss
    expect(velocity).toBeGreaterThan(0);
  });

  it('no usable baseline → 0', () => {
    expect(releaseVelocity([], 10, 100)).toBe(0);
    expect(releaseVelocity([[0, 100]], 10, 105)).toBe(0); // under 10 ms
  });
});
