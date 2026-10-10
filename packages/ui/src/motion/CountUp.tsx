import { animate } from 'motion/react';
import { useEffect, useRef } from 'react';

import { useMotionPrefs } from './MotionProvider.tsx';
import { tween } from './tokens.ts';

export interface CountUpProps {
  /** Target value (integer, e.g. paise). */
  readonly value: number;
  /** Formats an integer for display at every frame (e.g. `format.money`), so grouping is always correct. */
  readonly format: (value: number) => string;
  /** Start of the first count (default 0); later counts start from the previous value. */
  readonly from?: number;
  readonly className?: string;
}

/**
 * Amount count-up (08 §5.7): 700 ms ease-out, tabular digits, formatted on every frame. Frames write the
 * text node directly (no React render per frame). Reduced motion shows the final value. Screen readers get
 * the final value only.
 */
export function CountUp({ value, format, from = 0, className }: CountUpProps) {
  const { reduced } = useMotionPrefs();
  const textRef = useRef<HTMLSpanElement>(null);
  const previous = useRef(from);

  useEffect(() => {
    const element = textRef.current;
    if (!element) return;
    const start = previous.current;
    previous.current = value;
    if (reduced || start === value) {
      element.textContent = format(value);
      return;
    }
    const controls = animate(start, value, {
      ...tween.countUp,
      onUpdate: (latest) => {
        element.textContent = format(Math.round(latest));
      },
    });
    return () => {
      controls.stop();
    };
  }, [value, format, reduced]);

  return (
    <span className={`tabular-nums ${className ?? ''}`}>
      <span className="sr-only">{format(value)}</span>
      <span ref={textRef} aria-hidden>
        {format(reduced ? value : from)}
      </span>
    </span>
  );
}
