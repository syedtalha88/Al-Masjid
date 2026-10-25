// Settings → My data (07 A15, 05 §4 "what we store"): exactly the server's device record (`GET /devices/me`) and
// what this phone keeps, then "Clear all data" (journey 12): the server record is deleted (queued when offline), the
// phone is wiped back to onboarding.
import { type Locale, NATIVE_NAME } from '@mc/i18n/locales';
import { useLocale, useTranslation } from '@mc/i18n/react';
import { BRAND } from '@mc/shared/brand';
import { Button, Dialog, Skeleton, useToast } from '@mc/ui/components';
import { Screen } from '@mc/ui/navigation';
import { useQuery } from '@tanstack/react-query';
import { type ReactNode, useState } from 'react';

import { queryKeys } from '../../lib/api/keys.ts';
import { useAppData, useDeviceSelector, useDeviceState } from '../../lib/data.tsx';
import { masjidName } from '../../lib/masjid.ts';
import { setUnseenCount } from '../../lib/unseen.ts';
import { useHomeData } from '../home/hooks/useHomeData.ts';

export function MyDataScreen() {
  const { ready } = useTranslation('settings');
  if (!ready) return <div aria-busy className="h-full bg-bg" />;
  return <MyData />;
}

function Field({ label, children }: { readonly label: string; readonly children: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 py-2.5">
      <dt className="type-callout text-text-secondary">{label}</dt>
      <dd className="text-end type-callout text-text">{children}</dd>
    </div>
  );
}

function MyData() {
  const { t } = useTranslation('settings');
  const { locale, format } = useLocale();
  const { api, sync, queryClient } = useAppData();
  const toast = useToast();
  const state = useDeviceState();
  const registered = useDeviceSelector((current) => current.credentials !== undefined);
  const home = useHomeData();
  const [confirm, setConfirm] = useState(false);
  const [clearing, setClearing] = useState(false);
  // Not persisted (live, and it holds the app ID): the device query root is in memory only.
  const record = useQuery({
    queryKey: queryKeys.device(),
    queryFn: () => api.me(),
    enabled: registered,
    staleTime: 0,
  });
  const date = (iso: string) => format.date(new Date(iso), 'medium');
  const names = home.masjids.flatMap((masjid) =>
    masjid.state === 'active' ? [masjidName(masjid.bundle.masjid, locale)] : [],
  );

  const clear = async () => {
    setClearing(true);
    try {
      const module = await import('../../lib/device/preferences.ts');
      const result = await module.clearAllData(sync);
      queryClient.clear();
      setUnseenCount(0);
      // The app shows onboarding now (the device document is fresh); start from the Home URL afterwards.
      window.history.replaceState(null, '', '/');
      if (result === 'queued') toast.show({ message: t('clearQueued') });
    } finally {
      setClearing(false);
      setConfirm(false);
    }
  };

  return (
    <Screen title={t('myData')}>
      <div className="flex flex-col gap-5 pt-2 pb-8">
        <p className="type-callout text-text-secondary">{t('dataLead', { app: BRAND.name })}</p>

        <section aria-labelledby="server-heading" className="rounded-md bg-surface px-4 py-3 shadow-e1">
          <h2 id="server-heading" className="type-headline text-text">
            {t('onServer')}
          </h2>
          {!registered ? (
            <p className="pt-2 type-callout text-text-secondary">{t('notRegistered')}</p>
          ) : record.data ? (
            <dl className="divide-y divide-border">
              <Field label={t('field.appId')}>
                <bdi className="break-all font-mono type-footnote" dir="ltr">
                  {record.data.deviceId}
                </bdi>
              </Field>
              <Field label={t('field.language')}>{NATIVE_NAME[record.data.locale satisfies Locale]}</Field>
              <Field label={t('field.audience')}>
                {t(record.data.audiencePref === 'sisters' ? 'sister' : 'brother')}
              </Field>
              <Field label={t('field.platform')}>{t(`platform.${record.data.platform}`)}</Field>
              <Field label={t('field.privacyVersion')}>
                <bdi>{record.data.privacyVersion}</bdi>
              </Field>
              <Field label={t('field.push')}>{record.data.pushEnabled ? t('pushOn') : t('pushOff')}</Field>
              <Field label={t('field.follows')}>{format.number(record.data.followCount)}</Field>
              <Field label={t('field.createdAt')}>{date(record.data.createdAt)}</Field>
              <Field label={t('field.lastSeen')}>{date(record.data.lastSeenAt)}</Field>
            </dl>
          ) : record.isError ? (
            <p className="pt-2 type-callout text-text-secondary">{t('serverOffline')}</p>
          ) : (
            <div aria-busy className="flex flex-col gap-2 pt-3">
              <Skeleton className="h-5 w-full rounded-xs" />
              <Skeleton className="h-5 w-2/3 rounded-xs" />
            </div>
          )}
        </section>

        <section aria-labelledby="phone-heading" className="rounded-md bg-surface px-4 py-3 shadow-e1">
          <h2 id="phone-heading" className="type-headline text-text">
            {t('onPhone')}
          </h2>
          <dl className="divide-y divide-border">
            <Field label={t('field.language')}>{NATIVE_NAME[state.locale]}</Field>
            {state.audiencePref ? (
              <Field label={t('field.audience')}>{t(state.audiencePref === 'sisters' ? 'sister' : 'brother')}</Field>
            ) : null}
            <Field label={t('field.follows')}>
              {names.length > 0 ? (
                <span className="flex flex-col">
                  {names.map((name) => (
                    <bdi key={name}>{name}</bdi>
                  ))}
                </span>
              ) : (
                format.number(0)
              )}
            </Field>
            <Field label={t('field.saved')}>{format.number(state.saved.length)}</Field>
            <Field label={t('field.ameens')}>{format.number(state.ameens.length)}</Field>
            <Field label={t('field.reader')}>
              {t('readerSettings', {
                size: format.number(Math.round(state.settings.arabicScale * 100)),
                transliteration: t(state.settings.transliteration ? 'on' : 'off'),
                vibration: t(state.settings.vibration ? 'on' : 'off'),
              })}
            </Field>
          </dl>
        </section>

        <Button
          variant="danger"
          size="lg"
          fullWidth
          onPress={() => {
            setConfirm(true);
          }}
        >
          {t('clearAll')}
        </Button>
      </div>
      <Dialog
        open={confirm}
        destructive
        loading={clearing}
        title={t('clearTitle')}
        body={t('clearBody')}
        confirmLabel={t('clearAll')}
        onConfirm={() => void clear()}
        onClose={() => {
          setConfirm(false);
        }}
      />
    </Screen>
  );
}
