import { formatters } from '@mc/i18n/format';
import { useLocale, useTranslation } from '@mc/i18n/react';
import { type AdminVideo, VIDEO_DESCRIPTION_MAX, VIDEO_SPEAKER_MAX, VIDEO_TITLE_MAX } from '@mc/shared/contracts';
import {
  Button,
  Dialog,
  EmptyState,
  Image,
  Sheet,
  SkeletonText,
  Tag,
  TextArea,
  TextField,
  useToast,
} from '@mc/ui/components';
import { PlayCircleIcon, PlusIcon } from '@mc/ui/icons';
import { Screen, useNavigator } from '@mc/ui/navigation';
import { createFileRoute } from '@tanstack/react-router';
import { useState } from 'react';

import { useErrorText, useSignedInAdmin } from '../features/auth/hooks/use-session.ts';
import { useMinute } from '../features/home/hooks/use-minute.ts';
import { useSelectedMasjid } from '../features/home/hooks/use-selected-masjid.ts';
import { useVideos, useVideoWrites } from '../features/video/hooks/use-videos.ts';
import { editableUntil } from '../features/video/lib/video.ts';

export const Route = createFileRoute('/videos/')({
  component: VideosScreen,
});

const STATUS_TONE = { published: 'primary', removed: 'danger', deleted: 'neutral' } as const;
const AUDIENCE_TONE = { everyone: 'neutral', brothers: 'info', sisters: 'rose' } as const;

/**
 * B10 Bayan Video — the list (07 B10, DECISIONS #39, PHASE_06 T6.2): the masjid's bayans with our own thumbnail copy,
 * audience and status (Published / Removed by moderation / Deleted); Edit (texts, within 24 h) and Delete; "Add a
 * bayan" opens the paste-a-link flow.
 */
function VideosScreen() {
  const { t } = useTranslation('admin');
  const { t: tc } = useTranslation();
  const navigator = useNavigator();
  const errorText = useErrorText();
  const me = useSignedInAdmin();
  const { masjid } = useSelectedMasjid(me.masjids);
  const list = useVideos(masjid?.id);
  const videos = list.data?.videos ?? [];

  return (
    <Screen title={t('video.title')}>
      <div className="flex flex-col gap-4 pb-6" data-videos>
        <Button
          size="lg"
          fullWidth
          leadingIcon={<PlusIcon />}
          onPress={() => {
            navigator.push('/videos/new');
          }}
        >
          {t('video.new')}
        </Button>
        {list.isError ? (
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
        ) : !list.data ? (
          <div aria-busy>
            <SkeletonText lines={6} />
          </div>
        ) : videos.length === 0 ? (
          <EmptyState
            className="mt-4"
            illustration={<PlayCircleIcon size={40} />}
            title={t('video.empty')}
            body={t('video.emptyBody')}
          />
        ) : (
          <ul className="flex flex-col gap-4">
            {videos.map((video) => (
              <li key={video.id}>
                <VideoRow masjidId={masjid?.id} video={video} />
              </li>
            ))}
          </ul>
        )}
      </div>
    </Screen>
  );
}

function VideoRow({ masjidId, video }: { readonly masjidId: string | undefined; readonly video: AdminVideo }) {
  const { t } = useTranslation('admin');
  const { locale } = useLocale();
  const format = formatters(locale);
  const toast = useToast();
  const errorText = useErrorText();
  const now = useMinute();
  const { edit, remove } = useVideoWrites(masjidId);
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [title, setTitle] = useState(video.title);
  const [speaker, setSpeaker] = useState(video.speaker ?? '');
  const [description, setDescription] = useState(video.description ?? '');
  const published = video.status === 'published';
  const canEdit = published && now.getTime() < editableUntil(video.publishedAt).getTime();

  return (
    <article className="flex flex-col gap-3 rounded-md bg-surface p-4 shadow-e1" data-video={video.id}>
      <Image src={video.thumb.url ?? null} thumbhash={video.thumb.thumbhash} alt="" ratio="16/9" rounded="rounded-md" />
      <div className="flex flex-wrap items-center gap-2">
        <Tag tone={STATUS_TONE[video.status]}>{t(`video.status.${video.status}`)}</Tag>
        <Tag tone={AUDIENCE_TONE[video.audience]}>{t(`video.audience.${video.audience}`)}</Tag>
      </div>
      <h2 className="type-headline text-text" dir="auto">
        {video.title}
      </h2>
      <p className="type-footnote text-text-secondary">
        {video.speaker ? (
          <>
            <bdi dir="auto">{video.speaker}</bdi>
            {' · '}
          </>
        ) : null}
        {format.date(new Date(video.publishedAt), 'medium')}
      </p>
      {published ? (
        <div className="flex gap-3">
          {canEdit ? (
            <Button
              variant="secondary"
              size="lg"
              className="flex-1"
              onPress={() => {
                setTitle(video.title);
                setSpeaker(video.speaker ?? '');
                setDescription(video.description ?? '');
                setEditing(true);
              }}
            >
              {t('video.edit')}
            </Button>
          ) : null}
          <Button
            variant="outline"
            size="lg"
            className="flex-1"
            onPress={() => {
              setDeleting(true);
            }}
          >
            {t('video.delete')}
          </Button>
        </div>
      ) : null}

      <Sheet
        open={editing}
        onClose={() => {
          setEditing(false);
        }}
        title={t('video.editTitle')}
        footer={
          <Button
            size="lg"
            fullWidth
            loading={edit.isPending}
            disabled={title.trim() === ''}
            onPress={() => {
              edit.mutate(
                {
                  videoId: video.id,
                  updatedAt: video.updatedAt,
                  body: {
                    title: title.trim(),
                    ...(speaker.trim() === '' ? {} : { speaker: speaker.trim() }),
                    ...(description.trim() === '' ? {} : { description: description.trim() }),
                  },
                },
                {
                  onSuccess: () => {
                    setEditing(false);
                    toast.show({ message: t('video.saved'), tone: 'success' });
                  },
                  onError: (error) => {
                    toast.show({ message: errorText(error), tone: 'error' });
                  },
                },
              );
            }}
          >
            {t('video.save')}
          </Button>
        }
      >
        <div className="flex flex-col gap-4 pb-2" data-video-edit>
          <p className="type-footnote text-text-secondary">{t('video.editHint')}</p>
          <TextField
            label={t('video.titleLabel')}
            dir="auto"
            maxLength={VIDEO_TITLE_MAX}
            value={title}
            onChange={(event) => {
              setTitle(event.target.value);
            }}
          />
          <TextField
            label={t('video.speaker')}
            optional
            dir="auto"
            maxLength={VIDEO_SPEAKER_MAX}
            value={speaker}
            onChange={(event) => {
              setSpeaker(event.target.value);
            }}
          />
          <TextArea
            label={t('video.description')}
            optional
            dir="auto"
            maxLength={VIDEO_DESCRIPTION_MAX}
            value={description}
            onChange={(event) => {
              setDescription(event.target.value);
            }}
          />
        </div>
      </Sheet>

      <Dialog
        open={deleting}
        loading={remove.isPending}
        onClose={() => {
          setDeleting(false);
        }}
        title={t('video.deleteTitle')}
        body={t('video.deleteBody')}
        confirmLabel={t('video.delete')}
        destructive
        onConfirm={() => {
          remove.mutate(video.id, {
            onSuccess: () => {
              setDeleting(false);
              toast.show({ message: t('video.deleted'), tone: 'success' });
            },
            onError: (error) => {
              setDeleting(false);
              toast.show({ message: errorText(error), tone: 'error' });
            },
          });
        }}
      />
    </article>
  );
}
