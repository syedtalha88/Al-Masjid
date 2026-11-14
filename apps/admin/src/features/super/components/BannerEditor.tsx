// C10 banners (PHASE_08 T8.9): the maintenance banner (both apps) and the incident banner (every musalli), each written
// in all four languages, saved whole and taken down with one tap. `/config` and `/auth/me` carry them within a minute.
// Putting one up is ★ (confirm with the screen lock — DECISIONS 180 M5); taking one down is not.
import { LOCALES, NATIVE_NAME } from '@mc/i18n/locales';
import { useTranslation } from '@mc/i18n/react';
import { BANNER_MAX, type SuperSettings } from '@mc/shared/contracts';
import { Button, InfoNote, SectionHeader, Tag, TextArea, useToast } from '@mc/ui/components';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import { StepUpCancelled, useStepUp } from '../../auth/components/StepUpProvider.tsx';
import { ME_KEY, useErrorText } from '../../auth/hooks/use-session.ts';
import { superApi } from '../api/super-api.ts';

type Banner = NonNullable<SuperSettings['maintenanceBanner']>;
const EMPTY: Banner = { en: '', hi: '', ur: '', te: '' };

export interface BannerEditorProps {
  readonly kind: 'maintenance' | 'incident';
  /** The banner showing now (absent: none). */
  readonly current: Banner | undefined;
  /** The settings query, refreshed after a change. */
  readonly settingsKey: readonly unknown[];
}

export function BannerEditor({ kind, current, settingsKey }: BannerEditorProps) {
  const { t } = useTranslation('super');
  const toast = useToast();
  const errorText = useErrorText();
  const queryClient = useQueryClient();
  const run = useStepUp();
  const [text, setText] = useState<Banner>(current ?? EMPTY);
  const key = kind === 'maintenance' ? 'maintenanceBanner' : 'incidentBanner';
  const trimmed: Banner = { en: text.en.trim(), hi: text.hi.trim(), ur: text.ur.trim(), te: text.te.trim() };
  const complete = LOCALES.every((locale) => trimmed[locale] !== '');
  const changed = LOCALES.some((locale) => trimmed[locale] !== (current?.[locale] ?? ''));

  const save = useMutation({
    mutationFn: (next: Banner | null) =>
      next ? run(() => superApi.updateSettings({ [key]: next })) : superApi.updateSettings({ [key]: null }),
    onSuccess: async (_result, next) => {
      toast.show({ message: next ? t('banners.shownToast') : t('banners.removedToast'), tone: 'success' });
      if (!next) setText(EMPTY);
      await queryClient.invalidateQueries({ queryKey: settingsKey });
      await queryClient.invalidateQueries({ queryKey: ME_KEY });
    },
    onError: (error) => {
      if (!(error instanceof StepUpCancelled)) toast.show({ message: errorText(error), tone: 'error' });
    },
  });

  return (
    <section className="flex flex-col gap-3" aria-labelledby={`banner-${kind}`}>
      <div className="flex items-center justify-between gap-3">
        <SectionHeader id={`banner-${kind}`} title={t(`banners.${kind}`)} />
        <Tag tone={current ? 'primary' : 'neutral'}>{current ? t('banners.live') : t('banners.off')}</Tag>
      </div>
      <InfoNote>{`${t(kind === 'maintenance' ? 'banners.maintenanceHint' : 'banners.incidentHint')} ${t('banners.allLanguages')}`}</InfoNote>
      {LOCALES.map((locale) => (
        <TextArea
          key={locale}
          label={NATIVE_NAME[locale]}
          lang={locale}
          dir={locale === 'ur' ? 'rtl' : 'ltr'}
          rows={2}
          maxLength={BANNER_MAX}
          value={text[locale]}
          onChange={(e) => {
            const value = e.target.value;
            setText((before) => ({ ...before, [locale]: value }));
          }}
        />
      ))}
      <div className="flex flex-wrap gap-3">
        <Button
          size="lg"
          disabled={!complete || !changed}
          loading={save.isPending && save.variables !== null}
          onPress={() => {
            save.mutate(trimmed);
          }}
        >
          {current ? t('banners.update') : t('banners.show')}
        </Button>
        {current ? (
          <Button
            size="lg"
            variant="outline"
            loading={save.isPending && save.variables === null}
            onPress={() => {
              save.mutate(null);
            }}
          >
            {t('banners.takeDown')}
          </Button>
        ) : null}
      </div>
    </section>
  );
}
