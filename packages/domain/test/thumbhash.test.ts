import { describe, expect, it } from 'vitest';

import {
  rgbaToThumbHash,
  thumbHashFromBase64,
  thumbHashToApproximateAspectRatio,
  thumbHashToAverageRgba,
  thumbHashToRgba,
} from '../src/thumbhash.ts';

// Vendored ThumbHash (DECISIONS #45). Verified byte-identical to thumbhash@0.1.1 on 200 random images when
// vendored; these tests pin the behaviour we rely on.

/** A w×h image filled by `pixel(x, y)`. */
function image(w: number, h: number, pixel: (x: number, y: number) => [number, number, number, number]) {
  const rgba = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) rgba.set(pixel(x, y), (y * w + x) * 4);
  }
  return rgba;
}

describe('thumbhash', () => {
  it('a flat color round-trips to (almost) that color, opaque', () => {
    const hash = rgbaToThumbHash(
      40,
      30,
      image(40, 30, () => [19, 84, 60, 255]),
    );
    expect(hash.length).toBeGreaterThanOrEqual(5);
    expect(hash.length).toBeLessThanOrEqual(25);
    const average = thumbHashToAverageRgba(hash);
    expect(average.r * 255).toBeCloseTo(19, -1);
    expect(average.g * 255).toBeCloseTo(84, -1);
    expect(average.b * 255).toBeCloseTo(60, -1);
    expect(average.a).toBe(1);
    const decoded = thumbHashToRgba(hash);
    expect(decoded.rgba.length).toBe(decoded.w * decoded.h * 4);
    expect(Math.abs((decoded.rgba[0] ?? 0) - 19)).toBeLessThan(12);
  });

  it('keeps the aspect ratio roughly (landscape 16:10, portrait 3:4)', () => {
    const landscape = rgbaToThumbHash(
      64,
      40,
      image(64, 40, (x) => [x * 4, 100, 50, 255]),
    );
    expect(thumbHashToApproximateAspectRatio(landscape)).toBeGreaterThan(1.3);
    const decoded = thumbHashToRgba(landscape);
    expect(decoded.w).toBe(32);
    expect(decoded.h).toBeLessThan(32);
    const portrait = rgbaToThumbHash(
      30,
      40,
      image(30, 40, (_x, y) => [50, y * 6, 100, 255]),
    );
    expect(thumbHashToApproximateAspectRatio(portrait)).toBeLessThan(1);
    expect(thumbHashToRgba(portrait).h).toBe(32);
  });

  it('encodes transparency', () => {
    const hash = rgbaToThumbHash(
      20,
      20,
      image(20, 20, (x) => [200, 0, 0, x < 10 ? 0 : 255]),
    );
    const average = thumbHashToAverageRgba(hash);
    expect(average.a).toBeLessThan(0.75);
    expect(average.a).toBeGreaterThan(0.25);
  });

  it('decodes a horizontal gradient left-dark, right-light', () => {
    const hash = rgbaToThumbHash(
      50,
      50,
      image(50, 50, (x) => [x * 5, x * 5, x * 5, 255]),
    );
    const { w, rgba } = thumbHashToRgba(hash);
    const left = rgba[0] ?? 0;
    const right = rgba[(w - 1) * 4] ?? 0;
    expect(right - left).toBeGreaterThan(100);
  });

  it('rejects oversize images, wrong buffers and short hashes; reads base64', () => {
    expect(() => rgbaToThumbHash(101, 10, new Uint8Array(101 * 10 * 4))).toThrow(/100x100/);
    expect(() => rgbaToThumbHash(10, 10, new Uint8Array(3))).toThrow(/w\*h\*4/);
    expect(() => thumbHashToRgba([1, 2, 3])).toThrow(/too short/);
    const hash = rgbaToThumbHash(
      10,
      10,
      image(10, 10, () => [10, 20, 30, 255]),
    );
    const base64 = btoa(String.fromCharCode(...hash));
    expect(thumbHashFromBase64(base64)).toEqual(hash);
  });
});
