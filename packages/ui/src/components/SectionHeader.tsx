import { useTranslation } from '@mc/i18n/react';
import { useId } from 'react';

import { Pressable } from '../motion/Pressable.tsx';

export interface SectionHeaderProps {
  readonly title: string;
  /** Shows a "See All" link-button when given. */
  readonly onSeeAll?: () => void;
  /** Heading level for the document outline (default 2). */
  readonly level?: 2 | 3;
  /** Heading id (generated when omitted); "See All" is described by it ("See All, Recent Updates"). */
  readonly id?: string;
  readonly className?: string;
}

/** Section title (`headline`) with an optional trailing "See All" (ref-1 Home). */
export function SectionHeader({ title, onSeeAll, level = 2, id, className }: SectionHeaderProps) {
  const { t } = useTranslation();
  const autoId = useId();
  const headingId = id ?? autoId;
  const Heading = level === 2 ? 'h2' : 'h3';
  return (
    <div className={`flex min-h-11 items-center justify-between gap-3 ${className ?? ''}`}>
      <Heading id={headingId} className="min-w-0 truncate type-headline text-text">
        {title}
      </Heading>
      {onSeeAll ? (
        <Pressable
          onPress={onSeeAll}
          aria-describedby={headingId}
          className="-me-2 inline-flex min-h-11 shrink-0 items-center rounded-full px-2 type-subhead-strong text-primary-700 data-[pressed]:bg-mint-50"
        >
          {t('ui.seeAll')}
        </Pressable>
      ) : null}
    </div>
  );
}
