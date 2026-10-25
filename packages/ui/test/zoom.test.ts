import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import {
  clampPan,
  DOUBLE_TAP_SCALE,
  doubleTap,
  fitInside,
  IDENTITY,
  MAX_SCALE,
  rubberScale,
  settle,
  zoomAround,
} from '../src/components/zoom.ts';

const STAGE = { width: 400, height: 800 };
const CONTENT = { width: 400, height: 250 };

describe('image viewer zoom geometry', () => {
  it('fits the image inside the stage, keeping its ratio', () => {
    expect(fitInside({ width: 1600, height: 1000 }, STAGE)).toEqual({ width: 400, height: 250 });
    expect(fitInside({ width: 500, height: 2000 }, STAGE)).toEqual({ width: 200, height: 800 });
    expect(fitInside({ width: 0, height: 0 }, STAGE)).toEqual(STAGE);
  });

  it('keeps the point under the fingers in place while zooming', () => {
    const focus = { x: 100, y: -50 };
    const zoomed = zoomAround(IDENTITY, 2, focus);
    // The image point that was at `focus` (image coords = focus at scale 1) is still at `focus`.
    expect(zoomed.x + 100 * zoomed.scale).toBe(focus.x);
    expect(zoomed).toEqual({ scale: 2, x: -100, y: 50 });
  });

  it('rubber-bands past the limits and settles back inside', () => {
    expect(rubberScale(0.5)).toBeCloseTo(0.8);
    expect(rubberScale(6)).toBeCloseTo(4.4);
    expect(rubberScale(2)).toBe(2);
    expect(settle({ scale: 0.8, x: 30, y: 30 }, STAGE, CONTENT)).toEqual(IDENTITY);
    expect(settle({ scale: 6, x: 0, y: 0 }, STAGE, CONTENT).scale).toBe(MAX_SCALE);
  });

  it('never lets the image edge come inside the stage edge (property)', () => {
    fc.assert(
      fc.property(
        fc.double({ min: 1, max: 4, noNaN: true }),
        fc.double({ min: -5000, max: 5000, noNaN: true }),
        fc.double({ min: -5000, max: 5000, noNaN: true }),
        (scale, x, y) => {
          const clamped = clampPan({ scale, x, y }, STAGE, CONTENT);
          const halfWidth = (CONTENT.width * scale) / 2;
          expect(clamped.x - halfWidth).toBeLessThanOrEqual(-STAGE.width / 2 + 1e-9);
          expect(clamped.x + halfWidth).toBeGreaterThanOrEqual(STAGE.width / 2 - 1e-9);
          // Shorter than the stage vertically until 3.2× → centred vertically until then.
          if (CONTENT.height * scale <= STAGE.height) expect(Math.abs(clamped.y)).toBe(0);
        },
      ),
    );
  });

  it('double-tap zooms in around the tap, and out again', () => {
    const zoomed = doubleTap(IDENTITY, { x: 50, y: 0 }, STAGE, CONTENT);
    expect(zoomed.scale).toBe(DOUBLE_TAP_SCALE);
    expect(zoomed.x).toBeCloseTo(-75);
    expect(doubleTap(zoomed, { x: 0, y: 0 }, STAGE, CONTENT)).toEqual(IDENTITY);
  });
});
