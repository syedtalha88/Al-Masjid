import { useTranslation } from '@mc/i18n/react';
import { AdminTile } from '@mc/ui/admin';
import { EmptyState, IconButton, RadioCardGroup, Sheet } from '@mc/ui/components';
import { CaretDownIcon, MasjidTile, ShieldCheckIcon, UserCircleIcon } from '@mc/ui/icons';
import { Pressable } from '@mc/ui/motion';
import { Screen, useNavigator } from '@mc/ui/navigation';
import { createFileRoute } from '@tanstack/react-router';
import { useState } from 'react';

import { useSignedInAdmin } from '../features/auth/hooks/use-session.ts';
import { useSelectedMasjid } from '../features/home/hooks/use-selected-masjid.ts';
import { TILES } from '../features/home/tiles.tsx';

export const Route = createFileRoute('/')({
  component: Home,
});

/**
 * B3 Admin Home: the masjid (switcher when the admin has several), the ten tiles in their final order, icons and
 * colors — each opens "Coming soon" until its phase lands — and the account button. Super Admins also get their
 * console here.
 */
function Home() {
  const { t } = useTranslation('admin');
  const navigator = useNavigator();
  const me = useSignedInAdmin();
  const { masjid, select } = useSelectedMasjid(me.masjids);
  const [switching, setSwitching] = useState(false);
  const several = me.masjids.length > 1;
  const isSuper = me.admin.role === 'super_admin';

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
              navigator.push('/soon/superAdmin');
            }}
          />
        </div>
      ) : null}
      {masjid ? (
        <ul className="grid grid-cols-2 gap-3 pb-8">
          {TILES.map((tile) => (
            <li key={tile.key} className="flex">
              <AdminTile
                icon={tile.icon}
                tone={tile.tone}
                label={t(`home.tiles.${tile.key}`)}
                onPress={() => {
                  navigator.push(`/soon/${tile.key}`);
                }}
              />
            </li>
          ))}
        </ul>
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
