// @vitest-environment jsdom
import { createI18n } from '@mc/i18n';
import { formatters } from '@mc/i18n/format';
import { I18nProvider } from '@mc/i18n/react';
import type { FeedItem, LibraryEntry, NoticeTemplate } from '@mc/shared/contracts/public';
import { cleanup, fireEvent, renderHook, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  AnnouncementItemCard,
  DailyItemCard,
  DuaItemCard,
  FeedItemCard,
  janazaWhen,
  useNoticeBody,
} from '../src/content/index.ts';
import { renderUi } from './render.tsx';

const renderCard = (ui: ReactNode, locale: 'en' | 'hi' = 'en') =>
  renderUi(ui, { locale, namespaces: ['common', 'content'] });

// T3.11 shared item cards (`@mc/ui/content`, 07 A7–A9) — what the musalli screens and the admin preview both render.
// Religious text: the 10 §5 placeholders only.

const NOW = new Date('2026-10-24T09:30:00.000Z');
const LIBRARY: LibraryEntry = {
  id: '00000000-0000-4000-8000-0000000000aa',
  kind: 'dua',
  arabic: 'نص تجريبي للعرض فقط',
  transliteration: { en: 'Sample transliteration — DEV ONLY' },
  translation: { en: 'Sample translation text for development. Not a real hadith.' },
  reference: 'DEV-SAMPLE-001',
  sourceName: 'Development fixture',
  sourceLicense: 'N/A — not for production',
};
const base = {
  masjidId: '0a1b2c3d-4e5f-4a6b-8c7d-8e9f0a1b2c3d',
  audience: 'everyone',
  isImportant: false,
  publishedAt: '2026-10-24T06:00:00.000Z',
} as const;
const NOTICE: FeedItem = {
  ...base,
  publicId: 'noticeAAAAAA',
  type: 'announcement',
  templateKey: 'no_water',
  templateParams: { hours: { start: '10:00', end: '14:00' } },
  isImportant: true,
  announcement: { category: 'facilities' },
};
const TEMPLATE: NoticeTemplate = {
  key: 'no_water',
  category: 'facilities',
  icon: 'drop',
  isImportantDefault: true,
  title: { en: 'No water supply', hi: 'x', ur: 'x', te: 'x' },
  body: { en: 'Water will not be available from {hours_start} to {hours_end}.', hi: '', ur: '', te: '' },
  params: [{ name: 'hours', type: 'time_range', required: true }],
  system: false,
};
const DAILY: FeedItem = {
  ...base,
  publicId: 'dailyAAAAAAA',
  type: 'daily_content',
  daily: { kind: 'ayah', note: 'Test note', library: { ...LIBRARY, kind: 'ayah' } },
};
const DUA: FeedItem = {
  ...base,
  publicId: 'duaAAAAAAAAA',
  type: 'dua_request',
  body: 'Test dua request message.',
  dua: { category: 'inteqal', namePrivate: false, personName: ' Test Person A ', janazaAt: '2026-10-24T11:45:00.000Z' },
};

afterEach(() => {
  cleanup();
});

describe('useNoticeBody', () => {
  it('free text as written; a template body filled with params formatted for the locale', async () => {
    const i18n = await createI18n('en', ['common']);
    const wrapper = ({ children }: { readonly children: React.ReactNode }) => (
      <I18nProvider instance={i18n} initialLocale="en">
        {children}
      </I18nProvider>
    );
    const { templateKey: _key, templateParams: _params, ...own } = NOTICE;
    expect(renderHook(() => useNoticeBody({ ...own, body: 'Own words' }, undefined), { wrapper }).result.current).toBe(
      'Own words',
    );
    expect(renderHook(() => useNoticeBody({ ...own, body: '  ' }, undefined), { wrapper }).result.current).toBe(
      undefined,
    );
    // Templates still loading: nothing yet (the title says it all).
    expect(renderHook(() => useNoticeBody(NOTICE, undefined), { wrapper }).result.current).toBeUndefined();
    const template = renderHook(() => useNoticeBody(NOTICE, [TEMPLATE]), { wrapper });
    await waitFor(() => {
      expect(template.result.current).toMatch(/^Water will not be available from 10:00\sAM to 2:00\sPM\.$/);
    });
  });
});

