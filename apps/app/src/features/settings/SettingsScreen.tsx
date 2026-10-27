// A15 Settings (07 A15): grouped list — Language, Brother/Sister, (Notifications: Phase 4, dev/staging only), Saved,
// Vibration (Android), Install app, My data, Privacy Policy, Contact & Grievance, About. Language and Brother/Sister
// open sheets and reach the server device record (`PATCH /devices/me`, queued offline); feeds refilter by themselves.
import { type Locale, LOCALES, NATIVE_NAME } from '@mc/i18n/locales';
import { useLocale, useTranslation } from '@mc/i18n/react';
import { BRAND } from '@mc/shared/brand';
import {
  Button,
  IconCircle,
  IosInstallGuide,
  RadioCardGroup,
  Sheet,
  Skeleton,
  SkeletonText,
  Switch,
  useToast,
} from '@mc/ui/components';
import {
  BellIcon,
  BookmarkIcon,
  DeviceMobileIcon,
  DownloadIcon,
  GlobeIcon,
  InfoIcon,
  ListBulletsIcon,
  MegaphoneIcon,
  ShieldCheckIcon,
  UserCircleIcon,
} from '@mc/ui/icons';
import { Screen, useNavigator } from '@mc/ui/navigation';
import { useState } from 'react';

import { SHOW_COMING_SOON } from '../../lib/build.ts';
import { useAppData, useDeviceSelector } from '../../lib/data.tsx';
import type { PreferenceChange } from '../../lib/device/preferences.ts';
import { promptInstall, useCanInstall } from '../../lib/install.ts';
import { isStandalone, platformKind } from '../../lib/platform.ts';
import { SettingsGroup, type SettingsRow } from './components/SettingsGroup.tsx';

type SheetId = 'language' | 'audience' | 'install' | null;

export function SettingsScreen() {
  // The namespace loads with this chunk; never show raw keys.
  const { ready } = useTranslation('settings');
  const { t } = useTranslation();
  if (!ready) {
    return (
      <Screen variant="large" title={t('tabs.settings')}>
        <div aria-busy className="flex flex-col gap-4 pt-2">
          <Skeleton className="h-40 w-full rounded-md" />
          <SkeletonText lines={4} />
        </div>
      </Screen>
    );
  }
  return <Settings />;
}

/** Sends a preference change (the sync code loads on use). */
export function useChangePreferences() {
  const { sync } = useAppData();
  return (change: PreferenceChange) =>
    import('../../lib/device/preferences.ts').then((module) => module.updatePreferences(sync, change));
}

