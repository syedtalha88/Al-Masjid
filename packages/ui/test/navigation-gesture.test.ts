import { describe, expect, it } from 'vitest';

import { type Sample, swipeRelease } from '../src/navigation/gesture.ts';

// Swipe-back release decision (08 §3.2): commit by velocity or distance; release velocity for the spring.

const WIDTH = 400;

/** Samples every 16 ms (a 60 Hz finger) from `from` to `to` px, starting at t = 0. */
function finger(from: number, to: number, frames: number): Sample[] {
  return Array.from({ length: frames + 1 }, (_, i) => [from + ((to - from) * i) / frames, i * 16] as const);
}

describe('swipeRelease', () => {
  it('a short fast flick commits on velocity alone', () => {
    const samples = finger(20, 100, 4); // 80 px in 64 ms ≈ 1250 px/s, only 20 % of the width
    const result = swipeRelease(samples, [100, 70], 0.2, WIDTH, false);
    expect(result.commit).toBe(true);
    expect(result.progressVelocity).toBeGreaterThan(2);
  });

  it('a slow drag past 35 % commits on distance', () => {
    const samples = finger(20, 180, 40); // 160 px in 640 ms = 250 px/s
    expect(swipeRelease(samples, [180, 650], 0.4, WIDTH, false).commit).toBe(true);
  });

  it('a slow drag under 35 % springs back', () => {
    const samples = finger(20, 100, 40);
    expect(swipeRelease(samples, [100, 650], 0.2, WIDTH, false).commit).toBe(false);
  });

  it('flicking back towards the edge cancels even past the distance threshold', () => {
    const samples = [...finger(20, 300, 30), ...finger(300, 230, 4).map(([x, t]) => [x, t + 500] as const)];
    const result = swipeRelease(samples, [230, 570], 0.55, WIDTH, false);
    expect(result.commit).toBe(false);
    expect(result.progressVelocity).toBeLessThan(0);
  });

  it('holding still before release means no velocity (pointer events stop when the finger stops)', () => {
    const samples = finger(20, 120, 6); // ends at t = 96 ms
    const result = swipeRelease(samples, [120, 400], 0.25, WIDTH, false);
    expect(result.progressVelocity).toBe(0);
    expect(result.commit).toBe(false);
  });

  it('under 10 ms of samples is event noise, not a flick', () => {
    const result = swipeRelease(
      [
        [20, 0],
        [60, 4],
      ],
      [80, 6],
      0.15,
      WIDTH,
      false,
    );
    expect(result).toEqual({ commit: false, progressVelocity: 0 });
  });

  it('pointercancel always springs back with no velocity', () => {
    expect(swipeRelease(finger(20, 300, 4), [300, 70], 0.7, WIDTH, true)).toEqual({
      commit: false,
      progressVelocity: 0,
    });
  });
});
