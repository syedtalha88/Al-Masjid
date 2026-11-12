import { readFileSync } from 'node:fs';

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import {
  angleDelta,
  distanceToKaabaKm,
  headingFromOrientation,
  isAligned,
  KAABA,
  normalizeDegrees,
  qiblaBearing,
  smoothHeading,
} from '../src/qibla.ts';

// PHASE_07 T7.1 · 10 §4: bearings for the 7 golden cities against two independent calculators (±0.5°), distances
// (±1 %), the heading from a device-orientation event (iOS compass heading; Android absolute alpha + screen rotation;
// none → null), the shortest signed angle (wrap-around 359° → 0°), smoothing along the short way, alignment ±3°.

interface Case {
  readonly city: string;
  readonly lat: number;
  readonly lng: number;
  readonly aladhan: number;
  readonly geographiclib: number;
  readonly distanceKm: number;
}
const golden = JSON.parse(readFileSync(new URL('./fixtures/qibla-golden.json', import.meta.url), 'utf8')) as {
  cases: Case[];
};

describe('qiblaBearing / distanceToKaabaKm — golden cities', () => {
  it.each(golden.cases.map((entry) => [entry.city, entry] as const))('%s', (_city, entry) => {
    const bearing = qiblaBearing({ lat: entry.lat, lng: entry.lng });
    expect(Math.abs(angleDelta(bearing, entry.aladhan))).toBeLessThanOrEqual(0.5);
    expect(Math.abs(angleDelta(bearing, entry.geographiclib))).toBeLessThanOrEqual(0.5);
    const km = distanceToKaabaKm({ lat: entry.lat, lng: entry.lng });
    expect(Math.abs(km - entry.distanceKm) / entry.distanceKm).toBeLessThanOrEqual(0.01);
  });

  it('every bearing is in [0, 360); at the Kaaba the distance is 0', () => {
    fc.assert(
      fc.property(
        fc.double({ min: -89, max: 89, noNaN: true }),
        fc.double({ min: -180, max: 180, noNaN: true }),
        (lat, lng) => {
          const bearing = qiblaBearing({ lat, lng });
          expect(bearing).toBeGreaterThanOrEqual(0);
          expect(bearing).toBeLessThan(360);
        },
      ),
    );
    expect(distanceToKaabaKm(KAABA)).toBe(0);
    expect(qiblaBearing(KAABA)).toBe(0); // no direction at the Kaaba itself: north by convention
  });

  it('north of Makkah faces south, east of it faces west', () => {
    expect(qiblaBearing({ lat: 40, lng: KAABA.lng })).toBeCloseTo(180, 6);
    expect(qiblaBearing({ lat: KAABA.lat, lng: 50 })).toBeGreaterThan(260);
  });
});

describe('angles', () => {
  it.each([
    [0, 0, 0],
    [359, 1, 2],
    [1, 359, -2],
    [10, 190, 180],
    [190, 10, 180],
    [-30, 30, 60],
    [720, 0, 0],
  ])('angleDelta(%d, %d) = %d', (from, to, delta) => {
    expect(angleDelta(from, to)).toBeCloseTo(delta, 9);
  });

  it('normalizeDegrees wraps into [0, 360)', () => {
    expect(normalizeDegrees(-1)).toBe(359);
    expect(normalizeDegrees(360)).toBe(0);
    expect(normalizeDegrees(725)).toBe(5);
    expect(normalizeDegrees(-0)).toBe(0);
  });

  it('the delta is always in (-180, 180] and adding it reaches the target', () => {
    fc.assert(
      fc.property(
        fc.double({ min: -1000, max: 1000, noNaN: true }),
        fc.double({ min: -1000, max: 1000, noNaN: true }),
        (a, b) => {
          const delta = angleDelta(a, b);
          expect(delta).toBeGreaterThan(-180 - 1e-9);
          expect(delta).toBeLessThanOrEqual(180 + 1e-9);
          expect(Math.abs(angleDelta(normalizeDegrees(a + delta), b))).toBeLessThan(1e-6);
        },
      ),
    );
  });

  it('isAligned within ±3° across north', () => {
    expect(isAligned(358.5, 1)).toBe(true);
    expect(isAligned(283, 287)).toBe(false);
    expect(isAligned(284, 287)).toBe(true);
    expect(isAligned(290, 287, 5)).toBe(true);
  });
});

describe('headingFromOrientation', () => {
  it('iOS: webkitCompassHeading (already clockwise from North), plus the screen rotation', () => {
    expect(headingFromOrientation({ alpha: 10, absolute: false, webkitCompassHeading: 287 }, 0, 'ios')).toBe(287);
    expect(headingFromOrientation({ alpha: 10, absolute: false, webkitCompassHeading: 350 }, 90, 'ios')).toBe(80);
  });

  it('Android: absolute alpha is counter-clockwise → (360 − alpha + screen) % 360', () => {
    expect(headingFromOrientation({ alpha: 73, absolute: true }, 0, 'android')).toBe(287);
    expect(headingFromOrientation({ alpha: 0, absolute: true }, 0, 'android')).toBe(0);
    expect(headingFromOrientation({ alpha: 350, absolute: true }, 90, 'android')).toBe(100);
    expect(headingFromOrientation({ alpha: 10, absolute: true }, 270, 'android')).toBe(260);
  });

  it('no absolute heading → null (the page shows the bearing in degrees instead)', () => {
    expect(headingFromOrientation({ alpha: 73, absolute: false }, 0, 'android')).toBeNull();
    expect(headingFromOrientation({ alpha: null, absolute: true }, 0, 'android')).toBeNull();
    expect(headingFromOrientation({ alpha: 10, absolute: false }, 0, 'ios')).toBeNull();
    expect(headingFromOrientation({ alpha: 10, absolute: false, webkitCompassHeading: -1 }, 0, 'ios')).toBeNull();
    expect(headingFromOrientation({ alpha: 10, absolute: true }, 0, 'other')).toBe(350);
    expect(headingFromOrientation({ alpha: Number.NaN, absolute: true }, 0, 'other')).toBeNull();
  });
});

describe('smoothHeading', () => {
  it('starts at the first reading, then moves a share of the short way — across north too', () => {
    expect(smoothHeading(null, 120, 0.25)).toBe(120);
    expect(smoothHeading(100, 120, 0.25)).toBeCloseTo(105, 9);
    expect(smoothHeading(350, 10, 0.5)).toBeCloseTo(0, 9);
    expect(smoothHeading(10, 350, 0.5)).toBeCloseTo(0, 9);
    expect(smoothHeading(359, 1, 1)).toBeCloseTo(1, 9);
  });

  it('a noisy stream around 287° settles near 287° and never jumps the long way', () => {
    const noise = [3, -2, 4, -3, 1, -4, 2, 0, -1, 3];
    let heading: number | null = null;
    let previous = 287;
    for (let round = 0; round < 5; round += 1) {
      for (const n of noise) {
        heading = smoothHeading(heading, normalizeDegrees(287 + n), 0.2);
        expect(Math.abs(angleDelta(previous, heading))).toBeLessThan(5);
        previous = heading;
      }
    }
    expect(Math.abs(angleDelta(heading ?? 0, 287))).toBeLessThan(3);
  });

  it('refuses a factor outside (0, 1]', () => {
    expect(() => smoothHeading(1, 2, 0)).toThrow(RangeError);
    expect(() => smoothHeading(1, 2, 1.5)).toThrow(RangeError);
  });
});
