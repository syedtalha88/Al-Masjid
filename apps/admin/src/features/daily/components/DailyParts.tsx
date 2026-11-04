// B6 parts (07 B6, PHASE_03 T3.7): a library entry as the admin reads it (Arabic, the translation in the admin's
// language — English with a tag when missing — and the reference), today's suggestion with "Use this" / "Choose
// another", the search sheet (words + topic chips over verified entries) and the "already one today" warning. Text
// only from the verified Content Library (CLAUDE.md §2.3).
import type { Locale } from '@mc/i18n/locales';
import { Bdi, useLocale, useTranslation } from '@mc/i18n/react';
import type { AdminLibraryEntry } from '@mc/shared/contracts';
import type { FeedItem } from '@mc/shared/contracts/public';
import { PreviewFrame } from '@mc/ui/admin';
import {
  Button,
  Card,
  ChipGroup,
  DuaBox,
  EmptyState,
  PressableCard,
  SearchField,
  Sheet,
  SkeletonText,
} from '@mc/ui/components';
import { FeedItemCard, libraryText } from '@mc/ui/content';
import { BookOpenIcon, WarningIcon } from '@mc/ui/icons';
import { Screen, useNavigator } from '@mc/ui/navigation';
import { useDeferredValue, useState } from 'react';

import { useLibrarySearch } from '../../library/hooks/use-library-search.ts';
import { type DailyKind, topicChips } from '../lib/daily.ts';

/** The entry's text in a mint box and its reference under it. */
export function EntryText({ entry }: { readonly entry: AdminLibraryEntry }) {
  const { t } = useTranslation('admin');
  const { locale } = useLocale();
  const text = libraryText(entry, locale);
  return (
    <div className="flex flex-col gap-2">
      <DuaBox
        arabic={entry.arabic}
        transliteration={text.transliteration}
        translation={text.translation}
        translationTag={text.fallback ? t('daily.english') : undefined}
      />
      <p className="type-footnote text-text-secondary">
        <Bdi>{entry.reference}</Bdi>
      </p>
    </div>
  );
}

/** "Today's suggestion" (07 B6): the entry, "Use this" (primary) and "Choose another". */
export function SuggestionCard({
  entry,
  onUse,
  onChooseAnother,
}: {
  readonly entry: AdminLibraryEntry;
  readonly onUse: () => void;
  readonly onChooseAnother: () => void;
}) {
  const { t } = useTranslation('admin');
  return (
    <Card className="flex flex-col gap-4" data-suggestion={entry.id}>
      <h2 className="type-headline text-text">{t('daily.suggestion')}</h2>
      <EntryText entry={entry} />
      <div className="flex flex-col gap-3">
        <Button size="lg" fullWidth onPress={onUse}>
          {t('daily.useThis')}
        </Button>
        <Button variant="secondary" size="lg" fullWidth onPress={onChooseAnother}>
          {t('daily.chooseAnother')}
        </Button>
      </div>
    </Card>
  );
}

/** One of the kind already went out today: a second one is allowed, with this warning (T3.7 "soft warning"). */
export function PublishedTodayNote({ kind }: { readonly kind: DailyKind }) {
  const { t } = useTranslation('admin');
  return (
    <p className="flex items-start gap-3 rounded-md bg-sun-bg p-4 type-callout text-text" data-published-today>
      <WarningIcon size={20} className="mt-0.5 shrink-0 text-facilities" />
      <span className="min-w-0">{t(kind === 'ayah' ? 'daily.todayAyah' : 'daily.todayHadith')}</span>
    </p>
  );
}

const ALL = '';
/** A tag as a chip label: the library's lower-case word with its separators as spaces ("after-fajr" → "after fajr"). */
const tagLabel = (tag: string) => tag.replace(/[-_]+/g, ' ');

/**
 * "Choose another" (07 B6): search words and topic chips (the most used tags of the kind) over verified entries; a tap
 * picks the entry. Results come page by page ("Show more").
 */
export function LibrarySearchSheet({
  open,
  onClose,
  masjidId,
  kind,
  onPick,
}: {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly masjidId: string | undefined;
  readonly kind: DailyKind;
  readonly onPick: (entry: AdminLibraryEntry) => void;
}) {
  const { t } = useTranslation('admin');
  const [q, setQ] = useState('');
  const [tag, setTag] = useState(ALL);
  const search = useDeferredValue(q.trim());
  // The topics come from the unfiltered list (the same query as "All" with no words — cached once).
  const topics = useLibrarySearch(masjidId, { kind, q: '', tag: ALL }, open);
  const list = useLibrarySearch(masjidId, { kind, q: search, tag }, open);
  const chips = topicChips(topics.data?.pages.flatMap((page) => page.entries) ?? []);
  const rows = list.data?.pages.flatMap((page) => page.entries) ?? [];

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={t(kind === 'ayah' ? 'daily.searchAyah' : 'daily.searchHadith')}
      snaps={['full']}
    >
      <div className="flex flex-col gap-4 pb-4">
        <SearchField label={t('daily.search')} placeholder={t('daily.search')} value={q} onChange={setQ} />
        {chips.length > 0 ? (
          <ChipGroup<string>
            label={t('daily.topics')}
            value={tag}
            onChange={setTag}
            chips={[{ id: ALL, label: t('daily.allTopics') }, ...chips.map((id) => ({ id, label: tagLabel(id) }))]}
          />
        ) : null}
        {list.isPending ? (
          <SkeletonText lines={6} />
        ) : rows.length === 0 ? (
          <EmptyState
            illustration={<BookOpenIcon size={48} />}
            title={t('daily.noResults')}
            body={t('daily.noResultsBody')}
          />
        ) : (
          <>
            <ul className="flex flex-col gap-3">
              {rows.map((entry) => (
                <li key={entry.id}>
                  <PressableCard
                    variant="outline"
                    data-entry={entry.id}
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
          </>
        )}
      </div>
    </Sheet>
  );
}

/** Steps 2 and 3 after a reload: the draft is gone — back to step 1. */
export function DailyLost() {
  const { t } = useTranslation('admin');
  const navigator = useNavigator();
  return (
    <Screen title={t('daily.title')}>
      <EmptyState
        className="mt-8"
        title={t('daily.lostTitle')}
        body={t('daily.lostBody')}
        action={
          <Button
            size="lg"
            onPress={() => {
              navigator.replace('/daily');
            }}
          >
            {t('daily.startAgain')}
          </Button>
        }
      />
    </Screen>
  );
}

/** Step 3: the post in the musalli Hadith & Quran "Today's" hero card (`@mc/ui/content`), in each language. */
export function DailyPreview({ item, now }: { readonly item: FeedItem; readonly now: Date }) {
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
