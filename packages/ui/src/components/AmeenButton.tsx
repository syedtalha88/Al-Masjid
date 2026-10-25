import { type PointerEvent, useEffect, useRef } from 'react';

import { CheckIcon } from '../icons/glyph/CheckIcon.tsx';
import { HandsPrayingIcon } from '../icons/glyph/HandsPrayingIcon.tsx';
import { DigitRoll } from '../motion/DigitRoll.tsx';
import { celebratePop, type Effect } from '../motion/effects.ts';
import { haptic } from '../motion/haptics.ts';
import { useMotionPrefs } from '../motion/MotionProvider.tsx';
import { Pressable } from '../motion/Pressable.tsx';

export interface AmeenButtonProps {
  /** This device already said Ameen: filled "Ameen ✓", pressing again does nothing (00 §4.3 once per device). */
  readonly said: boolean;
  readonly onSay: () => void;
  /** "Ameen". */
  readonly label: string;
  /** Accessible name of the filled state ("You said Ameen"). */
  readonly saidLabel: string;
  /** "1,204 said Ameen" — rolls when it changes; omitted while unknown. */
  readonly count?: string | undefined;
  /** `lg` on the dua detail screen (07 A9). */
  readonly size?: 'md' | 'lg';
  readonly className?: string;
}

/**
 * Ameen (07 A9, 08 §5.6): a secondary pill with the raised-hands icon. A tap pops the pill (0.92 → 1.06 → 1, bouncy),
 * lifts the icon, ripples mint from the tap point, buzzes 15 ms (Android) and turns the pill into the filled
 * "Ameen ✓" state; the count beside it rolls up. Reduced motion: no pop and no ripple — the state changes in place.
 */
export function AmeenButton({ said, onSay, label, saidLabel, count, size = 'md', className }: AmeenButtonProps) {
  const { reduced } = useMotionPrefs();
  const button = useRef<HTMLButtonElement>(null);
  const body = useRef<HTMLSpanElement>(null);
  const icon = useRef<HTMLSpanElement>(null);
  const effect = useRef<Effect | null>(null);
  useEffect(
    () => () => {
      effect.current?.stop();
    },
    [],
  );

  // The ripple starts where the finger touched (pointer coordinates are physical, like the box measured here).
  const placeRipple = (event: PointerEvent<HTMLButtonElement>) => {
    const node = event.currentTarget;
    const box = node.getBoundingClientRect();
    node.style.setProperty('--mc-ripple-x', `${String(event.clientX - box.left)}px`);
    node.style.setProperty('--mc-ripple-y', `${String(event.clientY - box.top)}px`);
  };

  const height = size === 'lg' ? 'min-h-(--mc-control-lg) px-6 type-headline' : 'min-h-11 px-4 type-subhead-strong';
  return (
    <span className={`inline-flex items-center gap-3 ${className ?? ''}`}>
      <Pressable
        ref={button}
        aria-pressed={said}
        aria-label={said ? saidLabel : undefined}
        onPointerDown={placeRipple}
        onPress={() => {
          if (said) return;
          const node = button.current;
          if (!reduced && node && body.current) {
            node.removeAttribute('data-ripple');
            node.getBoundingClientRect();
            node.setAttribute('data-ripple', '');
            effect.current?.stop();
            effect.current = celebratePop(body.current, icon.current ?? undefined);
          }
          haptic('ameen');
          onSay();
        }}
        className={`ripple inline-flex items-center rounded-full transition-state ${height} ${
          said ? 'bg-primary-700 text-on-primary' : 'bg-mint-100 text-primary-800 data-[pressed]:bg-mint-200'
        }`}
      >
        <span ref={body} className="inline-flex items-center gap-2">
          <span ref={icon} aria-hidden className="inline-flex">
            <HandsPrayingIcon size={size === 'lg' ? 24 : 20} />
          </span>
          {label}
          {said ? <CheckIcon size={size === 'lg' ? 20 : 16} /> : null}
        </span>
      </Pressable>
      {count === undefined ? null : (
        <span className="type-footnote text-text-secondary" aria-live="polite">
          <DigitRoll text={count} />
        </span>
      )}
    </span>
  );
}
