// @vitest-environment jsdom
import { createI18n } from '@mc/i18n';
import { directionOf, type Locale, LOCALES } from '@mc/i18n/locales';
import { I18nProvider } from '@mc/i18n/react';
import { STARTER_TEMPLATES } from '@mc/i18n/templates';
import type { FeedItem, LibraryEntry, NoticeTemplate } from '@mc/shared/contracts/public';
import { PreviewFrame } from '@mc/ui/admin';
import { FeedItemCard } from '@mc/ui/content';
import { MotionProvider } from '@mc/ui/motion';
import type * as Navigation from '@mc/ui/navigation';
import { QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createApiClient } from '../../../lib/api/client.ts';
import { queryKeys } from '../../../lib/api/keys.ts';
import { type AppData, AppDataContext } from '../../../lib/data.tsx';
import { createDeviceStore, memoryBackend } from '../../../lib/device/store.ts';
import { createQueryClient } from '../../../lib/query/persist.ts';
import { AnnouncementRow } from '../AnnouncementsScreen.tsx';
import { DuaRow } from '../DuasScreen.tsx';
import { DailyCard } from '../HadithScreen.tsx';
import type { AmeenApi } from '../hooks/useAmeen.ts';

// T3.11 acceptance: the admin preview (`PreviewFrame` + `FeedItemCard`) renders exactly what the musalli app renders
// for the same item — the real musalli rows (A7–A9) against the preview, as DOM, in every locale. The preview runs in
// an admin app whose own language differs. Only React's generated ids (`useId`, different in two trees) are renamed
// in order of appearance before comparing (DECISIONS #113). Religious text: the 10 §5 placeholders only.

vi.mock('@mc/ui/navigation', async (importOriginal) => ({
  ...(await importOriginal<typeof Navigation>()),
  // The rows only push on tap; the parity test never taps.
  useNavigator: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), selectTab: vi.fn(), preload: vi.fn() }),
}));

/** Locale files and the ICU runtime load lazily (slower under coverage instrumentation). */
const LOCALE_LOAD = { timeout: 5000 };
const MASJID = '0a1b2c3d-4e5f-4a6b-8c7d-8e9f0a1b2c3d';
const NOW = new Date('2026-10-24T09:30:00.000Z');

const LIBRARY: LibraryEntry = {
  id: '00000000-0000-4000-8000-0000000000aa',
  kind: 'hadith',
  arabic: 'نص تجريبي للعرض فقط',
  transliteration: { en: 'Sample transliteration — DEV ONLY' },
  translation: { en: 'Sample translation text for development. Not a real hadith.', hi: 'नमूना अनुवाद — केवल विकास' },
  reference: 'DEV-SAMPLE-001',
  sourceName: 'Development fixture',
  sourceLicense: 'N/A — not for production',
};

const base = {
  masjidId: MASJID,
  audience: 'everyone',
  isImportant: false,
  publishedAt: '2026-10-24T06:00:00.000Z',
} as const;
const ITEMS: Readonly<Record<string, FeedItem>> = {
  templateNotice: {
    ...base,
    publicId: 'noticeAAAAAA',
    type: 'announcement',
    templateKey: 'no_water_time_range',
    templateParams: { hours: { start: '10:00', end: '14:00' } },
    isImportant: true,
    announcement: { category: 'facilities' },
  },
  ownWordsEvent: {
    ...base,
    publicId: 'noticeBBBBBB',
    type: 'announcement',
    title: 'Test event title',
    body: 'Test event body — placeholder text.',
    contentLocale: 'en',
    announcement: { category: 'event', eventAt: '2026-10-26T15:15:00.000Z' },
  },
  todaysHadith: {
    ...base,
    publicId: 'dailyAAAAAAA',
    type: 'daily_content',
    daily: { kind: 'hadith', note: 'Test note from the masjid', library: LIBRARY },
  },
  privateIllness: {
    ...base,
    publicId: 'duaAAAAAAAAA',
    type: 'dua_request',
    body: 'Test dua request message.',
    dua: { category: 'illness', namePrivate: true, library: { ...LIBRARY, kind: 'dua' } },
  },
  namedInteqal: {
    ...base,
    publicId: 'duaBBBBBBBBB',
    type: 'dua_request',
    body: 'Test inteqal message.',
    dua: {
      category: 'inteqal',
      namePrivate: false,
      personName: 'Test Person A',
      janazaAt: '2026-10-24T11:45:00.000Z',
      janazaPlace: 'Test Masjid Alpha',
    },
  },
};

const TEMPLATES: readonly NoticeTemplate[] = STARTER_TEMPLATES.map(({ important, ...template }) => ({
  ...template,
  params: [...template.params],
  isImportantDefault: important,
}));

const NO_AMEEN: AmeenApi = { said: () => false, count: () => undefined, say: vi.fn() };

