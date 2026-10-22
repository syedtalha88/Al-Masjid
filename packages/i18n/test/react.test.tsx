// @vitest-environment jsdom
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { LOCALE_STORAGE_KEY } from '../src/locales.ts';
import {
  HijriDate,
  I18nProvider,
  initialDocumentLocale,
  Money,
  Time,
  useHijriLabel,
  useLocale,
  useTranslation,
} from '../src/react.tsx';

function Probe() {
  const { t } = useTranslation();
  const { locale, setLocale } = useLocale();
  return (
    <main>
      <h1>{t('language.label')}</h1>
      <p data-testid="plural">{t('newUpdates', { count: 3 })}</p>
      <p data-testid="locale">{locale}</p>
      <p data-testid="money">
        <Money paise={10_000_000} />
      </p>
      <p data-testid="time">
        <Time value="18:40" />
      </p>
      <button type="button" onClick={() => void setLocale('ur')}>
        switch
      </button>
    </main>
  );
}

beforeEach(() => {
  document.documentElement.lang = 'en';
  document.documentElement.dir = 'ltr';
  localStorage.clear();
});

afterEach(cleanup);

describe('I18nProvider', () => {
  it('renders the fallback, then English strings with ICU plurals', async () => {
    render(
      <I18nProvider initialLocale="en" fallback={<p>booting</p>}>
        <Probe />
      </I18nProvider>,
    );
    expect(screen.getByText('booting')).toBeTruthy();
    expect(await screen.findByRole('heading', { name: 'Language' })).toBeTruthy();
    expect(screen.getByTestId('plural').textContent).toBe('3 new updates');
  });

  it('switches to Urdu without a reload: <html lang=ur dir=rtl>, translated text, mirrored to storage', async () => {
    render(
      <I18nProvider initialLocale="en">
        <Probe />
      </I18nProvider>,
    );
    const button = await screen.findByRole('button', { name: 'switch' });
    await act(async () => {
      button.click();
      await Promise.resolve();
    });

    expect(await screen.findByRole('heading', { name: 'زبان' })).toBeTruthy();
    expect(screen.getByTestId('locale').textContent).toBe('ur');
    expect(document.documentElement.lang).toBe('ur');
    expect(document.documentElement.dir).toBe('rtl');
    expect(localStorage.getItem(LOCALE_STORAGE_KEY)).toBe('ur');
  });

  it('isolates amounts and times in <bdi dir=ltr> so RTL text never reorders them', async () => {
    render(
      <I18nProvider initialLocale="ur">
        <Probe />
      </I18nProvider>,
    );
    await screen.findByRole('heading', { name: 'زبان' });
    const money = screen.getByTestId('money').querySelector('bdi');
    const time = screen.getByTestId('time').querySelector('bdi');
    expect(money?.getAttribute('dir')).toBe('ltr');
    expect(money?.textContent).toBe('₹1,00,000');
    expect(time?.getAttribute('dir')).toBe('ltr');
    expect(time?.textContent).toBe('6:40 PM');
  });
});

describe('HijriDate (PROGRESS F13: our own month names, Latin digits)', () => {
  const RABI_AKHIR = { year: 1448, month: 4, day: 16 };

  it.each([
    ['en', '16 Rabi’ al-Akhir 1448'],
    ['hi', '16 रबी उस-सानी 1448'],
    ['ur', '16 ربیع الثانی 1448'],
    ['te', '16 రబీ ఉస్ సానీ 1448'],
  ] as const)('%s', async (locale, expected) => {
    render(
      <I18nProvider initialLocale={locale}>
        <p data-testid="hijri">
          <HijriDate value={RABI_AKHIR} />
        </p>
      </I18nProvider>,
    );
    expect((await screen.findByTestId('hijri')).textContent).toBe(expected);
  });

  it('names all twelve months and refuses a thirteenth', async () => {
    const names: string[] = [];
    let error: unknown;
    function Months() {
      const label = useHijriLabel();
      for (let month = 1; month <= 12; month += 1) names.push(label({ year: 1448, month, day: 1 }));
      try {
        label({ year: 1448, month: 13, day: 1 });
      } catch (caught) {
        error = caught;
      }
      return <p>months</p>;
    }
    render(
      <I18nProvider initialLocale="en">
        <Months />
      </I18nProvider>,
    );
    await screen.findByText('months');
    expect(new Set(names.slice(-12)).size).toBe(12);
    expect(names.at(-12)).toBe('1 Muharram 1448');
    expect(names.at(-4)).toBe('1 Ramadan 1448');
    expect(error).toBeInstanceOf(RangeError);
  });
});

describe('helpers', () => {
  it('initialDocumentLocale trusts only a supported <html lang>', () => {
    document.documentElement.lang = 'te';
    expect(initialDocumentLocale()).toBe('te');
    document.documentElement.lang = 'xx';
    expect(initialDocumentLocale()).toBe('en');
  });

  it('useLocale outside the provider fails loudly', () => {
    function Orphan() {
      useLocale();
      return null;
    }
    // React logs the thrown render error; keep test output clean.
    const silence = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      expect(() => render(<Orphan />)).toThrow(/inside <I18nProvider>/u);
    } finally {
      silence.mockRestore();
    }
  });
});
