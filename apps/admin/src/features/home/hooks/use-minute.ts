// "Now", refreshed at each minute boundary (and when the page becomes visible) — the today strip's clock. One Date per
// tick, so memos keyed on it recompute once a minute, never on every render (F46 lesson, DECISIONS #105).
import { msUntilNextMinute } from '@mc/domain/time';
import { useEffect, useState } from 'react';

export function useMinute(): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const schedule = () => {
      clearTimeout(timer);
      timer = setTimeout(
        () => {
          setNow(new Date());
          schedule();
        },
        msUntilNextMinute(new Date()) + 5,
      );
    };
    const onVisibility = () => {
      if (document.visibilityState === 'visible') {
        setNow(new Date());
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
  return now;
}
