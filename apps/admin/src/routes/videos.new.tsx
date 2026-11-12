import { useLocale, useTranslation } from '@mc/i18n/react';
import type { ItemPublished } from '@mc/shared/contracts';
import { VIDEO_DESCRIPTION_MAX, VIDEO_SPEAKER_MAX, VIDEO_TITLE_MAX } from '@mc/shared/contracts';
import { Button, Checkbox, Image, InfoNote, RadioCardGroup, TextArea, TextField, useToast } from '@mc/ui/components';
import { PlayCircleIcon, WarningIcon } from '@mc/ui/icons';
import { Screen, useNavigator } from '@mc/ui/navigation';
import { createFileRoute } from '@tanstack/react-router';
import { useState } from 'react';

import { useErrorText, useSignedInAdmin } from '../features/auth/hooks/use-session.ts';
import { masjidApi } from '../features/home/api/masjid-api.ts';
import { useSelectedMasjid } from '../features/home/hooks/use-selected-masjid.ts';
import { PublishedMoment, PublishStep } from '../features/publish/PublishStep.tsx';
import { useVideoPreview, useVideoWrites } from '../features/video/hooks/use-videos.ts';
import {
  emptyVideo,
  linkState,
  VIDEO_AUDIENCES,
  type VideoAudience,
  videoBody,
  type VideoDraft,
  videoIssues,
  withPreview,
} from '../features/video/lib/video.ts';

export const Route = createFileRoute('/videos/new')({
  component: NewVideoScreen,
});

/**
 * B10 "Add a bayan" (07 B10, DECISIONS #39, PHASE_06 T6.2): help ("upload to your masjid's YouTube channel, then copy
 * its link") → "Paste link" (reads the clipboard on tap) or type it → instant check on the phone, then the server's
 * preview card (our thumbnail copy, YouTube's title — editable) → speaker / description → audience (3 big cards,
 * required; "Sisters only" shows the Unlisted warning) → ownership tick → "Notify followers" + Publish.
 */
function NewVideoScreen() {
  const { t } = useTranslation('admin');
  const { locale } = useLocale();
  const navigator = useNavigator();
  const toast = useToast();
  const errorText = useErrorText();
  const me = useSignedInAdmin();
  const { masjid } = useSelectedMasjid(me.masjids);
  const preview = useVideoPreview(masjid?.id);
  const { refresh } = useVideoWrites(masjid?.id);
  const [draft, setDraft] = useState<VideoDraft>(emptyVideo);
  const [published, setPublished] = useState<ItemPublished | null>(null);
  const set = (patch: Partial<VideoDraft>) => {
    setDraft((current) => ({ ...current, ...patch }));
  };
  const link = linkState(draft.url);
  const issues = videoIssues(draft);
  const started = draft.url.trim() !== '';
  const previewed = draft.preview !== null && draft.previewFor === draft.url.trim();

  const check = (url: string) => {
    if (linkState(url) !== 'ok') return;
    preview.mutate(url, {
      onSuccess: (result) => {
        setDraft((current) => withPreview(current, url, result));
      },
      onError: (error) => {
        toast.show({ message: errorText(error), tone: 'error' });
      },
    });
  };

  if (published) {
    return (
      <Screen title={t('video.title')}>
        <PublishedMoment
          published={published}
          onDone={() => {
            navigator.back();
          }}
        />
      </Screen>
    );
  }

  return (
    <Screen title={t('video.new')}>
      <div className="flex flex-col gap-6 pb-6" data-video-editor>
        <InfoNote icon={<PlayCircleIcon />}>
          <strong className="block">{t('video.helpTitle')}</strong>
          {t('video.helpBody')}
        </InfoNote>
        <Button
          size="lg"
          fullWidth
          variant="secondary"
          onPress={() => {
            void (async () => {
              try {
                const text = (await readClipboard()).trim();
                set({ url: text });
                check(text);
              } catch {
                toast.show({ message: t('video.pasteFailed'), tone: 'error' });
              }
            })();
          }}
        >
          {t('video.paste')}
        </Button>
        <TextField
          label={t('video.linkLabel')}
          autoComplete="off"
          autoCapitalize="none"
          spellCheck={false}
          inputMode="url"
          dir="ltr"
          maxLength={2048}
          value={draft.url}
          error={link === 'invalid' ? t('video.linkInvalid') : undefined}
          onChange={(event) => {
            set({ url: event.target.value });
          }}
          data-video-link
        />
        {link === 'ok' && !previewed ? (
          <Button
            size="lg"
            fullWidth
            loading={preview.isPending}
            onPress={() => {
              check(draft.url.trim());
            }}
          >
            {preview.isPending ? t('video.checking') : t('video.check')}
          </Button>
        ) : null}

        {draft.preview && previewed ? (
          <section className="flex flex-col gap-3" aria-labelledby="video-preview" data-video-preview>
            <h2 id="video-preview" className="type-headline text-text">
              {t('video.previewTitle')}
            </h2>
            <div className="flex flex-col gap-2 rounded-md bg-surface p-3 shadow-e1">
              <Image src={draft.preview.thumbnail} alt="" ratio="16/9" rounded="rounded-md" />
              <p className="type-caption text-text-secondary">{t('video.playsFromYouTube')}</p>
            </div>
            <TextField
              label={t('video.titleLabel')}
              dir="auto"
              maxLength={VIDEO_TITLE_MAX}
              value={draft.title}
              onChange={(event) => {
                set({ title: event.target.value });
              }}
            />
            <TextField
              label={t('video.speaker')}
              optional
              dir="auto"
              maxLength={VIDEO_SPEAKER_MAX}
              value={draft.speaker}
              onChange={(event) => {
                set({ speaker: event.target.value });
              }}
            />
            <TextArea
              label={t('video.description')}
              optional
              dir="auto"
              maxLength={VIDEO_DESCRIPTION_MAX}
              value={draft.description}
              onChange={(event) => {
                set({ description: event.target.value });
              }}
            />
          </section>
        ) : null}

        {previewed ? (
          <>
            <RadioCardGroup<VideoAudience>
              legend={t('video.audienceQuestion')}
              name="video-audience"
              options={VIDEO_AUDIENCES.map((audience) => ({ value: audience, title: t(`video.audience.${audience}`) }))}
              value={draft.audience}
              onChange={(audience) => {
                set({ audience });
              }}
            />
            {draft.audience === 'sisters' ? (
              <div data-video-sisters-warning>
                <InfoNote icon={<WarningIcon />}>{t('video.sistersWarning')}</InfoNote>
              </div>
            ) : null}
            <Checkbox
              checked={draft.rights}
              onChange={(rights) => {
                set({ rights });
              }}
              label={t('video.rights')}
              description={t('video.rightsHint')}
            />
          </>
        ) : null}

        {issues.length > 0 && started ? (
          <p className="type-footnote text-text-secondary" aria-live="polite" data-video-missing>
            {t('video.missing', { fields: issues.map((issue) => t(`video.issue.${issue}`)).join(', ') })}
          </p>
        ) : null}
        <PublishStep
          masjidId={masjid?.id}
          bodyFor={(notify) => videoBody(draft, locale, notify)}
          send={masjidApi.publishVideo}
          onPublished={(result) => {
            void refresh();
            setPublished(result);
          }}
        />
      </div>
    </Screen>
  );
}

/** The copied text ("Paste link"): the browser asks for permission on first use; refusal → the toast above. */
function readClipboard(): Promise<string> {
  return navigator.clipboard.readText();
}
