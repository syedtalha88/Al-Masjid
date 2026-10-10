import { createI18n, type Locale } from '@mc/i18n';
import { I18nProvider } from '@mc/i18n/react';
import { render } from '@testing-library/react';
import { domAnimation } from 'motion/react';
import type { ReactNode } from 'react';
import { vi } from 'vitest';

import { MotionProvider } from '../src/motion/MotionProvider.tsx';

const REDUCE = '(prefers-reduced-motion: reduce)';

/** Mocks `matchMedia` so `prefers-reduced-motion` reads `reduced` (jsdom has no matchMedia). */
export function mockReducedMotion(reduced: boolean): void {
  window.matchMedia = vi.fn((query: string) => ({
    matches: query === REDUCE && reduced,
    media: query,
    onchange: null,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    addListener: () => undefined,
    removeListener: () => undefined,
    dispatchEvent: () => true,
  })); // test double for the browser API (boundary)
}

/**
 * Renders `ui` inside the real i18n (locale JSON files) and motion providers, as the apps do.
 *
 * @param options.locale - UI locale (default `en`); also sets `<html lang dir>`.
 * @param options.reduced - `prefers-reduced-motion: reduce` (default false).
 */
export async function renderUi(
  ui: ReactNode,
  { locale = 'en', reduced = false }: { readonly locale?: Locale; readonly reduced?: boolean } = {},
) {
  mockReducedMotion(reduced);
  document.documentElement.lang = locale;
  document.documentElement.dir = locale === 'ur' ? 'rtl' : 'ltr';
  // jsdom lacks element scrolling APIs that components call (ChipGroup keeps the active chip in view).
  Element.prototype.scrollBy = vi.fn();
  Element.prototype.scrollTo = vi.fn();
  const instance = await createI18n(locale);
  // A wrapper (not a wrapped tree), so `rerender` keeps the providers.
  const wrapper = ({ children }: { readonly children: ReactNode }) => (
    <I18nProvider instance={instance} initialLocale={locale}>
      <MotionProvider features={domAnimation}>{children}</MotionProvider>
    </I18nProvider>
  );
  return render(ui, { wrapper });
}
