// The last step of every publish flow (07 B5–B7): "Notify followers" (on while notifications are left today) and
// Publish; when the day's notifications ran out meanwhile, a dialog offers to publish without notifying. Then the
// check moment with how many people will be told; Done returns to Home.
import { useTranslation } from '@mc/i18n/react';
import type { ItemEditBody, ItemPublished } from '@mc/shared/contracts';
import { ProblemError } from '@mc/shared/http';
import { PublishBar, PublishSuccess } from '@mc/ui/admin';
import { Dialog, useToast } from '@mc/ui/components';
import { useState } from 'react';

import { useErrorText } from '../auth/hooks/use-session.ts';
import { useNotifyLine } from './notify-line.ts';
import { type ItemEditing, useEditItem, usePublishItem, useQuota } from './use-publish.ts';

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

  const notifyText = useNotifyLine(quota.data);
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
          quota: notifyText,
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
  onView,
}: {
  readonly published: ItemPublished;
  readonly onDone: () => void;
  /** "View in My Posts" (F50). */
  readonly onView?: () => void;
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
      view={onView ? { label: t('posts.viewPosts'), onPress: onView } : undefined}
    />
  );
}

/**
 * The last step of an edit (B12 → a creation flow, T3.9): "Save changes" — edits never notify (00 §4.3). Someone saved
 * the post meanwhile (412) → a dialog sends the admin back to My Posts; other refusals (e.g. the 24 h are over) are a
 * toast in plain words.
 */
export function SaveStep({
  masjidId,
  editing,
  body,
  onSaved,
  onStale,
}: {
  readonly masjidId: string | undefined;
  readonly editing: ItemEditing;
  /** `null` while the draft cannot be saved. */
  readonly body: ItemEditBody | null;
  readonly onSaved: () => void;
  readonly onStale: () => void;
}) {
  const { t } = useTranslation('admin');
  const toast = useToast();
  const errorText = useErrorText();
  const { save, stale } = useEditItem(masjidId);
  return (
    <>
      <PublishBar
        actionLabel={t('posts.save')}
        disabled={body === null}
        busy={save.isPending}
        onAction={() => {
          if (body === null) return;
          save.mutate(
            { editing, body },
            {
              onSuccess: onSaved,
              onError: (error) => {
                if (!(error instanceof ProblemError && error.problem.code === 'PRECONDITION_FAILED')) {
                  toast.show({ message: errorText(error), tone: 'error' });
                }
              },
            },
          );
        }}
      />
      <Dialog
        open={stale}
        onClose={() => {
          save.reset();
        }}
        title={t('posts.staleTitle')}
        body={t('posts.staleBody')}
        confirmLabel={t('posts.openPosts')}
        onConfirm={() => {
          save.reset();
          onStale();
        }}
      />
    </>
  );
}

/** The check moment after an edit: "Saved" — followers see the change, marked "edited". */
export function SavedMoment({ onDone }: { readonly onDone: () => void }) {
  const { t } = useTranslation('admin');
  return (
    <PublishSuccess
      title={t('posts.saved')}
      message={t('posts.savedBody')}
      doneLabel={t('notice.done')}
      onDone={onDone}
    />
  );
}
