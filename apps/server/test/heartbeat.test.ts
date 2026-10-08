import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  HEARTBEAT_INTERVAL_MS,
  HEARTBEAT_TTL_SECONDS,
  startHeartbeat,
  WORKER_HEARTBEAT_KEY,
} from '../src/heartbeat.ts';

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('worker heartbeat', () => {
  it('writes immediately, then every interval, with a TTL longer than the interval', () => {
    const set = vi.fn(() => Promise.resolve('OK'));
    const stop = startHeartbeat(
      { set },
      () => undefined,
      () => new Date('2026-10-09T00:00:00Z'),
    );
    expect(set).toHaveBeenCalledWith(WORKER_HEARTBEAT_KEY, '2026-10-09T00:00:00.000Z', 'EX', HEARTBEAT_TTL_SECONDS);
    vi.advanceTimersByTime(HEARTBEAT_INTERVAL_MS * 2);
    expect(set).toHaveBeenCalledTimes(3);
    stop();
    vi.advanceTimersByTime(HEARTBEAT_INTERVAL_MS * 5);
    expect(set).toHaveBeenCalledTimes(3);
    expect(HEARTBEAT_TTL_SECONDS * 1000).toBeGreaterThan(HEARTBEAT_INTERVAL_MS * 2);
  });

  it('keeps the key inside the worker Redis ACL prefix (bull:*)', () => {
    expect(WORKER_HEARTBEAT_KEY.startsWith('bull:')).toBe(true);
  });

  it('reports write failures without throwing', async () => {
    const onError = vi.fn();
    const stop = startHeartbeat({ set: () => Promise.reject(new Error('NOPERM')) }, onError);
    await vi.runOnlyPendingTimersAsync();
    expect(onError).toHaveBeenCalled();
    stop();
  });
});
