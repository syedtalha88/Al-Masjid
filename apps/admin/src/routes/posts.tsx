import { useTranslation } from '@mc/i18n/react';
import type { AdminItem } from '@mc/shared/contracts';
import { Button, ChipGroup, Dialog, EmptyState, SkeletonText, useToast } from '@mc/ui/components';
import { ListBulletsIcon } from '@mc/ui/icons';
import { Screen, useNavigator } from '@mc/ui/navigation';
import { createFileRoute } from '@tanstack/react-router';
import { useState } from 'react';

import { useErrorText, useSignedInAdmin } from '../features/auth/hooks/use-session.ts';
import { setDailyDraft } from '../features/daily/lib/draft-store.ts';
import { setDuaDraft } from '../features/dua/lib/draft-store.ts';
import { useMinute } from '../features/home/hooks/use-minute.ts';
import { useSelectedMasjid } from '../features/home/hooks/use-selected-masjid.ts';
import { useNoticeTemplates } from '../features/notice/hooks/use-notice.ts';
import { setNoticeDraft } from '../features/notice/lib/draft-store.ts';
import { PostCard, ViewSheet } from '../features/posts/components/PostParts.tsx';
import { useDeletePost, usePosts } from '../features/posts/hooks/use-posts.ts';
import {
  canDelete,
  canEdit,
  dailyDraftOf,
  duaDraftOf,
  noticeDraftOf,
  POST_TYPES,
  type PostType,
} from '../features/posts/lib/posts.ts';

export const Route = createFileRoute('/posts')({
  component: PostsScreen,
});

/**
 * B12 My Posts (07 B12, PHASE_03 T3.9): type chips; every post with its status; View (the musalli card), Edit (within
 * 24 h — reopens the flow that created it, which then saves instead of publishing) and Delete (confirm; followers stop
 * seeing it at their next poll). Removed posts show the moderation reason.
 */
function PostsScreen() {
  const { t } = useTranslation('admin');
  const { t: tc } = useTranslation();
  const navigator = useNavigator();
  const toast = useToast();
  const errorText = useErrorText();
  const me = useSignedInAdmin();
  const { masjid } = useSelectedMasjid(me.masjids);
  const now = useMinute();
  const [type, setType] = useState<PostType>('all');
  const posts = usePosts(masjid?.id, type);
  const templates = useNoticeTemplates(masjid?.id);
  const remove = useDeletePost(masjid?.id);
  const [viewing, setViewing] = useState<AdminItem | null>(null);
  const [deleting, setDeleting] = useState<AdminItem | null>(null);
  const rows = posts.data?.pages.flatMap((page) => page.items) ?? [];

  const edit = (row: AdminItem) => {
    const notice = noticeDraftOf(row);
    if (notice) {
      setNoticeDraft(notice);
      navigator.push('/notice/fill');
      return;
    }
    const daily = dailyDraftOf(row);
    if (daily) {
      setDailyDraft(daily);
      navigator.push('/daily/note');
      return;
    }
    const dua = duaDraftOf(row);
    if (dua) {
      setDuaDraft(dua);
      navigator.push('/dua/details');
    }
  };

  return (
    <Screen title={t('posts.title')}>
      <div className="flex flex-col gap-4 pb-6">
        <ChipGroup<PostType>
          label={t('posts.filter')}
          value={type}
          onChange={setType}
          chips={POST_TYPES.map((id) => ({ id, label: t(`posts.types.${id}`) }))}
        />
        {posts.isError ? (
          <EmptyState
            title={errorText(posts.error)}
            action={
              <Button
                size="lg"
                onPress={() => {
                  void posts.refetch();
                }}
              >
                {tc('appError.retry')}
              </Button>
            }
          />
        ) : posts.isPending ? (
          <SkeletonText lines={8} />
        ) : rows.length === 0 ? (
          <EmptyState
            illustration={<ListBulletsIcon size={48} />}
            title={t('posts.emptyTitle')}
            body={t('posts.emptyBody')}
            action={
              <Button
                size="lg"
                onPress={() => {
                  navigator.push('/notice');
                }}
              >
                {t('posts.newNotice')}
              </Button>
            }
          />
        ) : (
          <>
            <ul className="flex flex-col gap-3">
              {rows.map((row) => (
                <li key={row.id}>
                  <PostCard
                    row={row}
                    templates={templates.data?.templates}
                    now={now}
                    editable={canEdit(row, now)}
                    deletable={canDelete(row)}
                    onView={() => {
                      setViewing(row);
                    }}
                    onEdit={() => {
                      edit(row);
                    }}
                    onDelete={() => {
                      setDeleting(row);
                    }}
                  />
                </li>
              ))}
            </ul>
            {posts.hasNextPage ? (
              <Button
                variant="outline"
                size="lg"
                fullWidth
                loading={posts.isFetchingNextPage}
                onPress={() => {
                  void posts.fetchNextPage();
                }}
              >
                {t('posts.showMore')}
              </Button>
            ) : null}
          </>
        )}
      </div>
      <ViewSheet
        row={viewing}
        templates={templates.data?.templates}
        now={now}
        onClose={() => {
          setViewing(null);
        }}
      />
      <Dialog
        open={deleting !== null}
        onClose={() => {
          setDeleting(null);
        }}
        title={t('posts.deleteTitle')}
        body={t('posts.deleteBody')}
        confirmLabel={t('posts.delete')}
        destructive
        onConfirm={() => {
          const row = deleting;
          setDeleting(null);
          if (!row) return;
          remove.mutate(row.id, {
            onSuccess: () => {
              toast.show({ message: t('posts.deleted') });
            },
            onError: (error) => {
              toast.show({ message: errorText(error), tone: 'error' });
            },
          });
        }}
      />
    </Screen>
  );
}
