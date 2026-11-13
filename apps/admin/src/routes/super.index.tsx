import { useLocale, useTranslation } from '@mc/i18n/react';
import { slaProgress } from '@mc/shared/compliance';
import { Button, Card, InfoNote, ListRow, SectionHeader, SkeletonText, Tag } from '@mc/ui/components';
import { MasjidTile, WarningIcon } from '@mc/ui/icons';
import { useNavigator } from '@mc/ui/navigation';
import { useQuery } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';

import { superApi } from '../features/super/api/super-api.ts';
import { StatusTag, SUPER_SECTIONS, SuperFrame } from '../features/super/components/SuperFrame.tsx';

export const Route = createFileRoute('/super/')({
  component: Dashboard,
});

const COUNTS = ['pending', 'active', 'suspended', 'deleted'] as const;
const SLA_KIND_KEY = {
  urgent_report: 'dashboard.slaUrgentReport',
  report: 'dashboard.slaReport',
  grievance_ack: 'dashboard.slaGrievanceAck',
  grievance_resolve: 'dashboard.slaGrievanceResolve',
} as const;

/**
 * C1 Dashboard: the push kill-switch banner and 24-hour delivery (T4.5, T4.7), masjid counts and pending activations;
 * the SLA card (open report timers, earliest due first — PHASE_08 T8.3).
 */