/** React's `useId` values differ between two trees: each distinct id becomes `id0`, `id1`… wherever it appears. */
function normalizeIds(html: string): string {
  const ids = [...new Set([...html.matchAll(/\sid="([^"]+)"/g)].map((match) => match[1] ?? ''))];
  return ids.reduce((out, id, index) => out.split(id).join(`id${String(index)}`), html);
}

/** The musalli app's section row for `item`, as its screen renders it. */
function MusalliRow({ item }: { readonly item: FeedItem }) {
  if (item.type === 'announcement') return <AnnouncementRow item={item} now={NOW} />;
  if (item.type === 'daily_content') {
    return <DailyCard item={item} hero today saved={false} onToggleSave={vi.fn()} onShare={vi.fn()} />;
  }
  return <DuaRow item={item} now={NOW} ameen={NO_AMEEN} />;
}

/** A template notice has its body once the ICU runtime (a lazy chunk) has formatted it. */
const settled = (item: FeedItem, root: HTMLElement): boolean =>
  item.templateKey === undefined || root.querySelector('.line-clamp-3') !== null;

async function musalliHtml(item: FeedItem, locale: Locale): Promise<string> {
  document.documentElement.lang = locale;
  document.documentElement.dir = directionOf(locale);
  const queryClient = createQueryClient();
  queryClient.setQueryData(queryKeys.templates(), { templates: TEMPLATES });
  const store = createDeviceStore(memoryBackend(), locale);
  await store.load();
  const api = createApiClient({ base: 'https://app.test/api/v1', credentials: () => undefined });
  const data: AppData = {
    store,
    api,
    queryClient,
    sync: { store, api, turnstileToken: () => Promise.resolve('x'), platform: 'android' },
  };
  const i18n = await createI18n(locale, ['common', 'content']);
  const { container, unmount } = render(
    <I18nProvider instance={i18n} initialLocale={locale}>
      <MotionProvider>
        <AppDataContext value={data}>
          <QueryClientProvider client={queryClient}>
            <MusalliRow item={item} />
          </QueryClientProvider>
        </AppDataContext>
      </MotionProvider>
    </I18nProvider>,
  );
  await waitFor(() => {
    expect(settled(item, container)).toBe(true);
  }, LOCALE_LOAD);
  const html = container.innerHTML;
  unmount();
  return html;
}

async function previewHtml(item: FeedItem, locale: Locale): Promise<string> {
  // The admin app runs in another language than the preview.
  const adminLocale: Locale = locale === 'ur' ? 'te' : 'ur';
  document.documentElement.lang = adminLocale;
  document.documentElement.dir = directionOf(adminLocale);
  document.documentElement.dataset['app'] = 'admin';
  const i18n = await createI18n(adminLocale, ['common', 'admin']);
  const { container, unmount } = render(
    <I18nProvider instance={i18n} initialLocale={adminLocale}>
      <MotionProvider>
        <PreviewFrame locale={locale} onLocaleChange={vi.fn()} label="Preview" languageLabel="Show in">
          <FeedItemCard item={item} templates={TEMPLATES} now={NOW} />
        </PreviewFrame>
      </MotionProvider>
    </I18nProvider>,
  );
  const screen = await waitFor(() => {
    const element = container.querySelector<HTMLElement>(`[data-preview-locale="${locale}"]`);
    expect(element).not.toBeNull();
    expect(element !== null && settled(item, element)).toBe(true);
    return element as HTMLElement; // checked just above
  }, LOCALE_LOAD);
  expect(screen.getAttribute('lang')).toBe(locale);
  expect(screen.getAttribute('dir')).toBe(directionOf(locale));
  // The admin document keeps its own language.
  expect(document.documentElement.lang).toBe(adminLocale);
  const html = screen.innerHTML;
  unmount();
  delete document.documentElement.dataset['app'];
  return html;
}

afterEach(() => {
  cleanup();
});

describe('PreviewFrame shows exactly the musalli rendering (T3.11)', () => {
  for (const locale of LOCALES) {
    for (const [key, item] of Object.entries(ITEMS)) {
      it(`${key} in ${locale}`, async () => {
        const musalli = await musalliHtml(item, locale);
        const preview = await previewHtml(item, locale);
        expect(musalli.length).toBeGreaterThan(0);
        expect(normalizeIds(preview)).toBe(normalizeIds(musalli));
      });
    }
  }

  it('a template body is in the output (not still loading) on both sides', async () => {
    const item = ITEMS['templateNotice'] as FeedItem; // defined above
    const musalli = await musalliHtml(item, 'en');
    // The time formatter puts a no-break space before AM/PM (`&nbsp;` in HTML).
    expect(musalli).toMatch(
      /Water will not be available from [\u2066\u2069]?10:00(&nbsp;|\s)AM[\u2066\u2069]? to [\u2066\u2069]?2:00(&nbsp;|\s)PM[\u2066\u2069]?\./,
    );
    const preview = await previewHtml(item, 'en');
    expect(normalizeIds(preview)).toBe(normalizeIds(musalli));
  });
});
