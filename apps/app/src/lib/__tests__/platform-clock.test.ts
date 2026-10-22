import { afterEach, describe, expect, it } from 'vitest';

import { now, recordServerTime, resetServerTime } from '../clock.ts';
import { isStandalone, platformKind } from '../platform.ts';

afterEach(() => {
  resetServerTime();
});

describe('platformKind (only the coarse kind is ever stored — 02 §2)', () => {
  it('detects Android, iOS (incl. iPadOS), desktop and others', () => {
    const nav = (userAgent: string, maxTouchPoints = 0) => ({ userAgent, maxTouchPoints });
    expect(platformKind(nav('Mozilla/5.0 (Linux; Android 14; Pixel 7)', 5))).toBe('android');
    expect(platformKind(nav('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)', 5))).toBe('ios');
    expect(platformKind(nav('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', 5))).toBe('ios');
    expect(platformKind(nav('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)'))).toBe('desktop');
    expect(platformKind(nav('Mozilla/5.0 (Windows NT 10.0; Win64; x64)'))).toBe('desktop');
    expect(platformKind(nav('SomeTV/1.0'))).toBe('other');
    expect(platformKind(undefined)).toBe('other');
  });

  it('detects the installed app', () => {
    const matchMedia = (matches: boolean) => () => ({ matches });
    expect(isStandalone({ matchMedia: matchMedia(true) })).toBe(true);
    expect(
      isStandalone({
        matchMedia: matchMedia(false),
        navigator: { userAgent: '', maxTouchPoints: 0, standalone: true },
      }),
    ).toBe(true);
    expect(isStandalone({ matchMedia: matchMedia(false) })).toBe(false);
    expect(isStandalone(undefined)).toBe(false);
  });
});

describe('server-corrected clock (00 §7)', () => {
  it('applies only a drift above 2 minutes', () => {
    recordServerTime(60_000);
    expect(Math.abs(now().getTime() - Date.now())).toBeLessThan(1000);
    recordServerTime(10 * 60_000);
    expect(now().getTime() - Date.now()).toBeGreaterThan(9 * 60_000);
    recordServerTime(null); // unusable measurements keep the last one
    expect(now().getTime() - Date.now()).toBeGreaterThan(9 * 60_000);
  });
});
