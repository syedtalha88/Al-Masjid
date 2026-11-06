// @vitest-environment jsdom
// T3.15 acceptance: masjid text is never shown with a source / verified line (05 §9) — only "Added by <masjid>"; a
// library entry carries its source; Arabic is `lang="ar" dir="rtl"` in every locale (never mirrored); a recording is the
// A18 player; the masjid's instruction keeps its own language. Religious text: the 10 §5 placeholders only.
import type { RuqyahEntry } from '@mc/shared/contracts/public';
import { cleanup, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { RuqyahCard } from '../src/content/index.ts';
import { renderUi } from './render.tsx';

const ARABIC = 'نص تجريبي للعرض فقط';
const MASJID = 'Test Masjid Alpha';
const TEXT: RuqyahEntry = {
  id: '00000000-0000-4000-8000-0000000000a1',
  category: 'nazar',
  source: 'text',
  title: 'Sample masjid entry',
  text: { arabic: ARABIC, translation: 'Sample masjid text — test only.', translationLocale: 'ur', reference: 'DEV-1' },
  instructions: 'Sample instruction — test only.',
  instructionsLocale: 'hi',
};
const LIBRARY: RuqyahEntry = {
  id: '00000000-0000-4000-8000-0000000000a2',
  category: 'shifa',
  source: 'library',
  library: {
    id: '00000000-0000-4000-8000-0000000000aa',
    kind: 'dua',
    arabic: ARABIC,
    transliteration: { en: 'Sample transliteration — DEV ONLY' },
    translation: { en: 'Sample translation text for development. Not a real hadith.' },
    reference: 'DEV-SAMPLE-001',
    sourceName: 'Development fixture',
    sourceLicense: 'N/A — not for production',
  },
};
const AUDIO: RuqyahEntry = {
  id: '00000000-0000-4000-8000-0000000000a3',
  category: 'general',
  source: 'audio',
  title: 'Sample recording',
  audio: { key: 'm/x/a/y', durationS: 200 },
};

afterEach(cleanup);

describe('RuqyahCard (07 A19)', () => {
  for (const locale of ['en', 'hi', 'ur', 'te'] as const) {
    it(`masjid text: "Added by", never a source or verified line; Arabic not mirrored (${locale})`, async () => {
      const { container } = await renderUi(<RuqyahCard entry={TEXT} masjid={MASJID} />, { locale });
      const card = container.querySelector('[data-ruqyah-entry="text"]');
      expect(card?.querySelector('[data-ruqyah-added-by]')?.textContent).toContain(MASJID);
      expect(card?.querySelector('[data-ruqyah-source]')).toBeNull();
      expect(card?.textContent).not.toMatch(/Development fixture|Source|Licence|Verified/);
      const arabic = screen.getByText(ARABIC);
      expect(arabic.getAttribute('lang')).toBe('ar');
      expect(arabic.getAttribute('dir')).toBe('rtl');
      // The translation and the instruction keep the language the masjid wrote them in.
      expect(screen.getByText(/Sample masjid text/).getAttribute('lang')).toBe('ur');
      expect(screen.getByText('Sample instruction — test only.').getAttribute('lang')).toBe('hi');
    });
  }

  it('a library entry shows its reference and source line, and no "Added by"', async () => {
    const { container } = await renderUi(<RuqyahCard entry={LIBRARY} masjid={MASJID} showTransliteration />);
    expect(container.querySelector('[data-ruqyah-source]')?.textContent).toContain('Development fixture');
    expect(container.querySelector('[data-ruqyah-added-by]')).toBeNull();
    expect(screen.getByText('DEV-SAMPLE-001')).toBeTruthy();
    expect(screen.getByText('Sample transliteration — DEV ONLY')).toBeTruthy();
  });

  it('a recording is the voice player under its title', async () => {
    await renderUi(<RuqyahCard entry={AUDIO} masjid={MASJID} audioSrc="https://media.test/a/m4a/m/x/a/y" />);
    expect(screen.getByRole('heading', { name: 'Sample recording' })).toBeTruthy();
    expect(screen.getByRole('group', { name: /Voice message, 3 minutes 20 seconds/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Play' })).toBeTruthy();
  });
});
