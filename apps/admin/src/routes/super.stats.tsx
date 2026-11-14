import { wallClockInZone } from '@mc/domain/time';
import { NATIVE_NAME } from '@mc/i18n/locales';
import { useLocale, useTranslation } from '@mc/i18n/react';
import type { SuperStats } from '@mc/shared/contracts';
import { Button, Card, EmptyState, ProgressBar, SkeletonText } from '@mc/ui/components';
import { useQuery } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';

import { useErrorText } from '../features/auth/hooks/use-session.ts';
import { superApi } from '../features/super/api/super-api.ts';
import { BarList, TrendLine } from '../features/super/components/StatsCharts.tsx';
import { SuperFrame } from '../features/super/components/SuperFrame.tsx';

export const Route = createFileRoute('/super/stats')({
  component: Stats,
});

/**
 * C12 Stats (07 C12, PHASE_08 T8.10): masjids by status, phones by type / language / notifications, follows, push
 * delivery over 24 hours, deadlines met over 30 days, background jobs, Cloudinary usage, and a 30-day trend — all from
 * the hourly snapshot (aggregates only).
 */
function Stats() {
  const { t } = useTranslation('super');
  const { t: tc } = useTranslation('common');
  const errorText = useErrorText();
  const stats = useQuery({ queryKey: ['super', 'stats'], queryFn: ({ signal }) => superApi.stats(signal) });
  return (
    <SuperFrame title={t('nav.stats')} section="stats">
      {stats.isPending ? (
        <SkeletonText lines={12} />
      ) : stats.isError ? (
        <EmptyState
          title={t('stats.emptyTitle')}
          body={errorText(stats.error)}
          action={
            <Button
              variant="outline"
              onPress={() => {
                void stats.refetch();
              }}
            >
              {tc('appError.retry')}
            </Button>
          }
          className="mt-8"
        />
      ) : stats.data.now && stats.data.at ? (
        <StatsBody at={stats.data.at} now={stats.data.now} trend={stats.data.trend} />
      ) : (
        <EmptyState title={t('stats.emptyTitle')} body={t('stats.emptyBody')} className="mt-8" />
      )}
    </SuperFrame>
  );
}

/** A card's title — wraps instead of truncating (long in Telugu and Hindi). */
function CardTitle({ children }: { readonly children: string }) {
  return <h2 className="type-headline text-text">{children}</h2>;
}

type Now = NonNullable<SuperStats['now']>;
type Tally = Now['sla']['reports'];

