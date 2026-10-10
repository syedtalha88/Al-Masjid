import { useTranslation } from '@mc/i18n/react';
import type { ReactNode } from 'react';

import { Pressable } from '../motion/Pressable.tsx';
import { useNavigator, useScreen } from './context.ts';
import { BackIcon, CloseIcon } from './icons.tsx';

export interface ScreenProps {
  /** Screen title: the `<h1>` that receives focus after a push (08 §3, screen readers). */
  readonly title: string;
  /** Optional trailing header actions. */
  readonly actions?: ReactNode;
  readonly children: ReactNode;
}

/**
 * Screen layout used by every route component: header (back/close + title + actions) and the screen's own
 * scroll container (`data-screen-scroll`, restored by the navigator). Full NavBar variants (large title
 * collapse) arrive with the component library (T0.10).
 */
export function Screen({ title, actions, children }: ScreenProps) {
  const { t } = useTranslation();
  const navigator = useNavigator();
  const { depth, isModal } = useScreen();
  const showBack = depth > 1 && !isModal;
  return (
    <div className="flex h-full flex-col">
      <header className="flex min-h-14 shrink-0 items-center gap-1 bg-bg pt-safe px-screen">
        {showBack ? (
          <Pressable
            onPress={() => {
              navigator.back();
            }}
            aria-label={t('nav.back')}
            className="-ms-3 inline-flex size-11 items-center justify-center rounded-full text-primary-700"
          >
            <BackIcon className="rtl:-scale-x-100" />
          </Pressable>
        ) : null}
        <h1 data-screen-title tabIndex={-1} className="min-w-0 flex-1 truncate type-headline text-text outline-none">
          {title}
        </h1>
        {actions}
        {isModal ? (
          <Pressable
            onPress={() => {
              navigator.back();
            }}
            aria-label={t('nav.close')}
            className="-me-3 inline-flex size-11 items-center justify-center rounded-full text-text"
          >
            <CloseIcon />
          </Pressable>
        ) : null}
      </header>
      <div data-screen-scroll className="scroller min-h-0 flex-1 pb-[var(--mc-tabbar-h,0px)] px-screen">
        {children}
      </div>
    </div>
  );
}
