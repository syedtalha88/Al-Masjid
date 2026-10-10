import { useLocale, useTranslation } from '@mc/i18n/react';
import { type KeyboardEvent, type PointerEvent, useId } from 'react';

import { BackspaceIcon } from '../icons/glyphs.tsx';
import { haptic } from '../motion/haptics.ts';
import { Pressable } from '../motion/Pressable.tsx';

/** Largest amount accepted anywhere (CLAUDE.md §6 Money: ≤ 10^12 paise). */
export const MAX_PAISE = 1_000_000_000_000;

export interface NumberPadProps {
  /** Amount in integer paise (whole rupees are typed; paise stay 0). */
  readonly value: number;
  readonly onChange: (paise: number) => void;
  /** Accessible name of the amount ("Target amount"). */
  readonly label: string;
  /** Highest amount in paise (default 10^12). */
  readonly max?: number;
  readonly className?: string;
}

type Key = '1' | '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9' | '00' | '0' | 'back';
const KEYS: readonly Key[] = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '00', '0', 'back'];

/**
 * Next amount (paise) after a key: digits append to the rupees, ⌫ removes the last digit; anything that
 * would exceed `max` is ignored.
 *
 * @returns the new amount, or the old one when the key is rejected.
 */
export function applyPadKey(paise: number, key: Key, max: number = MAX_PAISE): number {
  const rupees = Math.floor(paise / 100);
  if (key === 'back') return Math.floor(rupees / 10) * 100;
  const next = Number(`${String(rupees)}${key}`) * 100;
  return Number.isSafeInteger(next) && next <= max ? next : paise;
}

/** Restarts the key's CSS ripple (the `ripple` utility animates while `data-ripple` is present). */
function ripple(event: PointerEvent<HTMLButtonElement>) {
  const node = event.currentTarget;
  node.removeAttribute('data-ripple');
  node.getBoundingClientRect();
  node.setAttribute('data-ripple', '');
}

/**
 * Amount entry for admins (06 §6, 08 §5.12): the amount shown live as ₹ with Indian grouping and Latin
 * digits, 3×4 big keys (64 px+), ⌫. Keys press-scale and ripple; with a key focused, a physical keyboard types
 * digits and Backspace too. The amount is announced politely as it changes.
 */
export function NumberPad({ value, onChange, label, max = MAX_PAISE, className }: NumberPadProps) {
  const { t } = useTranslation();
  const { format } = useLocale();
  const id = useId();

  const press = (key: Key) => {
    const next = applyPadKey(value, key, max);
    if (next === value) {
      haptic('warning');
      return;
    }
    haptic('selection');
    onChange(next);
  };

  const onKeyDown = (event: KeyboardEvent) => {
    if (/^\d$/.test(event.key)) {
      event.preventDefault();
      press(event.key as Key); // validated by the pattern above (boundary)
    } else if (event.key === 'Backspace') {
      event.preventDefault();
      press('back');
    }
  };

  return (
    <div role="group" aria-labelledby={id} className={`flex flex-col gap-4 ${className ?? ''}`}>
      <p id={id} className="sr-only">
        {label}
      </p>
      <output
        aria-live="polite"
        aria-label={label}
        className="block text-center type-large-title text-text tabular-nums"
      >
        <bdi>{format.money(value)}</bdi>
      </output>
      <div className="grid grid-cols-3 gap-3" dir="ltr">
        {KEYS.map((key) => (
          <Pressable
            key={key}
            aria-label={key === 'back' ? t('ui.deleteDigit') : undefined}
            onPointerDown={ripple}
            onKeyDown={onKeyDown}
            onPress={() => {
              press(key);
            }}
            className="ripple inline-flex min-h-16 items-center justify-center rounded-md bg-surface-muted type-title1 text-text tabular-nums data-[pressed]:bg-mint-100"
          >
            {key === 'back' ? <BackspaceIcon size={28} /> : key}
          </Pressable>
        ))}
      </div>
    </div>
  );
}