function StatsBody({
  at,
  now,
  trend,
}: {
  readonly at: string;
  readonly now: Now;
  readonly trend: SuperStats['trend'];
}) {
  const { t } = useTranslation('super');
  const { format } = useLocale();
  const updated = new Date(at);
  const duration = (seconds: number) =>
    seconds < 120 ? t('stats.seconds', { count: seconds }) : t('stats.minutes', { count: Math.round(seconds / 60) });
  const tallyLine = (tally: Tally) =>
    tally.rate === null
      ? t('stats.noneYet')
      : t('stats.rateLine', { rate: tally.rate, onTime: tally.onTime, late: tally.late });

  return (
    <div className="flex max-w-3xl flex-col gap-6 pb-8">
      <p className="type-footnote text-text-secondary">
        {t('stats.updated', {
          time: `${format.date(updated, 'medium')} ${format.time(wallClockInZone(updated)).text}`,
        })}
      </p>

      <Card className="flex flex-col gap-5">
        <BarList
          title={t('stats.masjids')}
          rows={(['active', 'pending', 'suspended', 'deleted'] as const).map((key) => ({
            key,
            label: t(`stats.status.${key}`),
            value: now.masjids[key],
          }))}
        />
      </Card>

      <Card className="flex flex-col gap-5">
        <CardTitle>{t('stats.devices')}</CardTitle>
        <p className="type-title-3 tabular-nums text-text">{t('stats.devicesTotal', { count: now.devices.total })}</p>
        <BarList
          title={t('stats.platform')}
          rows={(['android', 'ios', 'desktop', 'other'] as const).map((key) => ({
            key,
            label: t(`stats.platformName.${key}`),
            value: now.devices.platform[key],
          }))}
        />
        <BarList
          title={t('stats.language')}
          rows={(['en', 'hi', 'ur', 'te'] as const).map((key) => ({
            key,
            label: NATIVE_NAME[key],
            value: now.devices.locale[key],
          }))}
        />
        <p className="type-callout text-text">
          {`${t('stats.pushOn')}: `}
          <span className="tabular-nums">{format.number(now.devices.push.active)}</span>
        </p>
        <p className="type-callout text-text">
          {`${t('stats.follows')}: `}
          <span className="tabular-nums">{format.number(now.follows)}</span>
        </p>
      </Card>

      <Card className="flex flex-col gap-2">
        <CardTitle>{t('stats.push')}</CardTitle>
        {now.push24h.successRate === null ? (
          <p className="type-callout text-text-secondary">{t('stats.noPush')}</p>
        ) : (
          <>
            <p className="type-title-3 text-text">{t('stats.successRate', { rate: now.push24h.successRate })}</p>
            <p className="type-footnote text-text-secondary">
              {t('stats.pushLine', { sent: now.push24h.sent, failed: now.push24h.failed })}
            </p>
          </>
        )}
      </Card>

      <Card className="flex flex-col gap-3">
        <CardTitle>{t('stats.deadlines')}</CardTitle>
        {(
          [
            ['reports', now.sla.reports],
            ['grievanceAck', now.sla.grievanceAck],
            ['grievanceResolve', now.sla.grievanceResolve],
          ] as const
        ).map(([key, tally]) => (
          <div key={key} className="flex flex-col gap-1">
            <p className="type-subhead-strong text-text">{t(`stats.${key}`)}</p>
            <p className="type-footnote text-text-secondary">{tallyLine(tally)}</p>
            {tally.rate === null ? null : <ProgressBar value={tally.rate} label={t(`stats.${key}`)} />}
          </div>
        ))}
      </Card>

      <Card className="flex flex-col gap-2">
        <CardTitle>{t('stats.jobs')}</CardTitle>
        {now.queues ? (
          <>
            <p className="type-callout text-text">
              {t('stats.jobsLine', {
                waiting: now.queues.waiting,
                active: now.queues.active,
                failed: now.queues.failed,
              })}
            </p>
            <p className="type-footnote text-text-secondary">
              {now.queues.waiting === 0 ? t('stats.lagNone') : t('stats.lag', { time: duration(now.queues.lagS) })}
            </p>
          </>
        ) : (
          <p className="type-callout text-text-secondary">{t('stats.jobsUnknown')}</p>
        )}
      </Card>

      <Card className="flex flex-col gap-2">
        <CardTitle>{t('stats.cloudinary')}</CardTitle>
        {now.cloudinary ? (
          <>
            <p className="type-title-3 text-text">
              {t('stats.cloudinaryUsed', { percent: Math.round(now.cloudinary.usedPercent) })}
            </p>
            <ProgressBar value={now.cloudinary.usedPercent / 100} label={t('stats.cloudinary')} />
            {now.cloudinary.credits ? (
              <p className="type-footnote text-text-secondary">
                {t('stats.credits', { usage: now.cloudinary.credits.usage, limit: now.cloudinary.credits.limit })}
              </p>
            ) : null}
            {now.cloudinary.plan ? (
              <p className="type-footnote text-text-secondary">{t('stats.plan', { plan: now.cloudinary.plan })}</p>
            ) : null}
          </>
        ) : (
          <p className="type-callout text-text-secondary">{t('stats.cloudinaryUnknown')}</p>
        )}
      </Card>

      <Card className="flex flex-col gap-5">
        <CardTitle>{t('stats.trend')}</CardTitle>
        <TrendLine title={t('stats.trendDevices')} points={trend.map((p) => ({ day: p.day, value: p.devices }))} />
        <TrendLine title={t('stats.trendFollows')} points={trend.map((p) => ({ day: p.day, value: p.follows }))} />
        <TrendLine
          title={t('stats.trendMasjids')}
          points={trend.map((p) => ({ day: p.day, value: p.activeMasjids }))}
        />
        <TrendLine title={t('stats.trendPush')} points={trend.map((p) => ({ day: p.day, value: p.pushSent }))} />
      </Card>
    </div>
  );
}
