import { useTranslation } from '@mc/i18n/react';
import { type ReactNode, useEffect, useRef } from 'react';

import { Pressable } from '../motion/Pressable.tsx';
import { useNavigator, useScreen } from './context.ts';
import { BackIcon, CloseIcon } from './icons.tsx';
import { largeTitleCollapse, NavBar, type NavBarVariant } from './NavBar.tsx';

export interface ScreenProps {
  /** Screen title: the `<h1>` that receives focus after a push (08 §3, screen readers). */
  readonly title: string;
  /** `large` for tab roots (Home, My Masjids, Updates, Settings), `inline` for pushed screens (default). */
  readonly variant?: NavBarVariant;
  /** Inline variant: caption under the title (masjid name). */
  readonly subtitle?: string;
  /** Large variant: a line under the large title ("Stay connected with your masjids"). */
  readonly lead?: ReactNode;
  /** Optional trailing header actions. */
  readonly actions?: ReactNode;
  readonly children: ReactNode;
}

/**
 * Screen layout used by every route component: NavBar (back/close + title + actions; `large` collapses on
 * scroll — 08 §4) and the screen's own scroll container (`data-screen-scroll`, restored by the navigator).
 */
export function Screen({ title, variant = 'inline', subtitle, lead, actions, children }: ScreenProps) {
  const { t } = useTranslation();
  const navigator = useNavigator();
  const { depth, isModal } = useScreen();
  const scroller = useRef<HTMLDivElement>(null);
  const largeTitle = useRef<HTMLDivElement>(null);
  const bar = useRef<HTMLElement>(null);
  const inlineTitle = useRef<HTMLDivElement>(null);
  const showBack = depth > 1 && !isModal;
  const large = variant === 'large';

  // Large title collapse (08 §4): one rAF-batched DOM write per scroll frame.
  useEffect(() => {
    const node = scroller.current;
    if (!large || !node) return;
    let frame = 0;
    const paint = () => {
      frame = 0;
      largeTitleCollapse(node, {
        largeTitle: largeTitle.current,
        bar: bar.current,
        inlineTitle: inlineTitle.current,
      })();
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(paint);
    };
    paint();
    node.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      cancelAnimationFrame(frame);
      node.removeEventListener('scroll', onScroll);
    };
  }, [large]);

  const leading = showBack ? (
    <Pressable
      onPress={() => {
        navigator.back();
      }}
      aria-label={t('nav.back')}
      className="-ms-3 inline-flex size-11 items-center justify-center rounded-full text-primary-700"
    >
      <BackIcon className="rtl:-scale-x-100" />
    </Pressable>
  ) : null;

  const trailing =
    actions || isModal ? (
      <>
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
      </>
    ) : null;

  return (
    <div className="flex h-full flex-col">
      <NavBar
        title={title}
        variant={variant}
        leading={leading}
        actions={trailing}
        barRef={bar}
        inlineTitleRef={inlineTitle}
        {...(subtitle ? { subtitle } : {})}
      />
      <div ref={scroller} data-screen-scroll className="scroller min-h-0 flex-1 pb-[var(--mc-tabbar-h,0px)] px-screen">
        {large ? (
          <div ref={largeTitle} className="origin-top-left pt-1 pb-4 rtl:origin-top-right">
            <h1 data-screen-title tabIndex={-1} className="type-large-title text-text outline-none">
              {title}
            </h1>
            {lead ? <p className="mt-1 type-callout text-text-secondary">{lead}</p> : null}
          </div>
        ) : null}
        {children}
      </div>
    </div>
  );
}
