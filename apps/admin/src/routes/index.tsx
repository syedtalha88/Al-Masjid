import { useTranslation } from '@mc/i18n/react';
import { AdminTile } from '@mc/ui/admin';
import { EmptyState, IconButton, RadioCardGroup, Sheet } from '@mc/ui/components';
import { CaretDownIcon, MasjidTile, ShieldCheckIcon, UserCircleIcon } from '@mc/ui/icons';
import { Pressable } from '@mc/ui/motion';
import { Screen, useNavigator } from '@mc/ui/navigation';
import { createFileRoute } from '@tanstack/react-router';
import { useState } from 'react';

import { SHOW_COMING_SOON } from '../app/build.ts';
import { useSignedInAdmin } from '../features/auth/hooks/use-session.ts';
import { FollowersChip, QuotaPill, TodayStrip } from '../features/home/components/HomeHeader.tsx';
import { useMasjidHome } from '../features/home/hooks/use-masjid-home.ts';
import { useMinute } from '../features/home/hooks/use-minute.ts';
import { useSelectedMasjid } from '../features/home/hooks/use-selected-masjid.ts';
import { TILES, visibleTiles } from '../features/home/tiles.tsx';

const SHOWN = visibleTiles(SHOW_COMING_SOON);
const PRAYER_TIMES = TILES.find((tile) => tile.key === 'prayerTimes');

export const Route = createFileRoute('/')({
  component: Home,
});

/**
 * B3 Admin Home: the masjid (switcher when the admin has several) with its followers, the today strip (next jamaat,
 * edit timings), the tiles in their final order — a tile opens its screen once its task has landed, else "Coming soon";
 * later phases' tiles exist in dev/staging builds only — today's notification quota, and the account button. Super
 * Admins also get their console here. (Inbox banner: Phase 8 moderation notices / Phase 5 payment status.)
 */
function Home() {
  const { t } = useTranslation('admin');
  const navigator = useNavigator();
  const me = useSignedInAdmin();
  const { masjid, select } = useSelectedMasjid(me.masjids);
  const [switching, setSwitching] = useState(false);
  const several = me.masjids.length > 1;
  const isSuper = me.admin.role === 'super_admin';
  const now = useMinute();
  const { stats, quota, schedule } = useMasjidHome(masjid?.id);
  const open = (route: string | null, key: string) => {
    navigator.push(route ?? `/soon/${key}`);
  };

  return (
    <Screen
      title={masjid?.name ?? t('home.title')}
      variant="large"
      actions={
        <IconButton
          label={t('home.account')}
          icon={<UserCircleIcon size={28} />}
          onPress={() => {
            navigator.push('/account');
          }}
        />
      }
      {...(several
        ? {
            lead: (
              <Pressable
                kind="button"
                onPress={() => {
                  setSwitching(true);
                }}
                className="-ms-2 inline-flex min-h-14 items-center gap-1 rounded-full px-2 type-subhead-strong text-primary-700"
              >
                {t('home.switchMasjid')}
                <CaretDownIcon size={18} />
              </Pressable>
            ),
          }
        : {})}
    >
      {isSuper ? (
        <div className="mb-4">
          <AdminTile
            icon={<ShieldCheckIcon size={28} />}
            tone="primary"
            label={t('home.superAdmin')}
            className="min-h-0 flex-row items-center justify-start"
            onPress={() => {
              navigator.push('/super');
            }}
          />
        </div>
      ) : null}
      {masjid ? (
        <>
          <div className="mb-4 flex flex-col gap-4">
            <FollowersChip followers={stats.isError ? 0 : stats.data?.followers} />
            {schedule.isError ? null : (
              <TodayStrip
                schedule={schedule.data}
                now={now}
                onEdit={() => {
                  open(PRAYER_TIMES?.route ?? null, 'prayerTimes');
                }}
              />
            )}
          </div>
          <ul className="grid grid-cols-2 gap-3 pb-6">
            {SHOWN.map((tile) => (
              <li key={tile.key} className="flex">
                <AdminTile
                  icon={tile.icon}
                  tone={tile.tone}
                  label={t(`home.tiles.${tile.key}`)}
                  onPress={() => {
                    open(tile.route, tile.key);
                  }}
                />
              </li>
            ))}
          </ul>
          {quota.data ? <QuotaPill used={quota.data.used} limit={quota.data.limit} /> : null}
          <div className="pb-8" />
        </>
      ) : isSuper ? null : (
        <EmptyState
          illustration={<MasjidTile size="lg" />}
          title={t('home.noMasjidTitle')}
          body={t('home.noMasjidBody')}
          className="mt-8"
        />
      )}
      {several ? (
        <Sheet
          open={switching}
          onClose={() => {
            setSwitching(false);
          }}
          title={t('home.chooseMasjid')}
        >
          <RadioCardGroup<string>
            legend={t('home.chooseMasjid')}
            hideLegend
            name="masjid"
            value={masjid?.id ?? null}
            onChange={(id) => {
              select(id);
              setSwitching(false);
            }}
            options={me.masjids.map((m) => ({ value: m.id, title: m.name, leading: <MasjidTile /> }))}
          />
        </Sheet>
      ) : null}
    </Screen>
  );
}
