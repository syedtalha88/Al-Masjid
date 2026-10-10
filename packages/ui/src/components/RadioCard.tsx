import { type ReactNode, useId } from 'react';

import { CheckCircleIcon } from '../icons/glyphs.tsx';

export interface RadioCardOption<Value extends string = string> {
  readonly value: Value;
  readonly title: string;
  readonly description?: string;
  /** Decorative leading visual (icon circle, flag-free language glyph…). */
  readonly leading?: ReactNode;
  /** Language of this option's text (each language name shown in its own script — 07 Onboarding). */
  readonly lang?: string;
}

export interface RadioCardGroupProps<Value extends string> {
  /** Visible group question ("Choose your language"). */
  readonly legend: string;
  /** Hide the legend visually (it stays the group's accessible name). */
  readonly hideLegend?: boolean;
  /** Form field name shared by the radios. */
  readonly name: string;
  readonly options: readonly RadioCardOption<Value>[];
  readonly value: Value | null;
  readonly onChange: (value: Value) => void;
  readonly className?: string;
}

/**
 * Big selectable cards (06 §6 RadioCard — onboarding language, Brother/Sister): native radios in a
 * fieldset (arrow keys, forms, screen readers for free), each drawn as a ≥ 72 px card; the selected card is
 * mint with a primary border and check.
 */
export function RadioCardGroup<Value extends string>({
  legend,
  hideLegend = false,
  name,
  options,
  value,
  onChange,
  className,
}: RadioCardGroupProps<Value>) {
  const id = useId();
  return (
    <fieldset className={`flex flex-col gap-3 ${className ?? ''}`}>
      <legend className={hideLegend ? 'sr-only' : 'mb-3 type-headline text-text'}>{legend}</legend>
      {options.map((option) => {
        const checked = option.value === value;
        const optionId = `${id}-${option.value}`;
        return (
          <label
            key={option.value}
            className={`group relative flex min-h-18 cursor-pointer items-center gap-4 rounded-md border-[1.5px] px-4 py-3 transition-state has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-focus ${
              checked ? 'border-primary-700 bg-mint-50' : 'border-border bg-surface'
            }`}
          >
            <input
              type="radio"
              name={name}
              value={option.value}
              checked={checked}
              aria-labelledby={`${optionId}-title`}
              aria-describedby={option.description ? `${optionId}-description` : undefined}
              onChange={() => {
                onChange(option.value);
              }}
              className="sr-only"
            />
            {option.leading ? <span className="inline-flex shrink-0">{option.leading}</span> : null}
            <span className="flex min-w-0 flex-1 flex-col gap-0.5" lang={option.lang}>
              <span id={`${optionId}-title`} className="type-headline text-text">
                {option.title}
              </span>
              {option.description ? (
                <span id={`${optionId}-description`} className="type-footnote text-text-secondary">
                  {option.description}
                </span>
              ) : null}
            </span>
            <span
              aria-hidden
              className={`inline-flex size-6 shrink-0 items-center justify-center rounded-full transition-state ${
                checked ? 'text-primary-700' : 'border-[1.5px] border-text-tertiary'
              }`}
            >
              {checked ? <CheckCircleIcon size={24} /> : null}
            </span>
          </label>
        );
      })}
    </fieldset>
  );
}
