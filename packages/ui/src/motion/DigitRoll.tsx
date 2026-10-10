import { AnimatePresence } from 'motion/react';
import * as m from 'motion/react-m';

import { useMotionPrefs } from './MotionProvider.tsx';
import { motionOrFade, type Presence } from './presence.ts';
import { spring } from './tokens.ts';

export interface DigitRollProps {
  /** Already-formatted text, e.g. "2h 18m left" or "5:15". Each changed character rolls. */
  readonly text: string;
  readonly className?: string;
}

const graphemes = new Intl.Segmenter(undefined, { granularity: 'grapheme' });

/** User-perceived characters (a combining mark stays with its letter). */
const characters = (text: string): string[] => Array.from(graphemes.segment(text), (part) => part.segment);

/** Old character leaves upwards, new one arrives from below (08 §5.5). */
const ROLL: Presence = {
  initial: { y: '100%' },
  animate: { y: '0%' },
  exit: { y: '-100%' },
  transition: spring.snappy,
};

/**
 * Rolling digits for countdowns, dates and amounts (08 §5.5). Only changed characters move; the first render
 * does not animate. Reduced motion: changed characters crossfade. Screen readers read the whole text once.
 */
export function DigitRoll({ text, className }: DigitRollProps) {
  const { reduced } = useMotionPrefs();
  const presence = motionOrFade(reduced, ROLL);
  return (
    <span className={`tabular-nums ${className ?? ''}`}>
      <span className="sr-only">{text}</span>
      <span aria-hidden className="inline-flex">
        {characters(text).map((char, index) => (
          // Slots are positional: a slot keeps its place and only its character changes.
          <span key={index} className="inline-grid overflow-hidden">
            <AnimatePresence initial={false}>
              <m.span
                key={char}
                className="col-start-1 row-start-1 whitespace-pre"
                initial={presence.initial}
                animate={presence.animate}
                exit={presence.exit}
                transition={presence.transition}
              >
                {char}
              </m.span>
            </AnimatePresence>
          </span>
        ))}
      </span>
    </span>
  );
}
