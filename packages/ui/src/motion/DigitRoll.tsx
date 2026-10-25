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

/** A number: digits, with separators only between digits ("5:15", "1,234", "30"). */
const NUMBER = /\d(?:[\d:.,٫٬]*\d)?/gu;

/** The text split into numbers (which roll) and the words between them (which never do). */
function parts(text: string): { readonly digits: boolean; readonly value: string }[] {
  const result: { digits: boolean; value: string }[] = [];
  let last = 0;
  for (const match of text.matchAll(NUMBER)) {
    if (match.index > last) result.push({ digits: false, value: text.slice(last, match.index) });
    result.push({ digits: true, value: match[0] });
    last = match.index + match[0].length;
  }
  if (last < text.length) result.push({ digits: false, value: text.slice(last) });
  return result;
}

/** Old character leaves upwards, new one arrives from below (08 §5.5). */
const ROLL: Presence = {
  initial: { y: '100%' },
  animate: { y: '0%' },
  exit: { y: '-100%' },
  transition: spring.snappy,
};

/**
 * Rolling digits for countdowns, dates and amounts (08 §5.5). Only changed digits move; the first render does not
 * animate. Reduced motion: changed digits crossfade. Screen readers read the whole text once.
 *
 * Words stay plain text and each number is one left-to-right group: a box per letter would stop Urdu letters from
 * joining, and digit boxes in a right-to-left line would read "30" as "03" (visual baseline, T2.14).
 */
export function DigitRoll({ text, className }: DigitRollProps) {
  const { reduced } = useMotionPrefs();
  const presence = motionOrFade(reduced, ROLL);
  return (
    <span className={`tabular-nums ${className ?? ''}`}>
      <span className="sr-only">{text}</span>
      <span aria-hidden>
        {parts(text).map((part, partIndex) =>
          part.digits ? (
            // Slots are positional: a slot keeps its place and only its character changes.
            <span key={partIndex} data-digits="" dir="ltr" className="inline-flex">
              {characters(part.value).map((char, index) => (
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
          ) : (
            <span key={partIndex} data-text="" className="whitespace-pre">
              {part.value}
            </span>
          ),
        )}
      </span>
    </span>
  );
}
