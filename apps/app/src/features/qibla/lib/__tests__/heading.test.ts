import { angleDelta } from '@mc/domain/qibla';
import { describe, expect, it, vi } from 'vitest';

import { headingPlatform, listenHeading, needsMotionPermission, NO_COMPASS_MS } from '../heading.ts';

// PHASE_07 T7.2 · 08 §5.9: a synthetic event stream → smoothed heading (wrap-around, noise), "no compass" after 2 s
// without an absolute reading, listeners removed on stop.

function orientation(type: string, fields: Record<string, unknown>): Event {
  const event = new Event(type);
  Object.assign(event, fields);
  return event;
}

function setup(platform: 'ios' | 'android' | 'other', factor = 1, angle = 0) {
  const target = new EventTarget();
  const headings: number[] = [];
  const noCompass = vi.fn();
  let pending: (() => void) | undefined;
  const timers = {
    setTimeout: (callback: () => void) => {
      pending = callback;
      return 1;
    },
    clearTimeout: () => {
      pending = undefined;
    },
  };
  const stop = listenHeading({
    target,
    platform,
    screenAngle: () => angle,
    factor,
    onHeading: (heading) => headings.push(heading),
    onNoCompass: noCompass,
    timers,
  });
  return { target, headings, noCompass, stop, fire: () => pending?.() };
}

describe('listenHeading', () => {
  it('Android: absolute alpha → heading; relative events are ignored', () => {
    const { target, headings } = setup('android');
    target.dispatchEvent(orientation('deviceorientation', { alpha: 10, absolute: false }));
    target.dispatchEvent(orientation('deviceorientationabsolute', { alpha: 73 }));
    target.dispatchEvent(orientation('deviceorientation', { alpha: 70, absolute: true }));
    expect(headings).toEqual([287, 290]);
  });

  it('iOS: webkitCompassHeading, with the screen rotation', () => {
    const { target, headings } = setup('ios', 1, 90);
    target.dispatchEvent(orientation('deviceorientation', { alpha: 1, webkitCompassHeading: 200 }));
    expect(headings).toEqual([290]);
  });

  it('smooths across North without swinging the long way', () => {
    const { target, headings } = setup('android', 0.5);
    for (const alpha of [5, 355, 5, 355]) target.dispatchEvent(orientation('deviceorientationabsolute', { alpha }));
    // readings 355°, 5°, 355°, 5° — every smoothed value stays within 10° of North
    for (const heading of headings) expect(Math.abs(angleDelta(heading, 0))).toBeLessThanOrEqual(5);
  });

  it('noise around a heading settles near it', () => {
    const { target, headings } = setup('android', 0.15);
    const noise = [2, -3, 4, -1, 0, 3, -4, 1, -2, 2];
    for (let round = 0; round < 6; round += 1) {
      for (const n of noise) target.dispatchEvent(orientation('deviceorientationabsolute', { alpha: 73 + n }));
    }
    expect(Math.abs(angleDelta(headings.at(-1) ?? 0, 287))).toBeLessThan(2);
  });

  it('no reading within 2 s → "no compass" once; a reading first cancels it', () => {
    const silent = setup('android');
    silent.fire();
    expect(silent.noCompass).toHaveBeenCalledOnce();
    const live = setup('android');
    live.target.dispatchEvent(orientation('deviceorientationabsolute', { alpha: 73 }));
    live.fire();
    expect(live.noCompass).not.toHaveBeenCalled();
    expect(NO_COMPASS_MS).toBe(2000);
  });

  it('stop removes the listeners', () => {
    const { target, headings, stop } = setup('android');
    stop();
    target.dispatchEvent(orientation('deviceorientationabsolute', { alpha: 73 }));
    expect(headings).toEqual([]);
  });
});

describe('platform', () => {
  it('iOS needs a permission tap; Android and desktop do not', () => {
    const ios = { DeviceOrientationEvent: { requestPermission: () => Promise.resolve('granted') } };
    expect(needsMotionPermission(ios)).toBe(true);
    expect(needsMotionPermission({ DeviceOrientationEvent: {} })).toBe(false);
    expect(needsMotionPermission({})).toBe(false);
    expect(headingPlatform('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0)', {})).toBe('ios');
    expect(headingPlatform('Mozilla/5.0 (Linux; Android 15; Pixel 7)', {})).toBe('android');
    expect(headingPlatform('Mozilla/5.0 (X11; Linux x86_64)', {})).toBe('other');
    expect(headingPlatform('anything', ios)).toBe('ios');
  });
});
