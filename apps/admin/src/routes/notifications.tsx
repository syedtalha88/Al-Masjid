import { useLocale, useTranslation } from '@mc/i18n/react';
import type { NoticeTemplate, NotificationJobList } from '@mc/shared/contracts';
import { Button, Card, EmptyState, IconCircle, SkeletonText, Tag, type Tone } from '@mc/ui/components';
import { BellIcon } from '@mc/ui/icons';
import { Screen } from '@mc/ui/navigation';
import { createFileRoute } from '@tanstack/react-router';

import { useErrorText, useSignedInAdmin } from '../features/auth/hooks/use-session.ts';
import { useMinute } from '../features/home/hooks/use-minute.ts';
import { useSelectedMasjid } from '../features/home/hooks/use-selected-masjid.ts';
import { useNoticeTemplates } from '../features/notice/hooks/use-notice.ts';
import { useNotificationJobs } from '../features/notifications/use-notification-jobs.ts';
import { POST_TYPES } from '../features/posts/lib/posts.ts';

export const Route = createFileRoute('/notifications')({
  component: NotificationsScreen,
});

type Job = NotificationJobList['jobs'][number];

const STATUS_TONE: Readonly<Record<Job['status'], Tone>> = {
  pending: 'sun',
  running: 'info',
  completed: 'primary',
  failed: 'danger',
};

/**
 * Notification history (07 B3 quota pill → here, PHASE_04 T4.5): every notification of the masjid, newest first — its
 * post, when, for whom, and how many phones it reached; waiting and sending ones refresh by themselves.
 */
function NotificationsScreen() {
  const { t } = useTranslation('admin');
  const { t: tc } = useTranslation();
  const errorText = useErrorText();
  const me = useSignedInAdmin();
  const { masjid } = useSelectedMasjid(me.masjids);
  const jobs = useNotificationJobs(masjid?.id);
  const templates = useNoticeTemplates(masjid?.id);
  const rows = jobs.data?.pages.flatMap((page) => page.jobs) ?? [];

  return (
    <Screen title={t('push.history')}>
      <div className="flex flex-col gap-4 pb-6">
        {jobs.isError ? (
          <EmptyState
            title={errorText(jobs.error)}
            action={
              <Button
                size="lg"
                onPress={() => {
                  void jobs.refetch();
                }}
              >
                {tc('appError.retry')}
              </Button>
            }
          />
        ) : jobs.isPending ? (
          <SkeletonText lines={8} />
        ) : rows.length === 0 ? (
          <EmptyState illustration={<BellIcon size={48} />} title={t('push.history')} body={t('push.historyEmpty')} />
        ) : (
          <>
            <ul className="flex flex-col gap-3">
              {rows.map((job) => (
                <li key={job.id}>
                  <JobCard job={job} templates={templates.data?.templates} />
                </li>
              ))}
            </ul>
            {jobs.hasNextPage ? (
              <Button
                variant="secondary"
                fullWidth
                loading={jobs.isFetchingNextPage}
                onPress={() => {
                  void jobs.fetchNextPage();
                }}
              >
                {t('posts.showMore')}
              </Button>
            ) : null}
          </>
        )}
      </div>
    </Screen>
  );
}

function JobCard({ job, templates }: { readonly job: Job; readonly templates: readonly NoticeTemplate[] | undefined }) {
  const { t } = useTranslation('admin');
  const { locale, format } = useLocale();
  const now = useMinute();
  const type = POST_TYPES.find((entry) => entry === job.item?.type) ?? 'all';
  const template = job.item?.templateKey ? templates?.find((entry) => entry.key === job.item?.templateKey) : undefined;
  const title =
    job.item === undefined || job.item.status === 'removed'
      ? t('push.removedPost')
      : (job.item.title ?? (template ? template.title[locale] || template.title.en : t(`posts.types.${type}`)));
  return (
    <Card className="flex items-start gap-3" data-job={job.id} data-status={job.status}>
      <IconCircle size={44} tone="sun">
        <BellIcon />
      </IconCircle>
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <p dir="auto" className="line-clamp-2 type-headline text-text">
          {title}
        </p>
        <p className="flex flex-wrap items-center gap-2 type-caption text-text-tertiary">
          <Tag tone={STATUS_TONE[job.status]}>{t(`push.status.${job.status}`)}</Tag>
          <span>{format.relative(new Date(job.createdAt), now)}</span>
          <span>· {t(`push.audience.${job.audience}`)}</span>
        </p>
        <p className="type-footnote text-text-secondary">
          {job.status === 'pending' || job.status === 'running'
            ? t('push.targeted', { count: job.targeted })
            : t('push.counts', { sent: job.sent, failed: job.failed })}
        </p>
      </div>
    </Card>
  );
}
