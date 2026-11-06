// B7 parts (07 B7, PHASE_03 T3.8): the three big category cards, what still blocks "Next", the verified duas of a
// category to attach, the lost-draft screen and the preview in the musalli Duas card. Text of the duas only from the
// verified Content Library (CLAUDE.md §2.3).
import type { Locale } from '@mc/i18n/locales';
import { useLocale, useTranslation } from '@mc/i18n/react';
import type { AdminLibraryEntry } from '@mc/shared/contracts';
import type { FeedItem } from '@mc/shared/contracts/public';
import { PreviewFrame } from '@mc/ui/admin';
import { Button, EmptyState, IconCircle, PressableCard, SkeletonText, Tag } from '@mc/ui/components';
import { DUA_TONE, FeedItemCard } from '@mc/ui/content';
import { HandsPrayingIcon, HeartbeatIcon, MoonStarsIcon } from '@mc/ui/icons';
import { Screen, useNavigator } from '@mc/ui/navigation';
import type { ReactNode } from 'react';
import { useState } from 'react';

import { EntryText } from '../../daily/components/DailyParts.tsx';
import { useLibrarySearch } from '../../library/hooks/use-library-search.ts';
import type { DuaCategory, DuaIssue } from '../lib/dua.ts';

const ICON: Readonly<Record<DuaCategory, ReactNode>> = {
  illness: <HeartbeatIcon size={28} />,
  inteqal: <MoonStarsIcon size={28} />,
  other: <HandsPrayingIcon size={28} />,
};
export const DUA_CATEGORY_ORDER: readonly DuaCategory[] = ['illness', 'inteqal', 'other'];

/** Step 1: Illness · Inteqal · Other as big cards in their category colours; a tap goes on. */
export function CategoryCards({ onCategory }: { readonly onCategory: (category: DuaCategory) => void }) {
  const { t } = useTranslation('admin');
  return (
    <ul className="flex flex-col gap-3">
      {DUA_CATEGORY_ORDER.map((category) => (
        <li key={category}>
          <PressableCard
            data-category={category}
            className="flex min-h-24 items-center gap-4"
            onPress={() => {
              onCategory(category);
            }}
          >
            <IconCircle tone={DUA_TONE[category]} size={56}>
              {ICON[category]}
            </IconCircle>
            <span className="flex min-w-0 flex-col gap-1">
              <span className="type-title3 text-text">{t(`dua.categories.${category}.title`)}</span>
              <span className="type-callout text-text-secondary">{t(`dua.categories.${category}.body`)}</span>
            </span>
          </PressableCard>
        </li>
      ))}
    </ul>
  );
}

/** What still blocks step 2, in plain words (shown after the admin tried to go on). */
export function DuaIssues({ issues }: { readonly issues: readonly DuaIssue[] }) {
  const { t } = useTranslation('admin');
  if (issues.length === 0) return null;
  return (
    <ul className="flex flex-col gap-2" aria-live="polite" data-dua-issues>
      {issues.map((issue) => (
        <li key={issue}>
          <Tag tone="danger">{t(`dua.issue.${issue}`)}</Tag>
        </li>
      ))}
    </ul>
  );
}

/** Step 3: the verified duas of the category; a tap attaches one and goes on. */
export function DuaChoices({
  masjidId,
  category,
  chosen,
  onPick,
}: {
  readonly masjidId: string | undefined;
  readonly category: DuaCategory;
  readonly chosen: string | null;
  readonly onPick: (entry: AdminLibraryEntry) => void;
}) {
  const { t } = useTranslation('admin');
  const list = useLibrarySearch(masjidId, { kind: 'dua', q: '', tag: '', category }, true);
  const rows = list.data?.pages.flatMap((page) => page.entries) ?? [];
  if (list.isPending) return <SkeletonText lines={6} />;
  if (rows.length === 0) {
    return (
      <EmptyState illustration={<HandsPrayingIcon size={48} />} title={t('dua.noDuas')} body={t('dua.noDuasBody')} />
    );
  }
  return (
    <div className="flex flex-col gap-3">
      <ul className="flex flex-col gap-3">
        {rows.map((entry) => (
          <li key={entry.id}>
            <PressableCard
              variant="outline"
              data-entry={entry.id}
              aria-current={entry.id === chosen ? true : undefined}
              className={entry.id === chosen ? 'border-primary-700' : ''}
              onPress={() => {
                onPick(entry);
              }}
            >
              <EntryText entry={entry} />
            </PressableCard>
          </li>
        ))}
      </ul>
      {list.hasNextPage ? (
        <Button
          variant="outline"
          size="lg"
          fullWidth
          loading={list.isFetchingNextPage}
          onPress={() => {
            void list.fetchNextPage();
          }}
        >
          {t('daily.showMore')}
        </Button>
      ) : null}
    </div>
  );
}

/** Steps 2–4 after a reload: the draft is gone — back to step 1. */
export function DuaLost() {
  const { t } = useTranslation('admin');
  const navigator = useNavigator();
  return (
    <Screen title={t('dua.title')}>
      <EmptyState
        className="mt-8"
        title={t('dua.lostTitle')}
        body={t('dua.lostBody')}
        action={
          <Button
            size="lg"
            onPress={() => {
              navigator.replace('/dua');
            }}
          >
            {t('dua.startAgain')}
          </Button>
        }
      />
    </Screen>
  );
}

/** Step 4: the request in the musalli Duas card (`@mc/ui/content`), in each language — a private name shows as there. */
export function DuaPreview({ item, now }: { readonly item: FeedItem; readonly now: Date }) {
  const { t } = useTranslation('admin');
  const { locale } = useLocale();
  const [shown, setShown] = useState<Locale>(locale);
  return (
    <PreviewFrame
      locale={shown}
      onLocaleChange={setShown}
      label={t('notice.preview')}
      languageLabel={t('notice.showIn')}
    >
      <FeedItemCard item={item} templates={undefined} now={now} />
    </PreviewFrame>
  );
}
