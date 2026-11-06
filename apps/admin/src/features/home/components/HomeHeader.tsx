import { Time, useLocale, useTranslation } from '@mc/i18n/react';
import type { AdminSchedule } from '@mc/shared/contracts';
import { Button, Card, Skeleton } from '@mc/ui/components';
import { ClockIcon } from '@mc/ui/icons';
import { useMemo } from 'react';

import { todayStrip } from '../lib/today.ts';

/** "1,240 followers" (07 B3 header). */
export function FollowersChip({ followers }: { readonly followers: number | undefined }) {
  const { t } = useTranslation('admin');
  if (followers === undefined) return <Skeleton className="h-8 w-32 self-start rounded-full" />;
  return (
    <span className="inline-flex min-h-8 items-center self-start rounded-full bg-mint-100 px-3 type-subhead-strong text-primary-800">
      {t('home.followers', { count: followers })}
    </span>
  );
}

/**
 * Today strip (07 B3): the next jamaat as the masjid's followers see it (same domain calculation), with a button to the
 * timings editor — or, before any timings were saved, a call to set them.
 */
export function TodayStrip({
  schedule,
  now,
  onEdit,
}: {
  readonly schedule: AdminSchedule | undefined;
  readonly now: Date;
  readonly onEdit: () => void;
}) {
  const { t } = useTranslation(['admin', 'common']);
  const strip = useMemo(() => (schedule ? todayStrip(schedule, now) : undefined), [schedule, now]);
  if (!strip) return <Skeleton className="h-28 w-full rounded-lg" />;
  return (
    <Card variant="mint" className="flex flex-col gap-3">
      <div className="flex items-center gap-3">
        <ClockIcon size={28} className="shrink-0 text-primary-700" />
        {strip.kind === 'next' ? (
          <p className="flex flex-col">
            <span className="type-footnote text-text-secondary">
              {t('home.today.nextJamaat')}
              {strip.tomorrow ? ` · ${t('home.today.tomorrow')}` : ''}
            </span>
            <span className="type-title2 text-text">
              {t(`common:prayer.${strip.prayer}`)} · <Time value={strip.time} />
            </span>
          </p>
        ) : (
          <p className="type-body text-text">
            {strip.kind === 'unset' ? t('home.today.unset') : t('home.today.noJamaat')}
          </p>
        )}
      </div>
      <Button variant={strip.kind === 'unset' ? 'primary' : 'outline'} fullWidth onPress={onEdit}>
        {strip.kind === 'unset' ? t('home.today.set') : t('home.today.edit')}
      </Button>
    </Card>
  );
}

/** "Notifications today: 2 of 8 used" (07 B3 bottom). */
export function QuotaPill({ used, limit }: { readonly used: number; readonly limit: number }) {
  const { t } = useTranslation('admin');
  const { format } = useLocale();
  return (
    <p className="mx-auto w-fit rounded-full bg-surface-muted px-4 py-2 text-center type-footnote text-text-secondary">
      {t('home.quota', { used: format.number(used), limit: format.number(limit) })}
    </p>
  );
}
