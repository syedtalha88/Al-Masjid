import { useTranslation } from '@mc/i18n/react';

import { CheckCircleIcon } from '../icons/glyphs.tsx';
import { type Tone, TONE_CLASS } from './tone.ts';

export interface TagProps {
  readonly tone?: Tone;
  readonly children: string;
  readonly className?: string;
}

/** Category tag (06 §2): radius 8, `caption`, tinted ("Important" danger, "Event" mint, "General" grey…). */
export function Tag({ tone = 'neutral', children, className }: TagProps) {
  return (
    <span
      className={`inline-flex items-center rounded-xs px-2 py-0.5 type-caption whitespace-nowrap ${TONE_CLASS[tone]} ${
        className ?? ''
      }`}
    >
      {children}
    </span>
  );
}

export interface CountBadgeProps {
  readonly count: number;
  /** Highest number shown; above it the badge reads "9+" (default 9). */
  readonly max?: number;
  readonly className?: string;
}

/**
 * Red count badge (06 §6): white bold caption in a danger circle, "9+" above `max`. Its accessible name is
 * the full count ("3 new"). Renders nothing for 0.
 */
export function CountBadge({ count, max = 9, className }: CountBadgeProps) {
  const { t } = useTranslation();
  if (count <= 0) return null;
  const shown = count > max ? `${String(max)}+` : String(count);
  return (
    <span
      role="img"
      aria-label={t('ui.newCount', { count })}
      className={`inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-danger px-1.5 type-caption font-bold text-on-primary tabular-nums ${
        className ?? ''
      }`}
    >
      <bdi aria-hidden>{shown}</bdi>
    </span>
  );
}

/** "Verified" pill (06 §6): mint-50, check icon, primary text — next to a verified masjid's name. */
export function VerifiedBadge({ className }: { readonly className?: string }) {
  const { t } = useTranslation();
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full bg-mint-50 py-0.5 ps-1.5 pe-2.5 type-caption text-primary-700 ${
        className ?? ''
      }`}
    >
      <CheckCircleIcon size={16} />
      {t('ui.verified')}
    </span>
  );
}
