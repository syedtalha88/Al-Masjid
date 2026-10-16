import { useTranslation } from '@mc/i18n/react';
import { SkeletonText, Tag, type Tone } from '@mc/ui/components';
import { Pressable } from '@mc/ui/motion';
import { Screen, useNavigator } from '@mc/ui/navigation';
import type { ReactNode } from 'react';

import { StepUpProvider } from './StepUpProvider.tsx';

export type SuperSection = 'dashboard' | 'masjids' | 'settings' | 'audit';

export const SUPER_SECTIONS: readonly { readonly key: SuperSection; readonly path: string }[] = [
  { key: 'dashboard', path: '/super' },
  { key: 'masjids', path: '/super/masjids' },
  { key: 'settings', path: '/super/settings' },
  { key: 'audit', path: '/super/audit' },
];

export interface SuperFrameProps {
  readonly title: string;
  readonly section: SuperSection;
  readonly actions?: ReactNode;
  readonly children: ReactNode;
}

/**
 * Layout of every Super Admin screen (07 Part C): from 1024px a sidebar with the sections next to the content;
 * narrower, the content alone (the dashboard lists the sections). Also hosts the ★ step-up dialog and waits for the
 * `super` strings, which only Super Admins download.
 */
export function SuperFrame({ title, section, actions, children }: SuperFrameProps) {
  const { t, ready } = useTranslation('super');
  const navigator = useNavigator();
  return (
    <Screen title={title} {...(actions ? { actions } : {})}>
      <StepUpProvider>
        <div className="lg:grid lg:grid-cols-[220px_minmax(0,1fr)] lg:gap-8">
          <nav aria-label={ready ? t('nav.label') : undefined} className="hidden lg:block">
            <ul className="sticky top-2 flex flex-col gap-1">
              {SUPER_SECTIONS.map((item) => (
                <li key={item.key}>
                  <Pressable
                    kind="card"
                    aria-current={item.key === section ? 'page' : undefined}
                    onPress={() => {
                      if (item.key !== section) navigator.push(item.path);
                    }}
                    className={`flex min-h-14 w-full items-center rounded-sm px-4 text-start type-subhead-strong ${
                      item.key === section ? 'bg-mint-100 text-primary-800' : 'text-text-secondary'
                    }`}
                  >
                    {ready ? t(`nav.${item.key}`) : ''}
                  </Pressable>
                </li>
              ))}
            </ul>
          </nav>
          <div className="min-w-0 pb-12">{ready ? children : <SkeletonText lines={6} />}</div>
        </div>
      </StepUpProvider>
    </Screen>
  );
}

const STATUS_TONE: Readonly<Record<'pending' | 'active' | 'suspended' | 'deleted', Tone>> = {
  pending: 'sun',
  active: 'primary',
  suspended: 'danger',
  deleted: 'neutral',
};

/** Masjid status as a colored tag. */
export function StatusTag({ status }: { readonly status: 'pending' | 'active' | 'suspended' | 'deleted' }) {
  const { t } = useTranslation('super');
  return <Tag tone={STATUS_TONE[status]}>{t(`status.${status}`)}</Tag>;
}
