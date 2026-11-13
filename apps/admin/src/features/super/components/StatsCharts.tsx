// C12 Stats charts (07 C12 "simple bars/lines, custom SVG", PHASE_08 T8.10). Every chart is one series in the brand
// green (`primary-500`, as the progress bar), so identity is never carried by colour: bars are labelled with their category and value; a trend line is
// named by its title, has a hover / keyboard readout of the chosen day (arrow keys), and a table for screen readers.
// Time runs left to right in every language (the readout and table carry the words).
import { useLocale, useTranslation } from '@mc/i18n/react';
import { type KeyboardEvent, type PointerEvent, useId, useState } from 'react';

export interface BarRow {
  readonly key: string;
  readonly label: string;
  readonly value: number;
}

/** Labelled horizontal bars (largest = full width). Zero rows still show their label and 0. */
export function BarList({ title, rows }: { readonly title: string; readonly rows: readonly BarRow[] }) {
  const { format } = useLocale();
  const max = Math.max(1, ...rows.map((row) => row.value));
  return (
    <figure className="flex flex-col gap-2">
      <figcaption className="type-subhead-strong text-text">{title}</figcaption>
      <ul className="flex flex-col gap-2">
        {rows.map((row) => (
          <li key={row.key} className="grid grid-cols-[minmax(6rem,auto)_1fr_auto] items-center gap-3">
            <span className="type-footnote text-text-secondary">{row.label}</span>
            <span className="h-2 overflow-hidden rounded-full bg-surface-muted" aria-hidden>
              <span
                className="block h-full rounded-full bg-primary-500"
                style={{ width: `${String((row.value / max) * 100)}%` }}
              />
            </span>
            <span className="type-footnote tabular-nums text-text">{format.number(row.value)}</span>
          </li>
        ))}
      </ul>
    </figure>
  );
}

export interface TrendPoint {
  /** India calendar date `YYYY-MM-DD`. */
  readonly day: string;
  readonly value: number;
}

const W = 300;
const H = 80;
const PAD = 6;

/** A 30-day line of one measure, with a readout of the last (or chosen) day. */
export function TrendLine({ title, points }: { readonly title: string; readonly points: readonly TrendPoint[] }) {
  const { t } = useTranslation('super');
  const { format } = useLocale();
  const id = useId();
  const [chosen, setChosen] = useState<number | null>(null);
  const index = chosen ?? points.length - 1;
  const current = points[index];
  const max = Math.max(1, ...points.map((p) => p.value));
  const min = Math.min(...points.map((p) => p.value), max);
  const span = Math.max(1, max - min);
  const x = (i: number) => (points.length < 2 ? W / 2 : PAD + (i * (W - 2 * PAD)) / (points.length - 1));
  const y = (v: number) => H - PAD - ((v - min) * (H - 2 * PAD)) / span;
  const dayText = (day: string) => format.date(new Date(`${day}T12:00:00+05:30`), 'medium');

  const choose = (event: PointerEvent<SVGSVGElement>) => {
    const box = event.currentTarget.getBoundingClientRect();
    const fraction = (event.clientX - box.left) / Math.max(1, box.width);
    setChosen(Math.max(0, Math.min(points.length - 1, Math.round(fraction * (points.length - 1)))));
  };
  const step = (event: KeyboardEvent<SVGSVGElement>) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault();
    setChosen(Math.max(0, Math.min(points.length - 1, index + (event.key === 'ArrowRight' ? 1 : -1))));
  };

  return (
    <figure className="flex flex-col gap-2" aria-labelledby={`${id}-title`}>
      <figcaption id={`${id}-title`} className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="type-subhead-strong text-text">{title}</span>
        {current ? (
          <span className="type-footnote text-text-secondary" aria-live="polite">
            {`${dayText(current.day)}: `}
            <span className="tabular-nums text-text">{format.number(current.value)}</span>
          </span>
        ) : null}
      </figcaption>
      {points.length === 0 ? (
        <p className="type-footnote text-text-secondary">{t('stats.trendEmpty')}</p>
      ) : (
        <div dir="ltr">
          <svg
            viewBox={`0 0 ${String(W)} ${String(H)}`}
            className="h-20 w-full touch-none rounded-sm text-primary-500 focus-visible:outline-2 focus-visible:outline-focus"
            role="img"
            aria-label={title}
            tabIndex={0}
            onPointerMove={choose}
            onPointerDown={choose}
            onPointerLeave={() => {
              setChosen(null);
            }}
            onKeyDown={step}
          >
            <line x1={0} x2={W} y1={H - PAD} y2={H - PAD} className="stroke-border" strokeWidth={1} />
            <polyline
              points={points.map((p, i) => `${String(x(i))},${String(y(p.value))}`).join(' ')}
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              strokeLinejoin="round"
              strokeLinecap="round"
              vectorEffect="non-scaling-stroke"
            />
            {current ? (
              <>
                <line x1={x(index)} x2={x(index)} y1={0} y2={H} className="stroke-border" strokeWidth={1} />
                <circle
                  cx={x(index)}
                  cy={y(current.value)}
                  r={4}
                  fill="currentColor"
                  className="stroke-surface"
                  strokeWidth={2}
                />
              </>
            ) : null}
          </svg>
        </div>
      )}
      <table className="sr-only">
        <caption>{`${title} — ${t('stats.trendTable')}`}</caption>
        <thead>
          <tr>
            <th scope="col">{t('stats.day')}</th>
            <th scope="col">{t('stats.value')}</th>
          </tr>
        </thead>
        <tbody>
          {points.map((p) => (
            <tr key={p.day}>
              <td>{dayText(p.day)}</td>
              <td>{format.number(p.value)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}
