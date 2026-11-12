import { animate, motionValue } from 'motion/react';
import { type CSSProperties, useEffect, useRef, useState } from 'react';

import { useMotionPrefs } from '../motion/MotionProvider.tsx';
import { spring } from '../motion/tokens.ts';

export interface ProgressBarProps {
  /** Progress as a fraction 0–1 (clamped). */
  readonly value: number;
  /** Accessible name, e.g. "Raised so far". */
  readonly label: string;
  /** Spoken value, e.g. "72%" (defaults to the rounded percentage). */
  readonly valueText?: string;
  /**
   * Inside a button or link whose text already says the amount (a campaign card): no progressbar role, hidden from
   * assistive technology (a button's children are presentational).
   */
  readonly decorative?: boolean;
  readonly className?: string;
}

const clamp01 = (value: number) => (Number.isFinite(value) ? Math.min(Math.max(value, 0), 1) : 0);

/**
 * Progress bar (06 §6, 08 §5.7): 12 px, full radius, surface-muted track, primary-500 fill. The fill grows
 * from 0 the first time the bar scrolls into view, then from the old to the new value on updates
 * (`spring.gentle`, transform only); reduced motion shows the value directly. Mirrored in RTL.
 */
export function ProgressBar({ value, label, valueText, decorative = false, className }: ProgressBarProps) {
  const { reduced } = useMotionPrefs();
  const target = clamp01(value);
  const percent = Math.round(target * 100);
  const track = useRef<HTMLSpanElement>(null);
  const fill = useRef<HTMLSpanElement>(null);
  const [progress] = useState(() => motionValue(reduced ? target : 0));
  const [seen, setSeen] = useState(reduced);
  // Captured once: afterwards only the motion value writes `--mc-progress` (a re-render must not reset it).
  const [fillStyle] = useState<CSSProperties & { '--mc-progress': string }>(() => ({
    '--mc-progress': String(reduced ? target : 0),
  }));

  // Render the motion value straight to the fill (no React renders while it moves).
  useEffect(
    () =>
      progress.on('change', (current) => {
        fill.current?.style.setProperty('--mc-progress', String(current));
      }),
    [progress],
  );

  // Start when the bar first becomes visible (08 §5.7); without IntersectionObserver start right away.
  useEffect(() => {
    if (seen) return;
    const node = track.current;
    if (!node || typeof IntersectionObserver === 'undefined') {
      setSeen(true);
      return;
    }
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        setSeen(true);
        observer.disconnect();
      }
    });
    observer.observe(node);
    return () => {
      observer.disconnect();
    };
  }, [seen]);

  useEffect(() => {
    if (!seen) return;
    if (reduced) {
      progress.jump(target);
      return;
    }
    const controls = animate(progress, target, spring.gentle);
    return () => {
      controls.stop();
    };
  }, [seen, reduced, target, progress]);

  const a11y = decorative
    ? { 'aria-hidden': true }
    : {
        role: 'progressbar',
        'aria-label': label,
        'aria-valuemin': 0,
        'aria-valuemax': 100,
        'aria-valuenow': percent,
        'aria-valuetext': valueText ?? `${String(percent)}%`,
      };
  // Spans (display block): valid inside a button as well.
  return (
    <span
      ref={track}
      {...a11y}
      className={`block h-3 w-full overflow-hidden rounded-full bg-surface-muted ${className ?? ''}`}
    >
      {/* The fill slides in from the leading edge: translateX((p − 1) · 100%), mirrored in RTL. */}
      <span
        ref={fill}
        className="block h-full w-full rounded-full bg-primary-500 [transform:translateX(calc((var(--mc-progress)-1)*100%))] rtl:[transform:translateX(calc((1-var(--mc-progress))*100%))]"
        style={fillStyle}
      />
    </span>
  );
}
