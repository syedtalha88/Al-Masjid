import { type ReactNode, useId } from 'react';

import { CheckIcon } from '../icons/glyphs.tsx';
import { haptic } from '../motion/haptics.ts';

export interface SwitchProps {
  readonly checked: boolean;
  readonly onChange: (checked: boolean) => void;
  /** Visible label (the whole row toggles). */
  readonly label: string;
  /** Secondary line under the label ("6 of 8 left today"). */
  readonly description?: ReactNode;
  readonly disabled?: boolean;
  readonly className?: string;
}

/**
 * iOS-style switch row (06 §6): label (+ description) at the start, 51×31 track at the end — primary-700
 * when on; the thumb slides on the compositor. `role="switch"`; the label toggles it too. Haptic selection
 * tick on Android (08 §7).
 */
export function Switch({ checked, onChange, label, description, disabled = false, className }: SwitchProps) {
  const id = useId();
  const toggle = () => {
    if (disabled) return;
    haptic('selection');
    onChange(!checked);
  };
  return (
    <div className={`flex min-h-(--mc-hit) items-center gap-4 ${disabled ? 'opacity-40' : ''} ${className ?? ''}`}>
      <div className="flex min-w-0 flex-1 flex-col gap-0.5 py-2">
        <label htmlFor={id} className="type-body text-text">
          {label}
        </label>
        {description ? (
          <span id={`${id}-description`} className="type-footnote text-text-secondary">
            {description}
          </span>
        ) : null}
      </div>
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        aria-describedby={description ? `${id}-description` : undefined}
        disabled={disabled}
        onClick={toggle}
        className={`relative inline-flex h-[31px] w-[51px] shrink-0 items-center rounded-full p-0.5 transition-state ${
          checked ? 'bg-primary-700' : 'bg-text-tertiary/80'
        }`}
      >
        <span
          aria-hidden
          className={`size-[27px] rounded-full bg-surface shadow-e1 transition-indicator ${
            // `transform` (not Tailwind's `translate` property) so `transition-indicator` animates it.
            checked ? '[transform:translateX(20px)] rtl:[transform:translateX(-20px)]' : '[transform:translateX(0)]'
          }`}
        />
      </button>
    </div>
  );
}

export interface CheckboxProps {
  readonly checked: boolean;
  readonly onChange: (checked: boolean) => void;
  readonly label: ReactNode;
  readonly description?: ReactNode;
  readonly disabled?: boolean;
  /** Marks the box invalid (consent checkboxes); pair with an error message near the form. */
  readonly invalid?: boolean;
  readonly className?: string;
}

/**
 * Checkbox row (06 §6): a native checkbox (keyboard, forms, screen readers) drawn as a 24 px rounded box —
 * filled primary-700 with a white check when on. The whole row is the label.
 */
export function Checkbox({
  checked,
  onChange,
  label,
  description,
  disabled = false,
  invalid = false,
  className,
}: CheckboxProps) {
  const id = useId();
  return (
    <label
      className={`flex min-h-(--mc-hit) items-start gap-3 py-2.5 ${disabled ? 'opacity-40' : ''} ${className ?? ''}`}
    >
      <span className="relative mt-px inline-flex size-6 shrink-0">
        <input
          type="checkbox"
          checked={checked}
          disabled={disabled}
          aria-invalid={invalid || undefined}
          aria-labelledby={`${id}-label`}
          aria-describedby={description ? `${id}-description` : undefined}
          onChange={(event) => {
            onChange(event.currentTarget.checked);
          }}
          className={`peer size-6 cursor-pointer appearance-none rounded-[7px] border-[1.5px] bg-surface transition-state checked:border-primary-700 checked:bg-primary-700 ${
            invalid ? 'border-danger' : 'border-text-tertiary'
          }`}
        />
        <CheckIcon
          size={16}
          className="pointer-events-none absolute inset-0 m-auto text-on-primary opacity-0 transition-state peer-checked:opacity-100"
        />
      </span>
      <span className="flex min-w-0 flex-col gap-0.5">
        <span id={`${id}-label`} className="type-body text-text">
          {label}
        </span>
        {description ? (
          <span id={`${id}-description`} className="type-footnote text-text-secondary">
            {description}
          </span>
        ) : null}
      </span>
    </label>
  );
}
