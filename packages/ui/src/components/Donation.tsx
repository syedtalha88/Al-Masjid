// Donation components (06 §6, 07 A10, ref-3/4 + ref-2/3): the status pill, the received-vs-goal pair, the meta row and
// the campaign card. Presentational only — the app passes localized text and formatted amounts.
import { type ReactNode, useId } from 'react';

import { CaretRightIcon } from '../icons/glyph/CaretRightIcon.tsx';
import { Pressable } from '../motion/Pressable.tsx';
import { ProgressBar } from './ProgressBar.tsx';

export type CampaignStatusKind = 'active' | 'completed' | 'closed';

const PILL: Readonly<Record<CampaignStatusKind, string>> = {
  active: 'bg-primary-700 text-on-primary',
  completed: 'bg-mint-100 text-primary-800',
  closed: 'bg-surface-muted text-text-secondary',
};

/** Campaign status pill (07 A10): Active filled primary · Completed mint · Closed grey. */
export function StatusPill({
  status,
  children,
  className,
}: {
  readonly status: CampaignStatusKind;
  readonly children: ReactNode;
  readonly className?: string;
}) {
  return (
    <span
      data-status={status}
      className={`inline-flex items-center rounded-full px-3 py-1 type-caption font-semibold whitespace-nowrap ${
        PILL[status]
      } ${className ?? ''}`}
    >
      {children}
    </span>
  );
}

export interface AmountPairProps {
  /** The received amount (a formatted string or a `CountUp`). */
  readonly received: ReactNode;
  /** "Received (reported by masjid)". */
  readonly receivedLabel: string;
  readonly target: string;
  /** "Goal". */
  readonly targetLabel: string;
  readonly className?: string;
}

/** AmountPair (06 §6, ref-2/3): received `amountLarge` at the start, the goal at the end, each with its caption. */
export function AmountPair({ received, receivedLabel, target, targetLabel, className }: AmountPairProps) {
  return (
    <dl className={`flex items-end justify-between gap-4 ${className ?? ''}`}>
      <div className="flex min-w-0 flex-col">
        <dt className="order-2 type-caption text-text-secondary">{receivedLabel}</dt>
        <dd className="order-1 type-amount-large text-text">{received}</dd>
      </div>
      <div className="flex min-w-0 flex-col items-end text-end">
        <dt className="order-2 type-caption text-text-secondary">{targetLabel}</dt>
        <dd className="order-1 type-headline tabular-nums text-text">{target}</dd>
      </div>
    </dl>
  );
}

export interface MetaItem {
  readonly icon: ReactNode;
  readonly label: string;
  readonly value: string;
}

/**
 * MetaRow (06 §6, ref-3/4): Started · Ends · Purpose — icon and caption label, the value under the label; three equal
 * columns. Each column is a `div > dt + dd` group (the icon sits inside the `dt`, hidden from assistive technology).
 */
export function MetaRow({ items, className }: { readonly items: readonly MetaItem[]; readonly className?: string }) {
  return (
    <dl className={`grid grid-cols-3 gap-2 ${className ?? ''}`}>
      {items.map((item) => (
        <div key={item.label} className="flex min-w-0 flex-col">
          <dt className="flex items-center gap-1.5 type-caption text-text-secondary">
            <span aria-hidden className="inline-flex size-4.5 shrink-0 items-center justify-center">
              {item.icon}
            </span>
            <span className="min-w-0 truncate">{item.label}</span>
          </dt>
          <dd className="ps-6 type-footnote text-text">{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}

export interface CampaignCardProps {
  /** The cover (16:9 `Image`), or the illustrated placeholder when the campaign has none. */
  readonly cover: ReactNode;
  readonly status: CampaignStatusKind;
  readonly statusLabel: string;
  readonly title: string;
  /** 0–1 (the bar caps at 100 %). */
  readonly progress: number;
  readonly progressLabel: string;
  /** "72%". */
  readonly progressText: string;
  /** "₹72,000 raised of ₹1,00,000". */
  readonly amounts: string;
  /** "12 days left" / "Ended" — optional. */
  readonly meta?: string | undefined;
  /** Masjid name on cross-masjid lists. */
  readonly masjid?: string | undefined;
  readonly onPress: () => void;
}

/**
 * CampaignCard (06 §6, 07 A10 list): cover 16:9 with the status pill, title, progress bar, "raised of" line and days
 * left. One button named by its title.
 */
export function CampaignCard({
  cover,
  status,
  statusLabel,
  title,
  progress,
  progressLabel,
  progressText,
  amounts,
  meta,
  masjid,
  onPress,
}: CampaignCardProps) {
  const titleId = useId();
  const detailId = useId();
  return (
    <Pressable
      kind="card"
      aria-labelledby={titleId}
      aria-describedby={detailId}
      onPress={onPress}
      className="flex w-full flex-col overflow-hidden rounded-md bg-surface text-start shadow-e1"
    >
      <span className="relative block w-full">
        {cover}
        <StatusPill status={status} className="absolute end-3 top-3">
          {statusLabel}
        </StatusPill>
      </span>
      <span className="flex w-full flex-col gap-2 p-4">
        {masjid ? <bdi className="truncate type-caption text-text-secondary">{masjid}</bdi> : null}
        <span className="flex items-start gap-2">
          <span id={titleId} dir="auto" className="line-clamp-2 min-w-0 flex-1 type-headline text-text">
            {title}
          </span>
          <span aria-hidden className="mt-0.5 shrink-0 text-text-tertiary">
            <CaretRightIcon size={20} className="rtl:-scale-x-100" />
          </span>
        </span>
        <ProgressBar value={progress} label={progressLabel} valueText={progressText} decorative />
        <span id={detailId} className="flex flex-col gap-2">
          <span className="flex items-center justify-between gap-3 type-callout text-text-secondary">
            <span className="tabular-nums">{amounts}</span>
            <span className="type-subhead-strong tabular-nums text-primary-700">{progressText}</span>
          </span>
          {meta ? <span className="type-caption text-text-tertiary">{meta}</span> : null}
        </span>
      </span>
    </Pressable>
  );
}
