import { useTranslation } from '@mc/i18n/react';
import { type AdminRuqyahEntry, RUQYAH_MAX } from '@mc/shared/contracts';
import {
  Button,
  Card,
  Dialog,
  EmptyState,
  ReorderList,
  SectionHeader,
  SkeletonText,
  Tag,
  useToast,
} from '@mc/ui/components';
import { BookOpenIcon, PencilIcon, PlayCircleIcon, PlusIcon, ShieldCheckIcon } from '@mc/ui/icons';
import { Screen, useNavigator } from '@mc/ui/navigation';
import { createFileRoute } from '@tanstack/react-router';
import { useState } from 'react';

import { useErrorText, useSignedInAdmin } from '../features/auth/hooks/use-session.ts';
import { useSelectedMasjid } from '../features/home/hooks/use-selected-masjid.ts';
import { useRuqyah, useRuqyahWrites } from '../features/ruqyah/hooks/use-ruqyah.ts';
import { entrySummary, groupByCategory, orderAfterMove } from '../features/ruqyah/lib/ruqyah.ts';

export const Route = createFileRoute('/ruqyah/')({
  component: RuqyahList,
});

const SOURCE_ICON = {
  library: <BookOpenIcon size={20} />,
  text: <PencilIcon size={20} />,
  audio: <PlayCircleIcon size={20} />,
} as const;

/**
 * B15 Ruqyah (07 B15, PHASE_03 T3.15): the masjid's entries under their headings (as musallis see them), each with Edit,
 * Move up / Move down (or drag — WCAG 2.5.7) inside its heading and Delete with a confirm; "Add" opens the editor
 * (library entry, the masjid's own text, or a recording). At most 50.
 */
function RuqyahList() {
  const { t } = useTranslation('admin');
  const { t: tc } = useTranslation();
  const navigator = useNavigator();
  const toast = useToast();
  const errorText = useErrorText();
  const me = useSignedInAdmin();
  const { masjid } = useSelectedMasjid(me.masjids);
  const list = useRuqyah(masjid?.id);
  const { remove, order } = useRuqyahWrites(masjid?.id);
  const [deleting, setDeleting] = useState<AdminRuqyahEntry | null>(null);
  const entries = list.data?.entries ?? [];
  const full = entries.length >= RUQYAH_MAX;
  const add = () => {
    navigator.push('/ruqyah/new');
  };
  const move = (entry: AdminRuqyahEntry, from: number, to: number) => {
    const ids = orderAfterMove(entries, entry.category, from, to);
    if (!ids) return;
    order.mutate(ids, {
      onError: (error) => {
        toast.show({ message: errorText(error), tone: 'error' });
      },
    });
  };

  if (list.isError) {
    return (
      <Screen title={t('ruqyah.title')}>
        <EmptyState
          className="mt-8"
          title={errorText(list.error)}
          action={
            <Button
              size="lg"
              onPress={() => {
                void list.refetch();
              }}
            >
              {tc('appError.retry')}
            </Button>
          }
        />
      </Screen>
    );
  }
  return (
    <Screen title={t('ruqyah.title')}>
      <div className="flex flex-col gap-6 pb-6" data-ruqyah-admin>
        {!list.data ? (
          <div aria-busy>
            <SkeletonText lines={8} />
          </div>
        ) : entries.length === 0 ? (
          <EmptyState
            illustration={<ShieldCheckIcon size={48} />}
            title={t('ruqyah.emptyTitle')}
            body={t('ruqyah.emptyBody')}
            action={
              <Button size="lg" leadingIcon={<PlusIcon />} onPress={add}>
                {t('ruqyah.add')}
              </Button>
            }
          />
        ) : (
          <>
            <div className="flex items-center justify-between gap-3">
              <p className="type-callout text-text-secondary">{t('ruqyah.intro')}</p>
              <Tag tone="neutral">{t('ruqyah.count', { count: entries.length, max: RUQYAH_MAX })}</Tag>
            </div>
            {groupByCategory(entries).map((group) => (
              <section
                key={group.category}
                aria-labelledby={`ruqyah-${group.category}`}
                className="flex flex-col gap-3"
              >
                <SectionHeader id={`ruqyah-${group.category}`} title={tc(`ui.ruqyah.category.${group.category}`)} />
                <ReorderList
                  label={tc(`ui.ruqyah.category.${group.category}`)}
                  className="flex flex-col gap-3"
                  items={group.entries}
                  keyOf={(entry) => entry.id}
                  handleLabel={(entry) => t('ruqyah.reorder', { entry: entrySummary(entry) })}
                  onReorder={(from, to) => {
                    const entry = group.entries[from];
                    if (entry) move(entry, from, to);
                  }}
                  renderItem={(entry, index) => (
                    <Card className="flex min-w-0 flex-1 flex-col gap-3" data-ruqyah-row={entry.id}>
                      <div className="flex items-start gap-3">
                        <span aria-hidden className="mt-0.5 text-text-secondary">
                          {SOURCE_ICON[entry.source]}
                        </span>
                        <div className="flex min-w-0 flex-1 flex-col gap-1">
                          <p dir="auto" className="line-clamp-2 type-callout text-text">
                            {entrySummary(entry)}
                          </p>
                          <span className="type-footnote text-text-secondary">
                            {t(`ruqyah.sourceLabel.${entry.source}`)}
                          </span>
                          {entry.source === 'library' && !entry.library ? (
                            <Tag tone="sun" className="self-start">
                              {t('ruqyah.libraryGone')}
                            </Tag>
                          ) : null}
                        </div>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <Button
                          variant="secondary"
                          onPress={() => {
                            navigator.push(`/ruqyah/${entry.id}`);
                          }}
                        >
                          {t('ruqyah.edit')}
                        </Button>
                        <Button
                          variant="outline"
                          disabled={index === 0 || order.isPending}
                          onPress={() => {
                            move(entry, index, index - 1);
                          }}
                        >
                          {t('ruqyah.moveUp')}
                        </Button>
                        <Button
                          variant="outline"
                          disabled={index === group.entries.length - 1 || order.isPending}
                          onPress={() => {
                            move(entry, index, index + 1);
                          }}
                        >
                          {t('ruqyah.moveDown')}
                        </Button>
                        <Button
                          variant="danger"
                          onPress={() => {
                            setDeleting(entry);
                          }}
                        >
                          {t('ruqyah.delete')}
                        </Button>
                      </div>
                    </Card>
                  )}
                />
              </section>
            ))}
            <Button size="lg" variant="outline" fullWidth leadingIcon={<PlusIcon />} disabled={full} onPress={add}>
              {t('ruqyah.add')}
            </Button>
            {full ? <p className="type-footnote text-text-secondary">{t('ruqyah.full', { max: RUQYAH_MAX })}</p> : null}
          </>
        )}
      </div>
      <Dialog
        open={deleting !== null}
        destructive
        loading={remove.isPending}
        onClose={() => {
          setDeleting(null);
        }}
        title={t('ruqyah.deleteTitle')}
        body={t('ruqyah.deleteBody')}
        confirmLabel={t('ruqyah.delete')}
        onConfirm={() => {
          if (!deleting) return;
          remove.mutate(deleting.id, {
            onSuccess: () => {
              setDeleting(null);
              toast.show({ message: t('ruqyah.deleted'), tone: 'success' });
            },
            onError: (error) => {
              setDeleting(null);
              toast.show({ message: errorText(error), tone: 'error' });
            },
          });
        }}
      />
    </Screen>
  );
}
