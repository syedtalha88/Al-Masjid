import { useTranslation } from '@mc/i18n/react';
import { Pressable } from '@mc/ui/motion';
import { Screen, useNavigator, useScreen } from '@mc/ui/navigation';
import type { ReactNode } from 'react';

/**
 * Phase 0 placeholder for screens built in later phases (PROGRESS F18). It can push another placeholder so
 * the navigation system can be exercised end to end.
 */
export function PlaceholderScreen({ title, children }: { readonly title: string; readonly children?: ReactNode }) {
  const { t } = useTranslation();
  const navigator = useNavigator();
  const { depth } = useScreen();
  const next = `/demo/${String(depth + 1)}`;
  return (
    <Screen title={title}>
      {children}
      <p className="pt-4 type-body text-text-secondary">{t('placeholder.comingSoon')}</p>
      <Pressable
        onPointerDown={() => {
          navigator.preload(next);
        }}
        onPress={() => {
          navigator.push(next);
        }}
        className="mt-6 inline-flex min-h-12 items-center rounded-full bg-primary-700 px-6 type-subhead-strong text-on-primary"
      >
        {t('placeholder.openNext')}
      </Pressable>
      {/* Tall content so per-screen scroll keeping / scroll-to-top can be checked (placeholders only). */}
      <div aria-hidden data-testid="spacer" className="h-[150vh]" />
    </Screen>
  );
}
