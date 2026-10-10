// @vitest-environment jsdom
import { LOCALES } from '@mc/i18n';
import { cleanup, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { type NavigatorApi, NavigatorContext, ScreenContext, type ScreenInfo } from '../src/navigation/context.ts';
import { ARABIC_SAMPLE, SAMPLES } from '../src/showcase/samples.ts';
import { Showcase } from '../src/showcase/Showcase.tsx';
import { renderUi } from './render.tsx';

// The dev showcase renders every component without errors in every locale (T0.10); its samples respect the
// 10 §5 fixture policy.

afterEach(cleanup);

const navigator: NavigatorApi = {
  activeTab: 'home',
  push: vi.fn(),
  back: vi.fn(),
  selectTab: vi.fn(),
  presentModal: vi.fn(),
  preload: vi.fn(),
};
const info: ScreenInfo = {
  entry: { key: 'k', href: '/_dev/showcase', pathname: '/_dev/showcase' },
  tab: 'home',
  depth: 2,
  isTop: true,
  params: {},
  search: {},
  isModal: false,
};

describe('Showcase', () => {
  it.each(LOCALES)('renders every section in %s', async (locale) => {
    await renderUi(
      <NavigatorContext value={navigator}>
        <ScreenContext value={info}>
          <Showcase appName="Masjid Connect" />
        </ScreenContext>
      </NavigatorContext>,
      { locale },
    );
    const sections = document.querySelectorAll('[data-showcase-section]');
    expect(sections.length).toBeGreaterThanOrEqual(12);
    expect(screen.getByText(SAMPLES[locale].noticeTitle)).toBeTruthy();
    expect(screen.getAllByText(ARABIC_SAMPLE).length).toBeGreaterThan(0);
  });

  it('samples: same keys in every locale, fake masjid names only', () => {
    const keys = Object.keys(SAMPLES.en).sort();
    for (const locale of LOCALES) {
      expect(Object.keys(SAMPLES[locale]).sort()).toEqual(keys);
      expect(SAMPLES[locale].masjid).toMatch(/^Test Masjid /);
    }
  });
});
