// @vitest-environment jsdom
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { LOCALE_STORAGE_KEY } from '../src/locales.ts';
import { I18nProvider, initialDocumentLocale, Money, Time, useLocale, useTranslation } from '../src/react.tsx';

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
