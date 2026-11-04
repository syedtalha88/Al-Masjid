import { useTranslation } from '@mc/i18n/react';
import type { ItemPublished } from '@mc/shared/contracts';
import { StepHeader } from '@mc/ui/admin';
import { Button, EmptyState } from '@mc/ui/components';
import { Screen, useNavigator } from '@mc/ui/navigation';
import { createFileRoute } from '@tanstack/react-router';
import { useState } from 'react';

import { useSignedInAdmin } from '../features/auth/hooks/use-session.ts';
import { masjidApi } from '../features/home/api/masjid-api.ts';
import { useMinute } from '../features/home/hooks/use-minute.ts';
import { useSelectedMasjid } from '../features/home/hooks/use-selected-masjid.ts';
import { NoticePreview } from '../features/notice/components/NoticeParts.tsx';
import { useNoticeTemplates } from '../features/notice/hooks/use-notice.ts';
import { setNoticeDraft, useNoticeDraft } from '../features/notice/lib/draft-store.ts';
import { type NoticeDraft, previewItem, publishBody, templateOf } from '../features/notice/lib/notice.ts';
import { useOpenPosts } from '../features/posts/hooks/use-open-posts.ts';
import { noticeEditBody } from '../features/posts/lib/posts.ts';
import { PublishedMoment, PublishStep, SavedMoment, SaveStep } from '../features/publish/PublishStep.tsx';

export const Route = createFileRoute('/notice/preview')({
  component: PreviewNoticeScreen,
});

/**
 * B5 step 3 — Preview & Publish (07 B5): the notice as musallis will see it, in each language, then "Notify followers"
 * (on while notifications are left today) and Publish. Success: the check moment with how many people will be told;
 * Done returns to Home.
 */
function PreviewNoticeScreen() {
  const { t } = useTranslation('admin');
  const navigator = useNavigator();
  const draft = useNoticeDraft();
  const openPosts = useOpenPosts();
  const [published, setPublished] = useState<ItemPublished | null>(null);
  const [saved, setSaved] = useState(false);
  const leaveTo = (next: () => void) => () => {
    setNoticeDraft(null);
    next();
  };

  if (published) {
    return (
      <PublishedMoment
        published={published}
        onDone={leaveTo(() => {
          navigator.selectTab('home');
        })}
        onView={leaveTo(openPosts)}
      />
    );
  }
  if (saved) return <SavedMoment onDone={leaveTo(openPosts)} />;
  if (!draft) {
    return (
      <Screen title={t('notice.title')}>
        <EmptyState
          className="mt-8"
          title={t('notice.lostTitle')}
          body={t('notice.lostBody')}
          action={
            <Button
              size="lg"
              onPress={() => {
                navigator.replace('/notice');
              }}
            >
              {t('notice.startAgain')}
            </Button>
          }
        />
      </Screen>
    );
  }
  return (
    <PreviewForm
      draft={draft}
      onPublished={setPublished}
      onSaved={() => {
        setSaved(true);
      }}
      onStale={leaveTo(openPosts)}
    />
  );
}

function PreviewForm({
  draft,
  onPublished,
  onSaved,
  onStale,
}: {
  readonly draft: NoticeDraft;
  readonly onPublished: (published: ItemPublished) => void;
  readonly onSaved: () => void;
  readonly onStale: () => void;
}) {
  const { t } = useTranslation('admin');
  const me = useSignedInAdmin();
  const { masjid } = useSelectedMasjid(me.masjids);
  const templates = useNoticeTemplates(masjid?.id);
  const now = useMinute();
  const template = templateOf(draft, templates.data?.templates);

  return (
    <Screen title={t('notice.title')}>
      <div className="flex flex-col gap-6">
        <StepHeader step={3} total={3} label={t('notice.step', { n: 3, total: 3 })} title={t('notice.previewTitle')} />
        <NoticePreview
          item={previewItem(draft, masjid?.id ?? '', now)}
          templates={templates.data?.templates}
          now={now}
          hasPhoto={draft.photo !== null}
        />
        {draft.editing ? (
          <SaveStep
            masjidId={masjid?.id}
            editing={draft.editing}
            body={noticeEditBody(draft, template)}
            onSaved={onSaved}
            onStale={onStale}
          />
        ) : (
          <PublishStep
            masjidId={masjid?.id}
            bodyFor={(notify) => publishBody(draft, template, notify)}
            send={masjidApi.publishAnnouncement}
            onPublished={onPublished}
          />
        )}
      </div>
    </Screen>
  );
}
