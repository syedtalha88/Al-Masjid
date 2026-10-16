import { useTranslation } from '@mc/i18n/react';
import { Bdi } from '@mc/i18n/react';
import { Button, ChipGroup, EmptyState, ListRow, SearchField, SkeletonText } from '@mc/ui/components';
import { MasjidTile, PlusIcon } from '@mc/ui/icons';
import { useNavigator } from '@mc/ui/navigation';
import { useInfiniteQuery } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { useDeferredValue, useState } from 'react';

import { type MasjidStatusFilter, superApi } from '../features/super/api/super-api.ts';
import { StatusTag, SuperFrame } from '../features/super/components/SuperFrame.tsx';

export const Route = createFileRoute('/super/masjids/')({
  component: Masjids,
});

type Filter = 'all' | MasjidStatusFilter;

/** C2 Masjids: search (name, city, area, follow code), status chips, newest first, "Show more" pages. */
function Masjids() {
  const { t } = useTranslation('super');
  const navigator = useNavigator();
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const search = useDeferredValue(q.trim());
  const list = useInfiniteQuery({
    queryKey: ['super', 'masjids', search, filter],
    queryFn: ({ pageParam, signal }) =>
      superApi.masjids(
        {
          ...(search ? { q: search } : {}),
          ...(filter === 'all' ? {} : { status: filter }),
          ...(pageParam ? { cursor: pageParam } : {}),
        },
        signal,
      ),
    initialPageParam: '',
    getNextPageParam: (page) => page.next,
  });
  const rows = list.data?.pages.flatMap((page) => page.masjids) ?? [];

  return (
    <SuperFrame
      title={t('nav.masjids')}
      section="masjids"
      actions={
        <Button
          size="md"
          leadingIcon={<PlusIcon />}
          onPress={() => {
            navigator.push('/super/masjids/new');
          }}
        >
          {t('masjids.new')}
        </Button>
      }
    >
      <div className="flex flex-col gap-3">
        <SearchField label={t('masjids.search')} placeholder={t('masjids.search')} value={q} onChange={setQ} />
        <ChipGroup<Filter>
          label={t('nav.masjids')}
          value={filter}
          onChange={setFilter}
          chips={[
            { id: 'all', label: t('masjids.all') },
            { id: 'pending', label: t('status.pending') },
            { id: 'active', label: t('status.active') },
            { id: 'suspended', label: t('status.suspended') },
            { id: 'deleted', label: t('status.deleted') },
          ]}
        />
      </div>
      <div className="mt-4">
        {list.isPending ? (
          <SkeletonText lines={6} />
        ) : rows.length === 0 ? (
          <EmptyState illustration={<MasjidTile size="lg" />} title={t('masjids.empty')} className="mt-8" />
        ) : (
          <>
            <ul className="flex flex-col divide-y divide-border rounded-md bg-surface shadow-e1">
              {rows.map((m) => (
                <li key={m.id}>
                  <ListRow
                    className="px-4"
                    leading={<MasjidTile />}
                    title={<span dir="auto">{m.name}</span>}
                    subtitle={[m.area, m.city].filter(Boolean).join(', ')}
                    meta={<Bdi>{m.followCode}</Bdi>}
                    trailing={<StatusTag status={m.status} />}
                    onPress={() => {
                      navigator.push(`/super/masjids/${m.id}`);
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
                {t('masjids.loadMore')}
              </Button>
            ) : null}
          </>
        )}
      </div>
    </SuperFrame>
  );
}
