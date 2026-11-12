// The phone's heading on the Qibla page (07 A14, 08 §5.9, PHASE_07 T7.2): sensor events go into an observable value (never
// React state per event); React only hears about the few state changes — waiting / needs permission / live / no
// compass / denied, and entering or leaving the aligned zone (±3°, one haptic per entry, at most every 1.5 s). The
// listeners are removed when the page is left or hidden.
import { isAligned } from '@mc/domain/qibla';
import { haptic, useReducedMotionPref } from '@mc/ui/motion';
import { useEffect, useRef, useState } from 'react';

import {
  createHeadingValue,
  headingPlatform,
  listenHeading,
  needsMotionPermission,
  SMOOTHING,
} from '../lib/heading.ts';

export type HeadingStatus = 'waiting' | 'needs-permission' | 'live' | 'none' | 'denied';

/** 08 §5.9: one haptic per entry into the aligned zone, at most every 1.5 s. */
const HAPTIC_DEBOUNCE_MS = 1500;

type PermissionCtor = { requestPermission?: () => Promise<string> };

export function useHeading(bearing: number | null) {
  const reduced = useReducedMotionPref();
  const [heading] = useState(() => createHeadingValue(0));
  const platform =
    typeof navigator === 'undefined' ? 'other' : headingPlatform(navigator.userAgent, navigator.maxTouchPoints);
  const needsPermission = typeof window !== 'undefined' && needsMotionPermission(platform, window);
  const [granted, setGranted] = useState(!needsPermission);
  const [status, setStatus] = useState<HeadingStatus>(needsPermission ? 'needs-permission' : 'waiting');
  const [aligned, setAligned] = useState(false);
  const live = useRef(false);
  const alignedRef = useRef(false);
  const lastHaptic = useRef(0);

  useEffect(() => {
    if (!granted || typeof window === 'undefined') return;
    let stop: (() => void) | null = null;
    const start = () => {
      stop?.();
      stop = listenHeading({
        target: window,
        platform,
        screenAngle: () => (typeof screen === 'undefined' ? 0 : screen.orientation.angle),
        factor: reduced ? 1 : SMOOTHING,
        onHeading: (value) => {
          heading.set(value);
          if (!live.current) {
            live.current = true;
            setStatus('live');
          }
        },
        onNoCompass: () => {
          if (!live.current) setStatus('none');
        },
      });
    };
    const onVisibility = () => {
      if (document.hidden) {
        stop?.();
        stop = null;
      } else {
        start();
      }
    };
    start();
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      stop?.();
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [granted, reduced, heading, platform]);

  // Entering / leaving the aligned zone — the only per-reading work that reaches React.
  useEffect(() => {
    if (bearing === null) return;
    return heading.on('change', (value) => {
      const now = live.current && isAligned(value, bearing);
      if (now === alignedRef.current) return;
      alignedRef.current = now;
      setAligned(now);
      if (now && Date.now() - lastHaptic.current > HAPTIC_DEBOUNCE_MS) {
        lastHaptic.current = Date.now();
        haptic('qibla');
      }
    });
  }, [heading, bearing]);

  /** iOS: ask for the motion sensors from the tap (DeviceOrientationEvent.requestPermission). */
  const enable = async () => {
    const ctor = (window as unknown as { DeviceOrientationEvent?: PermissionCtor }).DeviceOrientationEvent; // iOS API
    try {
      const answer = (await ctor?.requestPermission?.()) ?? 'granted';
      if (answer === 'granted') {
        setStatus('waiting');
        setGranted(true);
      } else {
        setStatus('denied');
      }
    } catch {
      setStatus('denied');
    }
  };

  return { heading, status, aligned, enable };
}