function Dashboard() {
  const { t: ta } = useTranslation('admin');
  const { t } = useTranslation('super');
  const { format } = useLocale();
  const navigator = useNavigator();
  const dashboard = useQuery({ queryKey: ['super', 'dashboard'], queryFn: ({ signal }) => superApi.dashboard(signal) });

  return (
    <SuperFrame title={ta('home.superAdmin')} section="dashboard">
      <ul className="mb-6 flex flex-col divide-y divide-border rounded-md bg-surface shadow-e1 lg:hidden">
        {SUPER_SECTIONS.filter((s) => s.key !== 'dashboard').map((s) => (
          <li key={s.key}>
            <ListRow
              className="px-4"
              title={t(`nav.${s.key}`)}
              chevron
              onPress={() => {
                navigator.push(s.path);
              }}
            />
          </li>
        ))}
      </ul>

      {dashboard.data?.push.paused ? (
        // T4.7: the kill switch is on — a banner until it is resumed in Settings.
        <div
          role="status"
          className="mb-6 flex flex-wrap items-center gap-3 rounded-md bg-danger-bg p-4 type-callout text-danger"
        >
          <WarningIcon size={20} className="shrink-0" />
          <p className="min-w-0 flex-1">{t('push.pausedBanner')}</p>
          <Button
            variant="outline"
            size="md"
            onPress={() => {
              navigator.push('/super/settings');
            }}
          >
            {t('push.resume')}
          </Button>
        </div>
      ) : null}

      {dashboard.data && dashboard.data.passkeyAlerts > 0 ? (
        // 04 §3: a passkey whose sign counter went backwards was revoked (possible clone); Super Admins also get a push
        // alert (T4.6).
        <div role="status" className="mb-6 flex items-start gap-3 rounded-md bg-danger-bg p-4 type-callout text-danger">
          <WarningIcon size={20} className="mt-px shrink-0" />
          <p className="min-w-0">{t('dashboard.passkeyAlert', { count: dashboard.data.passkeyAlerts })}</p>
        </div>
      ) : null}

      {dashboard.data && dashboard.data.sla.length > 0 ? (
        // C1 / 05 §3: open timers, earliest due first; red with under 20 % of the time left (PHASE_08 T8.3).
        <section className="mb-6 flex flex-col gap-3" data-sla-card>
          <SectionHeader title={t('dashboard.sla')} />
          <ul className="flex flex-col divide-y divide-border rounded-md bg-surface shadow-e1">
            {dashboard.data.sla.map((timer) => {
              const now = new Date();
              const progress = slaProgress(new Date(timer.startAt), new Date(timer.dueAt), now);
              const when = format.relative(new Date(timer.dueAt), now);
              return (
                <li key={timer.id} data-sla-row={timer.id} data-red={progress.red ? 'true' : 'false'}>
                  <ListRow
                    className="px-4"
                    title={t(SLA_KIND_KEY[timer.kind])}
                    subtitle={t(progress.overdue ? 'reports.overdue' : 'reports.due', { when })}
                    trailing={progress.red ? <Tag tone="danger">{t('dashboard.slaRed')}</Tag> : undefined}
                    chevron
                    onPress={() => {
                      navigator.push(timer.kind.startsWith('grievance') ? '/super/grievances' : '/super/reports');
                    }}
                  />
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}

      <section className="flex flex-col gap-3">
        <SectionHeader title={t('dashboard.counts')} />
        {dashboard.data ? (
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {COUNTS.map((status) => (
              <li key={status}>
                <Card className="flex flex-col items-start gap-2">
                  <span className="type-amount-large text-text">{format.number(dashboard.data.counts[status])}</span>
                  <StatusTag status={status} />
                </Card>
              </li>
            ))}
          </ul>
        ) : (
          <SkeletonText lines={2} />
        )}
      </section>

      {dashboard.data ? (
        // T5.6: donation campaigns running right now, across all masjids.
        <Card className="mt-3 flex items-center gap-3" data-active-campaigns>
          <span className="type-amount-large text-text">{format.number(dashboard.data.activeCampaigns)}</span>
          <span className="type-callout text-text-secondary">{t('dashboard.campaigns')}</span>
        </Card>
      ) : null}

      <section className="mt-8 flex flex-col gap-3" data-push-stats>
        <SectionHeader title={t('push.stats')} />
        {dashboard.data ? (
          <Card className="flex flex-col gap-1">
            <span className="type-headline text-text">
              {dashboard.data.push.successRate === null
                ? t('push.rateNone')
                : t('push.rate', { rate: dashboard.data.push.successRate })}
            </span>
            <span className="type-callout text-text-secondary">
              {t('push.statsLine', {
                sent: dashboard.data.push.sent,
                failed: dashboard.data.push.failed,
                pruned: dashboard.data.push.pruned,
              })}
            </span>
            <span className="type-footnote text-text-tertiary">
              {t('push.jobs', {
                jobs: dashboard.data.push.jobs,
                running: dashboard.data.push.running,
                failedJobs: dashboard.data.push.failedJobs,
              })}
            </span>
          </Card>
        ) : (
          <SkeletonText lines={2} />
        )}
      </section>

      <section className="mt-8 flex flex-col gap-3">
        <SectionHeader title={t('dashboard.pending')} />
        {dashboard.data ? (
          dashboard.data.pending.length > 0 ? (
            <ul className="flex flex-col divide-y divide-border rounded-md bg-surface shadow-e1">
              {dashboard.data.pending.map((m) => (
                <li key={m.id}>
                  <ListRow
                    className="px-4"
                    leading={<MasjidTile />}
                    title={<span dir="auto">{m.name}</span>}
                    subtitle={[m.area, m.city].filter(Boolean).join(', ')}
                    meta={t('masjids.admins', { count: m.adminCount })}
                    chevron
                    onPress={() => {
                      navigator.push(`/super/masjids/${m.id}`);
                    }}
                  />
                </li>
              ))}
            </ul>
          ) : (
            <InfoNote>{t('dashboard.noPending')}</InfoNote>
          )
        ) : (
          <SkeletonText lines={3} />
        )}
      </section>

      <section className="mt-8 flex flex-col gap-3" data-change-requests>
        <SectionHeader title={t('dashboard.changeRequests')} />
        {dashboard.data ? (
          dashboard.data.changeRequests.length > 0 ? (
            <ul className="flex flex-col divide-y divide-border rounded-md bg-surface shadow-e1">
              {dashboard.data.changeRequests.map((request) => (
                <li key={request.id}>
                  <ListRow
                    className="px-4"
                    leading={<MasjidTile />}
                    title={<span dir="auto">{request.masjidName}</span>}
                    subtitle={<span dir="auto">{request.note}</span>}
                    subtitleLines={3}
                    meta={format.date(new Date(request.at), 'medium')}
                    chevron
                    onPress={() => {
                      navigator.push(`/super/masjids/${request.masjidId}`);
                    }}
                  />
                </li>
              ))}
            </ul>
          ) : (
            <InfoNote>{t('dashboard.noChangeRequests')}</InfoNote>
          )
        ) : (
          <SkeletonText lines={3} />
        )}
      </section>
    </SuperFrame>
  );
}
