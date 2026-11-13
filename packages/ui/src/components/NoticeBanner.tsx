import type { ReactNode } from 'react';

import { InfoIcon, WarningIcon } from '../icons/glyphs.tsx';

export type NoticeTone = 'info' | 'warning' | 'danger';

const TONE: Readonly<Record<NoticeTone, string>> = {
  info: 'bg-info-bg text-info',
  warning: 'bg-sun-bg text-facilities',
  danger: 'bg-danger-bg text-danger',
};

export interface NoticeBannerProps {
  /** `info` — maintenance; `warning` — something the reader cannot do right now; `danger` — an incident. */
  readonly tone: NoticeTone;
  readonly children: ReactNode;
  /** An optional button (e.g. "Turn off" for the Super Admin). */
  readonly action?: ReactNode;
  readonly className?: string;
}

/**
 * A notice at the top of a screen that stays until the cause ends (07 A17 maintenance banner, PHASE_08 T8.9): the
 * Super Admin's maintenance / incident banners and admin read-only mode. In the flow of the screen (it never covers
 * the header like the offline banner), announced politely (`role="status"`), a tinted surface with an icon.
 */
export function NoticeBanner({ tone, children, action, className }: NoticeBannerProps) {
  return (
    <div
      role="status"
      data-notice-banner={tone}
      className={`flex flex-wrap items-center gap-3 rounded-md p-4 type-callout ${TONE[tone]} ${className ?? ''}`}
    >
      <span className="inline-flex shrink-0" aria-hidden>
        {tone === 'info' ? <InfoIcon size={20} /> : <WarningIcon size={20} />}
      </span>
      <p className="min-w-0 flex-1 text-start">{children}</p>
      {action}
    </div>
  );
}
