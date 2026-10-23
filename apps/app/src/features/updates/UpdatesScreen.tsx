// A13 Updates (07 A13, ref-2/4): every followed masjid's items newest first, filter chips (only types present so far),
// day headers, a timeline with icon circles; infinite scroll; unseen rows carry a dot until the screen has been visible
// for 1.5 s, which marks everything seen (tab badge and Home's bell clear). Tap → the item (in this tab's stack).
import { addDays, calendarDateInZone, istInstant } from '@mc/domain/time';
import { useLocale, useTranslation } from '@mc/i18n/react';
import type { FeedItem, ItemType } from '@mc/shared/contracts/public';
import { QrPosterIllustration } from '@mc/ui';
import {
  Button,
  ChipGroup,
  EmptyState,
  PullToRefresh,
  Skeleton,
  SkeletonGroup,
  SkeletonText,
  Spinner,
  TimelineList,
} from '@mc/ui/components';
import { Screen, useNavigator, useScreen } from '@mc/ui/navigation';
import { useQuery } from '@tanstack/react-query';
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { templatesQuery } from '../../lib/api/queries.ts';
import { now as correctedNow, useNow } from '../../lib/clock.ts';
import { useAppData } from '../../lib/data.tsx';
import { masjidName } from '../../lib/masjid.ts';
import { sameElements, sameMap } from '../../lib/same.ts';
import { setUnseenCount } from '../../lib/unseen.ts';
import { ItemIcon } from '../content/ItemIcon.tsx';
import { itemKind, itemTitle } from '../content/lib/item-view.ts';
import { useHomeData } from '../home/hooks/useHomeData.ts';
import { useTimeline } from './hooks/useTimeline.ts';
import { availableFilters, FILTERS, sectionsByDay, type TimelineFilter } from './lib/timeline.ts';

/** Visible this long → everything counts as seen (07 A13). */
const MARK_SEEN_MS = 1500;
/** Start loading the next page this far before the list end. */
const PREFETCH_MARGIN = '600px';

