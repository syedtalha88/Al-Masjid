// The frame of a masjid's section list (07 A7–A9): inline bar with the masjid name, pull-to-refresh, the filter row,
// then loading skeleton / error with retry / empty state / the list, and the infinite-scroll sentinel.
import { useTranslation } from '@mc/i18n/react';
import { Button, EmptyState, PullToRefresh, Skeleton, SkeletonGroup, SkeletonText, Spinner } from '@mc/ui/components';
import { Screen, useNavigator } from '@mc/ui/navigation';
import { type ReactNode, useEffect, useRef } from 'react';

import type { Timeline } from '../../updates/hooks/useTimeline.ts';

/** Start loading the next page this far before the list end. */
const PREFETCH_MARGIN = '600px';

export interface SectionFrameProps {
  readonly title: string;
  readonly subtitle?: string | undefined;
  readonly timeline: Timeline;
  /** The masjid is suspended or no longer listed: this text instead of the list. */
  readonly unavailable?: string | undefined;
  /** Chips / segmented control above the list. */
  readonly header?: ReactNode;
  readonly illustration: ReactNode;
  readonly emptyTitle: string;
  readonly emptyBody: string;
  /** The (filtered) list is empty, but the section has items. */
  readonly filteredEmpty: boolean;
  readonly children: ReactNode;
}

export function SectionFrame({
  title,
  subtitle,
  timeline,
  unavailable,
  header,
  illustration,
  emptyTitle,
  emptyBody,
  filteredEmpty,
  children,
}: SectionFrameProps) {
  const { t } = useTranslation();
  const { t: tc } = useTranslation('content');
  const navigator = useNavigator();
  const sentinel = useRef<HTMLDivElement>(null);
  const { hasMore, fetching, loadMore } = timeline;

  useEffect(() => {
    const node = sentinel.current;
    if (!node || !hasMore) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting) && !fetching) loadMore();
      },
      { rootMargin: PREFETCH_MARGIN },
    );
    observer.observe(node);
    return () => {
      observer.disconnect();
    };
  }, [hasMore, fetching, loadMore]);

  const back = (
    <Button
      variant="outline"
      onPress={() => {
        navigator.back();
      }}
    >
      {tc('back')}
    </Button>
  );

  const body = (() => {
    if (unavailable) return <EmptyState className="pt-8" title={unavailable} action={back} />;
    if (timeline.loading) {
      return (
        <SkeletonGroup className="flex flex-col gap-3">
          {[0, 1, 2].map((row) => (
            <span key={row} className="flex gap-3 rounded-md bg-surface p-4 shadow-e1">
              <Skeleton className="size-12 shrink-0 rounded-full" />
              <SkeletonText lines={3} className="flex-1" />
            </span>
          ))}
        </SkeletonGroup>
      );
    }
    if (timeline.failed && timeline.items.length === 0) {
      return (
        <EmptyState
          className="pt-8"
          title={t('appError.title')}
          body={t('appError.body')}
          action={
            <Button variant="outline" onPress={() => void timeline.refresh()}>
              {t('appError.retry')}
            </Button>
          }
        />
      );
    }
    if (timeline.items.length === 0) {
      return (
        <EmptyState className="pt-8" illustration={illustration} title={emptyTitle} body={emptyBody} action={back} />
      );
    }
    return (
      <>
        {children}
        {filteredEmpty && !hasMore ? (
          <p className="py-4 text-center type-callout text-text-secondary">{tc('noneInFilter')}</p>
        ) : null}
      </>
    );
  })();

  return (
    <Screen title={title} {...(subtitle ? { subtitle } : {})}>
      <PullToRefresh onRefresh={timeline.refresh}>
        <div className="flex flex-col gap-3 pt-2 pb-6">
          {header && timeline.items.length > 0 && !unavailable ? header : null}
          {body}
          <div ref={sentinel} aria-hidden className="h-px" />
          {hasMore && timeline.items.length > 0 ? (
            <div role="status" className="flex justify-center py-4">
              <Spinner label={t('updates.loadingMore')} />
            </div>
          ) : null}
        </div>
      </PullToRefresh>
    </Screen>
  );
}
