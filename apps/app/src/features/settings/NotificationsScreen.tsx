// Settings → Notifications (07 A15 §3, PHASE_04 T4.2): the status on this phone — On, Off, Blocked in phone settings
// (with the steps to allow them for this platform; the app never prompts again), Install app first (iPhone outside the
// Home Screen app) — the switch, and a mute switch per followed masjid (content stays visible — DECISIONS #16).
import { useLocale, useTranslation } from '@mc/i18n/react';
import { BRAND } from '@mc/shared/brand';
import { Button, IconCircle, InfoNote, IosInstallGuide, Switch, Tag, type Tone, useToast } from '@mc/ui/components';
import { BellIcon } from '@mc/ui/icons';
import { Screen } from '@mc/ui/navigation';
import { useState } from 'react';

import { useAppData, useDeviceSelector } from '../../lib/data.tsx';
import { visibleFollows } from '../../lib/device/store.ts';
import { masjidName } from '../../lib/masjid.ts';
import type { PushStatus } from '../../lib/push.ts';
import { useHomeData } from '../home/hooks/useHomeData.ts';
import { usePushControls } from './hooks/usePushControls.ts';

const STATUS_KEY = {
  on: 'push.status.on',
  off: 'push.status.off',
  blocked: 'push.status.blocked',
  'install-first': 'push.status.installFirst',
  unsupported: 'push.status.unsupported',
} as const satisfies Record<PushStatus, string>;
const STATUS_TONE = {
  on: 'primary',
  off: 'neutral',
  blocked: 'danger',
  'install-first': 'sun',
  unsupported: 'neutral',
} as const satisfies Record<PushStatus, Tone>;

export function NotificationsScreen() {
  const { ready } = useTranslation('settings');
  if (!ready) return <div aria-busy className="h-full bg-bg" />;
  return <Notifications />;
}

function Notifications() {
  const { t } = useTranslation('settings');
  const push = usePushControls();
  const [guide, setGuide] = useState(false);
  const blockedSteps =
    push.platform === 'ios'
      ? t('push.blockedIos', { app: BRAND.name })
      : push.platform === 'android'
        ? t('push.blockedAndroid')
        : t('push.blockedDesktop');

  return (
    <Screen title={t('push.title')}>
      <div className="flex flex-col gap-5 pt-2 pb-8">
        <section aria-labelledby="push-heading" className="flex flex-col gap-4 rounded-md bg-surface p-4 shadow-e1">
          <div className="flex items-center gap-3">
            <IconCircle size={44} tone="primary">
              <BellIcon />
            </IconCircle>
            <h2 id="push-heading" className="flex-1 type-headline text-text">
              {t('push.title')}
            </h2>
            <Tag tone={STATUS_TONE[push.status]}>{t(STATUS_KEY[push.status])}</Tag>
          </div>
          <p className="type-callout text-text-secondary">{t('push.intro')}</p>

          {push.status === 'off' ? (
            <Button size="lg" fullWidth loading={push.busy} onPress={() => void push.enable()}>
              {t('push.turnOn')}
            </Button>
          ) : null}
          {push.status === 'on' ? (
            <Button size="lg" variant="secondary" fullWidth loading={push.busy} onPress={() => void push.disable()}>
              {t('push.turnOff')}
            </Button>
          ) : null}
          {push.status === 'blocked' ? (
            <InfoNote>
              <span className="block type-callout text-text">{t('push.blockedTitle')}</span>
              {blockedSteps}
            </InfoNote>
          ) : null}
          {push.status === 'install-first' ? (
            <>
              <InfoNote>{t('push.installFirstBody')}</InfoNote>
              {guide ? (
                <IosInstallGuide
                  appName={BRAND.name}
                  onDismiss={() => {
                    setGuide(false);
                  }}
                />
              ) : (
                <Button
                  variant="secondary"
                  fullWidth
                  onPress={() => {
                    setGuide(true);
                  }}
                >
                  {t('install')}
                </Button>
              )}
            </>
          ) : null}
          {push.status === 'unsupported' ? <InfoNote>{t('push.unsupportedBody')}</InfoNote> : null}
          {push.failed ? (
            <p role="alert" className="type-footnote text-danger-700">
              {t('push.error')}
            </p>
          ) : null}
        </section>

        <MasjidMutes />
      </div>
    </Screen>
  );
}

/** One mute switch per followed masjid (checked = notifications from it). */
function MasjidMutes() {
  const { t } = useTranslation('settings');
  const { t: tm } = useTranslation('masjid');
  const { locale } = useLocale();
  const { sync } = useAppData();
  const toast = useToast();
  const follows = useDeviceSelector((state) => state.follows);
  const home = useHomeData();
  const visible = visibleFollows(follows);

  const setMuted = async (masjidId: string, muted: boolean) => {
    const module = await import('../../lib/device/sync.ts');
    try {
      await module.setMuted(sync, masjidId, muted);
    } catch {
      toast.show({ message: tm('muteFailed'), tone: 'error' });
    }
  };

  return (
    <section aria-labelledby="mutes-heading" className="flex flex-col gap-2">
      <h2 id="mutes-heading" className="px-1 type-footnote text-text-secondary">
        {t('push.masjids')}
      </h2>
      {visible.length === 0 ? (
        <p className="rounded-md bg-surface p-4 type-callout text-text-secondary shadow-e1">{t('push.noMasjids')}</p>
      ) : (
        <div className="flex flex-col divide-y divide-border overflow-hidden rounded-md bg-surface shadow-e1">
          {visible.map((follow) => {
            const masjid = home.masjids.find((entry) => entry.id === follow.masjidId);
            if (masjid?.state !== 'active') return null;
            const name = masjidName(masjid.bundle.masjid, locale);
            return (
              <Switch
                key={follow.masjidId}
                className="px-4 py-1"
                checked={!follow.muted}
                label={name}
                description={t('push.masjidSwitch', { name })}
                onChange={(on) => void setMuted(follow.masjidId, !on)}
              />
            );
          })}
        </div>
      )}
    </section>
  );
}
