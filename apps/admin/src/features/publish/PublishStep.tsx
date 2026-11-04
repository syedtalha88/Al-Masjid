// The last step of every publish flow (07 B5–B7): "Notify followers" (on while notifications are left today) and
// Publish; when the day's notifications ran out meanwhile, a dialog offers to publish without notifying. Then the
// check moment with how many people will be told; Done returns to Home.
import { useTranslation } from '@mc/i18n/react';
import type { ItemPublished } from '@mc/shared/contracts';
import { ProblemError } from '@mc/shared/http';
import { PublishBar, PublishSuccess } from '@mc/ui/admin';
import { Dialog, useToast } from '@mc/ui/components';
import { useState } from 'react';

import { useErrorText } from '../auth/hooks/use-session.ts';
import { usePublishItem, useQuota } from './use-publish.ts';

export interface PublishStepProps<Body> {
  readonly masjidId: string | undefined;
  /** The request body with or without notifying; `null` while the draft cannot be published. */
  readonly bodyFor: (notify: boolean) => Body | null;
  readonly send: (masjidId: string, body: Body) => Promise<ItemPublished>;
  readonly onPublished: (published: ItemPublished) => void;
}

export function PublishStep<Body>({ masjidId, bodyFor, send, onPublished }: PublishStepProps<Body>) {
  const { t } = useTranslation('admin');
  const toast = useToast();
  const errorText = useErrorText();
  const quota = useQuota(masjidId);
  const { publish, quotaExceeded } = usePublishItem(masjidId, send);
  const [notifyChoice, setNotifyChoice] = useState(true);

  const left = quota.data ? Math.max(quota.data.limit - quota.data.used, 0) : null;
  const notify = left === 0 ? false : notifyChoice;

  const submit = (withNotify: boolean) => {
    const body = bodyFor(withNotify);
    if (body === null) return;
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
    <>
      <PublishBar
        notify={{
          checked: notify,
          onChange: setNotifyChoice,
          label: t('notice.notify'),
          quota: quota.data && left !== null ? t('notice.quota', { left, limit: quota.data.limit }) : undefined,
          disabled: left === 0,
        }}
        actionLabel={t('notice.publish')}
        disabled={bodyFor(notify) === null}
        busy={publish.isPending}
        onAction={() => {
          submit(notify);
        }}
      />
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
    </>
  );
}

/** The check moment after a publish: how many people will be notified, or that followers will see it in the app. */
export function PublishedMoment({
  published,
  onDone,
}: {
  readonly published: ItemPublished;
  readonly onDone: () => void;
}) {
  const { t } = useTranslation('admin');
  const { notification } = published;
  return (
    <PublishSuccess
      title={t('notice.published')}
      message={
        notification ? t('notice.publishedNotified', { count: notification.targeted }) : t('notice.publishedQuiet')
      }
      doneLabel={t('notice.done')}
      onDone={onDone}
    />
  );
}
