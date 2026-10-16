import { useLocale, useTranslation } from '@mc/i18n/react';
import type { SuperSettings, SuperSettingsPatch } from '@mc/shared/contracts';
import { Button, InfoNote, SectionHeader, Select, SkeletonText, TextField, useToast } from '@mc/ui/components';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { useState } from 'react';

import { useErrorText } from '../features/auth/hooks/use-session.ts';
import { superApi } from '../features/super/api/super-api.ts';
import { StepUpCancelled, useStepUp } from '../features/super/components/StepUpProvider.tsx';
import { SuperFrame } from '../features/super/components/SuperFrame.tsx';

export const Route = createFileRoute('/super/settings')({
  component: Settings,
});

const SETTINGS_KEY = ['super', 'settings'] as const;

/** C10 Settings (Phase 1 part): Hijri adjustment, default quota, support WhatsApp, grievance officer, document versions. */
function Settings() {
  const { t } = useTranslation('super');
  const settings = useQuery({ queryKey: SETTINGS_KEY, queryFn: ({ signal }) => superApi.settings(signal) });
  return (
    <SuperFrame title={t('nav.settings')} section="settings">
      <div className="max-w-xl">
        {settings.data ? <SettingsForm initial={settings.data} /> : <SkeletonText lines={10} />}
      </div>
    </SuperFrame>
  );
}

type Offset = '-2' | '-1' | '0' | '1' | '2';
const QUOTAS = ['0', '2', '4', '6', '8', '10', '12', '15', '20', '30', '50'] as const;
type Quota = (typeof QUOTAS)[number];

function SettingsForm({ initial }: { readonly initial: SuperSettings }) {
  const { t } = useTranslation('super');
  const { format } = useLocale();
  const toast = useToast();
  const errorText = useErrorText();
  const queryClient = useQueryClient();
  const run = useStepUp();
  const [offset, setOffset] = useState<Offset>(String(initial.globalHijriOffset) as Offset); // -2..2 from the API
  const [quota, setQuota] = useState<Quota | null>(
    (QUOTAS as readonly string[]).includes(String(initial.defaultPushQuota))
      ? (String(initial.defaultPushQuota) as Quota) // checked just above
      : null,
  );
  const [whatsapp, setWhatsapp] = useState(initial.supportWhatsapp ?? '');
  const [officer, setOfficer] = useState(initial.grievanceOfficer);
  const [versions, setVersions] = useState({
    undertakingVersion: initial.undertakingVersion,
    privacyVersion: initial.privacyVersion,
    termsVersion: initial.termsVersion,
  });
  const whatsappInvalid = whatsapp.trim() !== '' && !/^\+?[0-9]{8,15}$/.test(whatsapp.replace(/[\s-]/g, ''));

  const patch = (): SuperSettingsPatch => {
    const number = whatsapp.replace(/[\s-]/g, '');
    return {
      ...(Number(offset) === initial.globalHijriOffset
        ? {}
        : { globalHijriOffset: Number(offset) as -2 | -1 | 0 | 1 | 2 }), // one of the five options
      ...(quota === null || Number(quota) === initial.defaultPushQuota ? {} : { defaultPushQuota: Number(quota) }),
      ...(number === (initial.supportWhatsapp ?? '') ? {} : { supportWhatsapp: number === '' ? null : number }),
      ...(JSON.stringify(officer) === JSON.stringify(initial.grievanceOfficer) ? {} : { grievanceOfficer: officer }),
      ...(versions.undertakingVersion === initial.undertakingVersion
        ? {}
        : { undertakingVersion: versions.undertakingVersion.trim() }),
      ...(versions.privacyVersion === initial.privacyVersion ? {} : { privacyVersion: versions.privacyVersion.trim() }),
      ...(versions.termsVersion === initial.termsVersion ? {} : { termsVersion: versions.termsVersion.trim() }),
    };
  };
  const save = useMutation({
    mutationFn: () => {
      const changes = patch();
      return Object.keys(changes).length === 0 ? Promise.resolve(null) : run(() => superApi.updateSettings(changes));
    },
    onSuccess: async () => {
      toast.show({ message: t('settings.saved'), tone: 'success' });
      await queryClient.invalidateQueries({ queryKey: SETTINGS_KEY });
    },
    onError: (error) => {
      if (!(error instanceof StepUpCancelled)) toast.show({ message: errorText(error), tone: 'error' });
    },
  });
  const officerField = (key: keyof typeof officer, label: string, type = 'text') => (
    <TextField
      label={label}
      type={type}
      value={officer[key]}
      maxLength={key === 'address' ? 300 : key === 'email' ? 200 : 120}
      onChange={(e) => {
        setOfficer((current) => ({ ...current, [key]: e.target.value }));
      }}
    />
  );
  const versionField = (key: keyof typeof versions, label: string) => (
    <TextField
      label={label}
      dir="ltr"
      value={versions[key]}
      maxLength={20}
      onChange={(e) => {
        setVersions((current) => ({ ...current, [key]: e.target.value }));
      }}
    />
  );

  return (
    <div className="flex flex-col gap-4">
      <Select<Offset>
        label={t('settings.hijri')}
        value={offset}
        onChange={setOffset}
        options={(['-2', '-1', '0', '1', '2'] as const).map((value) => ({
          value,
          label: value.startsWith('-') || value === '0' ? value : `+${value}`,
        }))}
      />
      <Select<Quota>
        label={t('settings.quota')}
        value={quota}
        onChange={setQuota}
        options={QUOTAS.map((value) => ({ value, label: format.number(Number(value)) }))}
      />
      <TextField
        label={t('settings.whatsapp')}
        type="tel"
        dir="ltr"
        optional
        hint={t('settings.whatsappHint')}
        error={whatsappInvalid ? t('form.required') : undefined}
        value={whatsapp}
        onChange={(e) => {
          setWhatsapp(e.target.value);
        }}
      />
      <SectionHeader title={t('settings.officer')} className="mt-4" />
      {officerField('name', t('settings.officerName'))}
      {officerField('email', t('settings.officerEmail'), 'email')}
      {officerField('address', t('settings.officerAddress'))}
      {officerField('city', t('settings.officerCity'))}
      <SectionHeader title={t('settings.versions')} className="mt-4" />
      <InfoNote>{t('settings.versionHint')}</InfoNote>
      {versionField('undertakingVersion', t('settings.undertakingVersion'))}
      {versionField('privacyVersion', t('settings.privacyVersion'))}
      {versionField('termsVersion', t('settings.termsVersion'))}
      <Button
        size="lg"
        fullWidth
        className="mt-4"
        disabled={whatsappInvalid}
        loading={save.isPending}
        onPress={() => {
          save.mutate();
        }}
      >
        {t('settings.save')}
      </Button>
    </div>
  );
}
