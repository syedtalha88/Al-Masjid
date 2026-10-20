import { useLocale, useTranslation } from '@mc/i18n/react';
import { Card, InfoNote, ListRow, SectionHeader, SkeletonText } from '@mc/ui/components';
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

/** C1 Dashboard (Phase 1 part): masjid counts and pending activations; SLA cards arrive with moderation (Phase 8). */
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

      {dashboard.data && dashboard.data.passkeyAlerts > 0 ? (
        // 04 §3: a passkey whose sign counter went backwards was revoked (possible clone) — the push alert is Phase 4.
        <div role="status" className="mb-6 flex items-start gap-3 rounded-md bg-danger-bg p-4 type-callout text-danger">
          <WarningIcon size={20} className="mt-px shrink-0" />
          <p className="min-w-0">{t('dashboard.passkeyAlert', { count: dashboard.data.passkeyAlerts })}</p>
        </div>
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
    </SuperFrame>
  );
}
