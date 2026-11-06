import { useTranslation } from '@mc/i18n/react';
import { Bdi } from '@mc/i18n/react';
import { Button, ChipGroup, EmptyState, ListRow, SearchField, SkeletonText } from '@mc/ui/components';
import { BookOpenIcon, PlusIcon } from '@mc/ui/icons';
import { useNavigator } from '@mc/ui/navigation';
import { useInfiniteQuery } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { useDeferredValue, useState } from 'react';

import { type LibraryKind, type LibraryStatus, superApi } from '../features/super/api/super-api.ts';
import { LibraryStatusTag } from '../features/super/components/LibraryStatusTag.tsx';
import { SuperFrame } from '../features/super/components/SuperFrame.tsx';

export const Route = createFileRoute('/super/library/')({
  component: Library,
});

type StatusFilter = 'all' | LibraryStatus;
type KindFilter = 'all' | LibraryKind;
const KINDS: readonly LibraryKind[] = ['hadith', 'ayah', 'dua', 'dhikr'];

/** C8 Content Library: status and kind chips, search (reference, words, tags), newest change first, import. */
function Library() {
  const { t } = useTranslation('super');
  const navigator = useNavigator();
  const [q, setQ] = useState('');
  const [status, setStatus] = useState<StatusFilter>('draft');
  const [kind, setKind] = useState<KindFilter>('all');
  const search = useDeferredValue(q.trim());
  const list = useInfiniteQuery({
    queryKey: ['super', 'library', search, status, kind],
    queryFn: ({ pageParam, signal }) =>
      superApi.library(
        {
          ...(search ? { q: search } : {}),
          ...(status === 'all' ? {} : { status }),
          ...(kind === 'all' ? {} : { kind }),
          ...(pageParam ? { cursor: pageParam } : {}),
        },
        signal,
      ),
    initialPageParam: '',
    getNextPageParam: (page) => page.next,
  });
  const rows = list.data?.pages.flatMap((page) => page.entries) ?? [];

  return (
    <SuperFrame
      title={t('nav.library')}
      section="library"
      actions={
        <Button
          size="md"
          leadingIcon={<PlusIcon />}
          onPress={() => {
            navigator.push('/super/library/import');
          }}
        >
          {t('library.import')}
        </Button>
      }
    >
      <div className="flex flex-col gap-3">
        <SearchField label={t('library.search')} placeholder={t('library.search')} value={q} onChange={setQ} />
        <ChipGroup<StatusFilter>
          label={t('library.statusFilter')}
          value={status}
          onChange={setStatus}
          chips={[
            { id: 'draft', label: t('library.statuses.draft') },
            { id: 'verified', label: t('library.statuses.verified') },
            { id: 'retired', label: t('library.statuses.retired') },
            { id: 'all', label: t('library.all') },
          ]}
        />
        <ChipGroup<KindFilter>
          label={t('library.kindFilter')}
          value={kind}
          onChange={setKind}
          chips={[
            { id: 'all', label: t('library.all') },
            ...KINDS.map((id) => ({ id, label: t(`library.kinds.${id}`) })),
          ]}
        />
      </div>
      <div className="mt-4">
        {list.isPending ? (
          <SkeletonText lines={6} />
        ) : rows.length === 0 ? (
          <EmptyState illustration={<BookOpenIcon size={48} />} title={t('library.empty')} className="mt-8" />
        ) : (
          <>
            <ul className="flex flex-col divide-y divide-border rounded-md bg-surface shadow-e1">
              {rows.map((entry) => (
                <li key={entry.id}>
                  <ListRow
                    className="px-4"
                    title={<Bdi>{entry.reference}</Bdi>}
                    subtitle={entry.translation.en}
                    subtitleLines={2}
                    meta={t(`library.kinds.${entry.kind}`)}
                    trailing={<LibraryStatusTag status={entry.status} />}
                    onPress={() => {
                      navigator.push(`/super/library/${entry.id}`);
                    }}
                  />
                </li>
              ))}
            </ul>
            {list.hasNextPage ? (
              <Button
                variant="outline"
                fullWidth
                className="mt-4"
                loading={list.isFetchingNextPage}
                onPress={() => {
                  void list.fetchNextPage();
                }}
              >
                {t('library.loadMore')}
              </Button>
            ) : null}
          </>
        )}
      </div>
    </SuperFrame>
  );
}
