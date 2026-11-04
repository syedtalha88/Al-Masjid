import { useTranslation } from '@mc/i18n/react';
import type { ItemPublished } from '@mc/shared/contracts';
import { ProblemError } from '@mc/shared/http';
import { PublishBar, PublishSuccess, StepHeader } from '@mc/ui/admin';
import { Button, Dialog, EmptyState, useToast } from '@mc/ui/components';
import { Screen, useNavigator } from '@mc/ui/navigation';
import { createFileRoute } from '@tanstack/react-router';
import { useState } from 'react';

import { useErrorText, useSignedInAdmin } from '../features/auth/hooks/use-session.ts';
import { useMinute } from '../features/home/hooks/use-minute.ts';
import { useSelectedMasjid } from '../features/home/hooks/use-selected-masjid.ts';
import { NoticePreview } from '../features/notice/components/NoticeParts.tsx';
import { useNoticeTemplates, usePublishNotice, useQuota } from '../features/notice/hooks/use-notice.ts';
import { setNoticeDraft, useNoticeDraft } from '../features/notice/lib/draft-store.ts';
import { type NoticeDraft, previewItem, publishBody, templateOf } from '../features/notice/lib/notice.ts';

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
  const [published, setPublished] = useState<ItemPublished | null>(null);

  if (published) {
    const { notification } = published;
    return (
      <PublishSuccess
        title={t('notice.published')}
        message={
          notification ? t('notice.publishedNotified', { count: notification.targeted }) : t('notice.publishedQuiet')
        }
        doneLabel={t('notice.done')}
        onDone={() => {
          setNoticeDraft(null);
          navigator.selectTab('home');
        }}
      />
    );
  }
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
  return <PreviewForm draft={draft} onPublished={setPublished} />;
}

function PreviewForm({
  draft,
  onPublished,
}: {
  readonly draft: NoticeDraft;
  readonly onPublished: (published: ItemPublished) => void;
}) {
  const { t } = useTranslation('admin');
  const toast = useToast();
  const errorText = useErrorText();
  const me = useSignedInAdmin();
  const { masjid } = useSelectedMasjid(me.masjids);
  const templates = useNoticeTemplates(masjid?.id);
  const quota = useQuota(masjid?.id);
  const { publish, quotaExceeded } = usePublishNotice(masjid?.id);
  const now = useMinute();
  const [notifyChoice, setNotifyChoice] = useState(true);

  const template = templateOf(draft, templates.data?.templates);
  const left = quota.data ? Math.max(quota.data.limit - quota.data.used, 0) : null;
  const notify = left === 0 ? false : notifyChoice;
  const ready = publishBody(draft, template, notify) !== null;

  const submit = (withNotify: boolean) => {
    const body = publishBody(draft, template, withNotify);
    if (!body) return;
    publish.mutate(body, {
      onSuccess: onPublished,
      onError: (error) => {
        if (!(error instanceof ProblemError && error.problem.code === 'NOTIFY_QUOTA_EXCEEDED')) {
          toast.show({ message: errorText(error), tone: 'error' });
        }
      },
    });
  };

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
        <PublishBar
          notify={{
            checked: notify,
            onChange: setNotifyChoice,
            label: t('notice.notify'),
            quota: quota.data && left !== null ? t('notice.quota', { left, limit: quota.data.limit }) : undefined,
            disabled: left === 0,
          }}
          actionLabel={t('notice.publish')}
          disabled={!ready}
          busy={publish.isPending}
          onAction={() => {
            submit(notify);
          }}
        />
      </div>
      <Dialog
        open={quotaExceeded}
        onClose={() => {
          publish.reset();
        }}
        title={t('notice.quotaTitle')}
        body={t('notice.quotaBody')}
        confirmLabel={t('notice.publishWithout')}
        onConfirm={() => {
          publish.reset();
          submit(false);
        }}
      />
    </Screen>
  );
}