function Settings() {
  const { t } = useTranslation('settings');
  const { t: tc } = useTranslation();
  const { locale, setLocale } = useLocale();
  const navigator = useNavigator();
  const { store } = useAppData();
  const audience = useDeviceSelector((state) => state.audiencePref);
  const vibration = useDeviceSelector((state) => state.settings.vibration);
  const changePreferences = useChangePreferences();
  const canInstall = useCanInstall();
  const [sheet, setSheet] = useState<SheetId>(null);
  const standalone = isStandalone();
  // Android only (08 §7): iOS has no web vibration API, so the switch would do nothing there.
  const canVibrate = typeof window.navigator.vibrate === 'function';
  const close = () => {
    setSheet(null);
  };
  const go = (path: string) => () => {
    navigator.push(path);
  };

  const preferences: SettingsRow[] = [
    {
      key: 'language',
      icon: <GlobeIcon />,
      title: t('language'),
      value: <bdi lang={locale}>{NATIVE_NAME[locale]}</bdi>,
      onPress: () => {
        setSheet('language');
      },
    },
    {
      key: 'audience',
      icon: <UserCircleIcon />,
      tone: audience === 'sisters' ? 'rose' : 'primary',
      title: t('audience'),
      value: audience ? t(audience === 'sisters' ? 'sister' : 'brother') : undefined,
      onPress: () => {
        setSheet('audience');
      },
    },
    ...(SHOW_COMING_SOON
      ? [
          {
            key: 'notifications',
            icon: <BellIcon />,
            tone: 'neutral' as const,
            title: t('notifications'),
            value: t('comingSoon'),
          },
        ]
      : []),
  ];
  const content: SettingsRow[] = [
    { key: 'saved', icon: <BookmarkIcon />, title: t('saved'), onPress: go('/settings/saved') },
    ...(canVibrate
      ? [
          {
            key: 'vibration',
            icon: <DeviceMobileIcon />,
            title: t('vibration'),
            custom: (
              <div className="flex items-center gap-3 px-4">
                <IconCircle size={44}>
                  <DeviceMobileIcon />
                </IconCircle>
                <Switch
                  className="flex-1"
                  checked={vibration}
                  label={t('vibration')}
                  description={t('vibrationHint')}
                  onChange={(checked) => {
                    void store.update((current) => ({
                      ...current,
                      settings: { ...current.settings, vibration: checked },
                    }));
                  }}
                />
              </div>
            ),
          },
        ]
      : []),
    {
      key: 'install',
      icon: <DownloadIcon />,
      title: t('install'),
      ...(standalone
        ? { value: t('installed') }
        : {
            onPress: () => {
              setSheet('install');
            },
          }),
    },
  ];
  const legal: SettingsRow[] = [
    { key: 'data', icon: <ListBulletsIcon />, title: t('myData'), onPress: go('/settings/data') },
    { key: 'privacy', icon: <ShieldCheckIcon />, title: t('privacy'), onPress: go('/settings/privacy') },
    { key: 'grievance', icon: <MegaphoneIcon />, title: t('grievance'), onPress: go('/settings/grievance') },
    { key: 'about', icon: <InfoIcon />, title: t('about'), onPress: go('/settings/about') },
  ];

  return (
    <Screen variant="large" title={tc('tabs.settings')}>
      <div className="flex flex-col gap-5 pt-2 pb-8">
        <SettingsGroup rows={preferences} />
        <SettingsGroup rows={content} />
        <SettingsGroup rows={legal} />
      </div>

      <Sheet open={sheet === 'language'} onClose={close} title={t('languageSheet')}>
        <RadioCardGroup
          className="pb-4"
          legend={t('languageSheet')}
          hideLegend
          name="language"
          value={locale}
          options={LOCALES.map((code) => ({ value: code, title: NATIVE_NAME[code], lang: code }))}
          onChange={(next: Locale) => {
            void setLocale(next).then(() => changePreferences({ locale: next }));
            close();
          }}
        />
      </Sheet>

      <Sheet open={sheet === 'audience'} onClose={close} title={t('audienceSheet')}>
        <RadioCardGroup
          legend={t('audienceSheet')}
          hideLegend
          name="audience"
          value={audience ?? null}
          options={[
            {
              value: 'brothers',
              title: t('brother'),
              leading: (
                <IconCircle size={48}>
                  <UserCircleIcon size={26} />
                </IconCircle>
              ),
            },
            {
              value: 'sisters',
              title: t('sister'),
              leading: (
                <IconCircle size={48} tone="rose">
                  <UserCircleIcon size={26} />
                </IconCircle>
              ),
            },
          ]}
          onChange={(next) => {
            void changePreferences({ audiencePref: next });
            close();
          }}
        />
        <p className="pt-4 pb-4 type-footnote text-text-secondary">{t('audienceHelp')}</p>
      </Sheet>

      <InstallSheet open={sheet === 'install'} canInstall={canInstall} onClose={close} />
    </Screen>
  );
}

function InstallSheet({
  open,
  canInstall,
  onClose,
}: {
  readonly open: boolean;
  readonly canInstall: boolean;
  readonly onClose: () => void;
}) {
  const { t } = useTranslation('settings');
  const toast = useToast();
  const [installing, setInstalling] = useState(false);
  return (
    <Sheet open={open} onClose={onClose} title={t('installTitle')}>
      <div className="flex flex-col gap-4 pb-4">
        {platformKind() === 'ios' ? (
          <IosInstallGuide appName={BRAND.name} onDismiss={onClose} />
        ) : (
          <>
            <p className="type-callout text-text-secondary">{t('installBody')}</p>
            {canInstall ? (
              <Button
                size="lg"
                fullWidth
                leadingIcon={<DownloadIcon />}
                loading={installing}
                onPress={() => {
                  setInstalling(true);
                  void promptInstall()
                    .then((accepted) => {
                      if (accepted) onClose();
                    })
                    .catch(() => {
                      toast.show({ message: t('installUnavailable') });
                    })
                    .finally(() => {
                      setInstalling(false);
                    });
                }}
              >
                {t('installButton')}
              </Button>
            ) : (
              <p className="type-callout text-text">{t('installUnavailable')}</p>
            )}
          </>
        )}
      </div>
    </Sheet>
  );
}