export function UpdatesScreen() {
  const { t } = useTranslation();
  const { locale, format } = useLocale();
  const navigator = useNavigator();
  const { isTop } = useScreen();
  const now = useNow();
  const { store } = useAppData();
  const home = useHomeData();
  const [filter, setFilter] = useState<TimelineFilter>('all');
  const type: ItemType | undefined = FILTERS.find((entry) => entry.id === filter)?.type ?? undefined;
  const timeline = useTimeline(type);
  // Dots compare with the last visit as it was when the screen opened, so they stay while reading.
  const [seenAt] = useState(() => store.current().updatesSeenAt);
  const sentinel = useRef<HTMLDivElement>(null);

  const names = useMemo(
    () =>
      new Map(
        home.masjids.flatMap((masjid) =>
          masjid.state === 'active' ? [[masjid.id, masjidName(masjid.bundle.masjid, locale)] as const] : [],
        ),
      ),
    [home.masjids, locale],
  );
  const chips = useMemo(() => availableFilters([...home.itemsByMasjid.values()].flat()), [home.itemsByMasjid]);

  // Seen after 1.5 s on screen (and only while this tab is in front).
  useEffect(() => {
    if (!isTop || timeline.items.length === 0) return;
    let idle = 0;
    const markSeen = () => {
      void store.update((current) => ({ ...current, updatesSeenAt: correctedNow().toISOString() }));
      setUnseenCount(0);
    };
    const timer = setTimeout(() => {
      if (document.visibilityState !== 'visible') return;
      // Written when the browser is idle — never in the middle of a fling (the state change re-renders the tabs).
      if (typeof window.requestIdleCallback === 'function')
        idle = window.requestIdleCallback(markSeen, { timeout: 4000 });
      else markSeen();
    }, MARK_SEEN_MS);
    return () => {
      clearTimeout(timer);
      if (idle) window.cancelIdleCallback(idle);
    };
  }, [isTop, timeline.items.length, store]);

  // Infinite scroll.
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

  const today = calendarDateInZone(now);
  const dayTitle = useCallback(
    (date: string) => {
      if (date === today) return t('home.today');
      if (date === addDays(today, -1)) return t('updates.yesterday');
      return format.date(istInstant(date, '12:00'), 'short');
    },
    [today, t, format],
  );

  return (
    <Screen variant="large" title={t('tabs.updates')}>
      <PullToRefresh onRefresh={timeline.refresh}>
        {timeline.empty ? (
          <EmptyState
            className="pt-8"
            illustration={<QrPosterIllustration width={180} />}
            title={t('home.emptyTitle')}
            body={t('home.emptyBody')}
            action={
              <Button
                size="lg"
                onPress={() => {
                  navigator.presentModal('/scan');
                }}
              >
                {t('home.emptyScan')}
              </Button>
            }
          />
        ) : (
          <div className="flex flex-col gap-3 pb-6">
            {chips.length > 1 ? (
              <ChipGroup
                className="mx-bleed"
                label={t('updates.filters')}
                chips={chips.map((id) => ({ id, label: t(`updates.${id}`) }))}
                value={filter}
                onChange={setFilter}
              />
            ) : null}
            {timeline.loading ? (
              <SkeletonGroup className="flex flex-col gap-3">
                {[0, 1, 2, 3, 4].map((row) => (
                  <span key={row} className="flex items-center gap-3 py-2">
                    <Skeleton className="size-11 rounded-full" />
                    <SkeletonText lines={2} className="flex-1" />
                  </span>
                ))}
              </SkeletonGroup>
            ) : timeline.failed && timeline.items.length === 0 ? (
              <EmptyState
                title={t('appError.title')}
                body={t('appError.body')}
                action={
                  <Button variant="outline" onPress={() => void timeline.refresh()}>
                    {t('appError.retry')}
                  </Button>
                }
              />
            ) : timeline.items.length === 0 ? (
              <p className="py-4 type-callout text-text-secondary">{t('home.noUpdates')}</p>
            ) : (
              <Sections items={timeline.items} names={names} seenAt={seenAt} now={now} dayTitle={dayTitle} />
            )}
            <div ref={sentinel} aria-hidden className="h-px" />
            {timeline.hasMore && timeline.items.length > 0 ? (
              <div role="status" className="flex justify-center py-4">
                <Spinner label={t('updates.loadingMore')} />
              </div>
            ) : null}
          </div>
        )}
      </PullToRefresh>
    </Screen>
  );
}

interface SectionsProps {
  readonly items: readonly FeedItem[];
  readonly names: ReadonlyMap<string, string>;
  readonly seenAt: string | undefined;
  readonly now: Date;
  readonly dayTitle: (date: string) => string;
}

/**
 * The day sections and their rows — memoised: unrelated state changes (the device document, the badge) must not
 * re-render a long list (08 §8 fling budget).
 */
const Sections = memo(
  function Sections({ items, names, seenAt, now, dayTitle }: SectionsProps) {
    const { t } = useTranslation();
    const { locale, format } = useLocale();
    const navigator = useNavigator();
    const { api } = useAppData();
    const templates = useQuery(templatesQuery(api)).data?.templates;
    return sectionsByDay(items).map((section) => (
      <section key={section.date} aria-label={dayTitle(section.date)} className="flex flex-col">
        <h2 className="py-2 type-subhead-strong text-text-secondary">{dayTitle(section.date)}</h2>
        <TimelineList
          rows={section.items.map((item) => ({
            key: item.publicId,
            icon: <ItemIcon item={item} size={44} />,
            masjid: names.get(item.masjidId),
            title: itemTitle(item, locale, templates, t(`item.${itemKind(item)}`)),
            snippet: item.templateKey ? undefined : item.title ? item.body : undefined,
            time: format.relative(new Date(item.publishedAt), now),
            unseen: seenAt === undefined || item.publishedAt > seenAt,
            unseenLabel: t('updates.new'),
            onPress: () => {
              navigator.push(`/items/${item.publicId}`);
            },
          }))}
        />
      </section>
    ));
  },
  (previous, next) =>
    sameElements(previous.items, next.items) &&
    sameMap(previous.names, next.names) &&
    previous.seenAt === next.seenAt &&
    previous.now === next.now &&
    previous.dayTitle === next.dayTitle,
);
