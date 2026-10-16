import { type Locale, LOCALES, NATIVE_NAME } from '@mc/i18n';
import { useLocale, useTranslation } from '@mc/i18n/react';
import { RadioCardGroup } from '@mc/ui/components';

/** Four big text buttons, each language in its own script (07 B1 — no flags). Switches the UI instantly. */
export function LanguagePicker({ name, hideLegend = false }: { readonly name: string; readonly hideLegend?: boolean }) {
  const { t } = useTranslation('admin');
  const { locale, setLocale } = useLocale();
  return (
    <RadioCardGroup<Locale>
      legend={t('invite.chooseLanguage')}
      hideLegend={hideLegend}
      name={name}
      value={locale}
      onChange={(next) => {
        void setLocale(next);
      }}
      options={LOCALES.map((code) => ({ value: code, title: NATIVE_NAME[code], lang: code }))}
    />
  );
}
