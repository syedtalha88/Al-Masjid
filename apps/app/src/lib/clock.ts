// "Now" for countdowns and the Hijri/Gregorian date (00 §7, 08 §5.5): the device clock, corrected by the server's
// `Date` header when the drift exceeds 2 minutes, re-rendering on minute boundaries and at midnight in India — never
// every second (08 §5.5: once per minute).
import { correctedNow, msUntilNextMinute } from '@mc/domain/time';
import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';

let offsetMs: number | null = null;
const listeners = new Set<() => void>();

/** Records a measured server-clock offset (from the API client); keeps the latest usable one. */
export function recordServerTime(offset: number | null): void {
  if (offset === null || offset === offsetMs) return;
  offsetMs = offset;
  for (const listener of listeners) listener();
}

/** The corrected current instant. */
export const now = (): Date => correctedNow(Date.now(), offsetMs);

/** Test helper: forget the measured offset. */
export function resetServerTime(): void {
  offsetMs = null;
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

/**
 * The corrected instant, refreshed at every minute boundary (which includes midnight) and when the measured server
 * offset changes. Paused while the page is hidden; refreshed when it becomes visible.
 */
export function useNow(): Date {
  const offset = useSyncExternalStore(
    subscribe,
    () => offsetMs,
    () => null,
  );
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const schedule = () => {
      clearTimeout(timer);
      timer = setTimeout(
        () => {
          setTick((value) => value + 1);
          schedule();
        },
        msUntilNextMinute(now()) + 5,
      );
    };
    const onVisibility = () => {
      if (document.visibilityState === 'visible') {
        setTick((value) => value + 1);
        schedule();
      } else clearTimeout(timer);
    };
    schedule();
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, []);
  // One Date per tick / offset: callers memoise on it (`useMemo(…, [now])`), and a new Date on every render made each
  // navigation re-render recompute prayer times (≈ 20 ms at 4× CPU, T2.14 trace). Read fresh when either changes.
  // eslint-disable-next-line react-hooks/exhaustive-deps -- tick and offset are the triggers; `now()` reads the clock
  return useMemo(() => now(), [tick, offset]);
}