describe('item cards', () => {
  it('AnnouncementItemCard: template title and body, Important + category tags, one button', async () => {
    const onPress = vi.fn();
    await renderCard(<AnnouncementItemCard item={NOTICE} templates={[TEMPLATE]} now={NOW} onPress={onPress} />);
    const card = screen.getByRole('button', { name: 'No water supply' });
    await waitFor(() => {
      expect(card.textContent).toMatch(/Water will not be available/);
    });
    expect(card.textContent).toContain('Important');
    expect(card.textContent).toContain('Facilities');
    fireEvent.click(card);
    expect(onPress).toHaveBeenCalledOnce();
  });

  it('DailyItemCard: the hero with "Today\'s Ayah", the masjid\'s note, English fallback tag; null without library', async () => {
    const { container, rerender } = await renderCard(
      <DailyItemCard
        item={DAILY}
        hero
        today
        saved={false}
        onToggleSave={vi.fn()}
        onShare={vi.fn()}
        onReadFull={vi.fn()}
      />,
      'hi',
    );
    expect(container.textContent).toContain(LIBRARY.arabic);
    expect(container.textContent).toContain('Test note');
    expect(container.textContent).toContain('DEV-SAMPLE-001');
    expect(container.querySelector('svg')).not.toBeNull();
    rerender(
      <DailyItemCard
        item={{ ...DAILY, daily: { kind: 'ayah' } }}
        hero
        today
        saved={false}
        onToggleSave={vi.fn()}
        onShare={vi.fn()}
        onReadFull={vi.fn()}
      />,
    );
    expect(container.innerHTML).toBe('');
  });

  it('DuaItemCard: the named person (trimmed), janaza row, Ameen state from props', async () => {
    const onSay = vi.fn();
    await renderCard(<DuaItemCard item={DUA} now={NOW} ameen={{ said: false, count: 3, onSay }} onPress={vi.fn()} />);
    expect(screen.getByText(/Test Person A/).textContent).not.toMatch(/^\s|\s$/);
    expect(document.body.textContent).toMatch(/Today, 5:15\sPM/);
    const ameen = screen.getByRole('button', { name: /Ameen/ });
    fireEvent.click(ameen);
    expect(onSay).toHaveBeenCalledOnce();
  });

  it('janazaWhen: today vs another day (IST)', () => {
    const format = formatters('en');
    expect(janazaWhen('2026-10-24T11:45:00.000Z', NOW, format, 'Today')).toMatch(/^Today, 5:15\sPM$/);
    expect(janazaWhen('2026-10-25T11:45:00.000Z', NOW, format, 'Today')).toMatch(/^Sun, 25 Oct, 5:15\sPM$/);
  });
});

describe('FeedItemCard (the preview of a fresh item)', () => {
  it('picks the section card by type: notice, today’s hero, dua with nobody’s Ameen', async () => {
    const { container, rerender } = await renderCard(<FeedItemCard item={DAILY} templates={[]} now={NOW} />);
    expect(container.textContent).toMatch(/Today/);
    rerender(<FeedItemCard item={DUA} templates={[]} now={NOW} />);
    expect(screen.getByRole('button', { name: /Ameen/ }).getAttribute('aria-pressed')).not.toBe('true');
    rerender(<FeedItemCard item={NOTICE} templates={[TEMPLATE]} now={NOW} />);
    expect(screen.getByRole('button', { name: 'No water supply' })).toBeTruthy();
    // Buttons do nothing in a preview.
    fireEvent.click(screen.getByRole('button', { name: 'No water supply' }));
  });

  it('renders nothing for types without a section card yet', async () => {
    const { container } = await renderCard(
      <FeedItemCard item={{ ...base, publicId: 'videoAAAAAAA', type: 'video' }} templates={[]} now={NOW} />,
    );
    expect(container.innerHTML).toBe('');
  });
});
