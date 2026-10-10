import { useTranslation } from '@mc/i18n/react';
import type { ReactNode } from 'react';

export interface SkeletonProps {
  /** Size and radius classes, e.g. `h-4 w-32 rounded-xs` (reserve the real content's height — 08 §5.4). */
  readonly className?: string;
}

/** A placeholder block with a shimmer sweep (static with reduced motion). Decorative. */
export function Skeleton({ className }: SkeletonProps) {
  return <span aria-hidden className={`skeleton block ${className ?? 'h-4 w-full rounded-xs'}`} />;
}

/** Text lines placeholder: full-width lines, the last one shorter. */
export function SkeletonText({ lines = 2, className }: { readonly lines?: number; readonly className?: string }) {
  return (
    <span aria-hidden className={`flex flex-col gap-2 ${className ?? ''}`}>
      {Array.from({ length: lines }, (_, index) => (
        <Skeleton key={index} className={`h-3.5 rounded-xs ${index === lines - 1 ? 'w-2/3' : 'w-full'}`} />
      ))}
    </span>
  );
}

/**
 * Loading region: announces "Loading…" once to screen readers (`role="status"`) and marks the region busy;
 * the skeleton shapes inside are decorative.
 */
export function SkeletonGroup({ children, className }: { readonly children: ReactNode; readonly className?: string }) {
  const { t } = useTranslation();
  return (
    <div role="status" aria-busy="true" className={className}>
      <span className="sr-only">{t('loading')}</span>
      {children}
    </div>
  );
}
