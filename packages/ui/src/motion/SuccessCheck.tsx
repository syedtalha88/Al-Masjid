import * as m from 'motion/react-m';
import { useEffect } from 'react';

import { useMotionPrefs } from './MotionProvider.tsx';
import { spring, tween } from './tokens.ts';

export interface SuccessCheckProps {
  /** px, default 64. */
  readonly size?: number;
  /** Accessible name, e.g. "Published". */
  readonly title: string;
  /** Called once the animation has finished (immediately with reduced motion). */
  readonly onComplete?: () => void;
}

const CIRCLE = 'M32 4a28 28 0 1 1 0 56 28 28 0 0 1 0-56Z';
const CHECK = 'M20 33l8 8 16-17';

/**
 * Success moment (08 §5.8, §5.12): circle draws (350 ms), then the check (250 ms), the whole icon springs in
 * with `spring.bouncy`. Reduced motion: appears fully drawn, no movement.
 */
export function SuccessCheck({ size = 64, title, onComplete }: SuccessCheckProps) {
  const { reduced } = useMotionPrefs();

  useEffect(() => {
    if (reduced) onComplete?.();
    // Fire once per mount; with full motion the check's onAnimationComplete reports completion.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional mount-only effect
  }, []);

  const shared = {
    viewBox: '0 0 64 64',
    width: size,
    height: size,
    fill: 'none',
    strokeWidth: 4,
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
    className: 'stroke-primary-700',
    role: 'img',
    'aria-label': title,
  } as const;

  if (reduced) {
    return (
      <svg xmlns="http://www.w3.org/2000/svg" {...shared}>
        <path d={CIRCLE} className="fill-mint-50" />
        <path d={CHECK} />
      </svg>
    );
  }

  return (
    <m.svg
      xmlns="http://www.w3.org/2000/svg"
      {...shared}
      initial={{ scale: 0.6, opacity: 0 }}
      animate={{ scale: 1, opacity: 1 }}
      transition={spring.bouncy}
    >
      <m.path
        d={CIRCLE}
        className="fill-mint-50"
        initial={{ pathLength: 0 }}
        animate={{ pathLength: 1 }}
        transition={tween.drawCircle}
      />
      <m.path
        d={CHECK}
        initial={{ pathLength: 0 }}
        animate={{ pathLength: 1 }}
        transition={tween.drawCheck}
        onAnimationComplete={() => onComplete?.()}
      />
    </m.svg>
  );
}
