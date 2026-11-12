import { useState } from 'react';

import { Pressable } from '../motion/Pressable.tsx';

export interface ChandaBar {
  /** Stable key (the week's first day). */
  readonly key: string;
  /** Short label under the bar ("6 Nov"). */
  readonly label: string;
  /** The amount in paise (`null` = the week was not entered). */
  readonly value: number | null;
  /** The formatted amount ("₹18,500") or "not entered" text. */
  readonly valueText: string;
  /** The current week: drawn in primary (06 §6). */
  readonly current?: boolean;
}

export interface ChandaChartProps {
  /** Oldest first (time flows with the reading direction — RTL mirrors it, 09 §5). */
  readonly bars: readonly ChandaBar[];
  /** Accessible name of the chart ("Chanda of the last 8 weeks"). */
  readonly label: string;
  /** Shown above the bars when one is tapped: `bar` → "6 Nov: ₹18,500". */
  readonly selectedText: (bar: ChandaBar) => string;
  readonly className?: string;
}

/**
 * ChandaChart (06 §6, 07 A11): the last weeks as bars — the current week primary, the others mint-200; a week not
 * entered is a flat stub. Each bar is a button named "<week>: <amount>"; tapping one shows its amount above the chart
 * (again: hides it). Built from the layout (no chart library); the flex row follows the page direction, so Urdu reads
 * right to left. Heights scale to the largest week; 0 to 8 bars render without gaps or errors.
 */
export function ChandaChart({ bars, label, selectedText, className }: ChandaChartProps) {
  const [selected, setSelected] = useState<string | null>(null);
  const max = Math.max(1, ...bars.map((bar) => bar.value ?? 0));
  const picked = bars.find((bar) => bar.key === selected);
  return (
    <figure className={`flex flex-col gap-2 ${className ?? ''}`} data-chanda-chart>
      <p className="min-h-5 text-center type-subhead-strong text-text" aria-live="polite">
        {picked ? selectedText(picked) : ''}
      </p>
      <div role="group" aria-label={label} className="flex h-40 items-stretch gap-2">
        {bars.map((bar) => {
          const share = (bar.value ?? 0) / max;
          return (
            <div key={bar.key} className="flex min-w-0 flex-1 flex-col items-center gap-1">
              <Pressable
                aria-label={`${bar.label}: ${bar.valueText}`}
                aria-pressed={selected === bar.key}
                onPress={() => {
                  setSelected((current) => (current === bar.key ? null : bar.key));
                }}
                className="flex min-h-11 w-full flex-1 items-end justify-center rounded-sm"
                data-bar={bar.key}
              >
                <span
                  aria-hidden
                  className={`block w-full max-w-8 rounded-t-sm ${
                    bar.value === null ? 'bg-surface-muted' : bar.current ? 'bg-primary-500' : 'bg-mint-200'
                  } ${selected === bar.key ? 'ring-2 ring-primary-700' : ''}`}
                  // The bar's height is data (a share of the tallest week), not a layout value.
                  style={{ height: `${String(Math.max(share * 100, bar.value === null ? 2 : 4))}%` }}
                />
              </Pressable>
              <span className="type-caption whitespace-nowrap text-text-tertiary">{bar.label}</span>
            </div>
          );
        })}
      </div>
    </figure>
  );
}
