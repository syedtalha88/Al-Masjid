import { runInNewContext } from 'node:vm';

import { describe, expect, it } from 'vitest';

import { BOOT_SCRIPT, bootDocumentLocale, type BootEnvironment } from '../src/boot.ts';
import { LOCALE_STORAGE_KEY, LOCALES, RTL_LOCALES } from '../src/locales.ts';

interface FakeOptions {
  readonly stored?: string | null;
  readonly languages?: readonly string[];
  readonly storageThrows?: boolean;
  readonly noStorage?: boolean;
}

function fakeEnv({ stored = null, languages = [], storageThrows = false, noStorage = false }: FakeOptions = {}) {
  const documentElement = { lang: '', dir: '' };
  const env: BootEnvironment = {
    localStorage: noStorage
      ? undefined
      : {
          getItem: (key) => {
            if (storageThrows) throw new Error('SecurityError: storage blocked');
            return key === LOCALE_STORAGE_KEY ? stored : null;
          },
        },
    navigator: { languages },
    document: { documentElement },
  };
  return { env, documentElement };
}

const boot = (env: BootEnvironment) => bootDocumentLocale(env, LOCALE_STORAGE_KEY, LOCALES, RTL_LOCALES, 'en');

describe('bootDocumentLocale', () => {
  it('uses the stored choice first and sets dir=rtl for Urdu', () => {
    const { env, documentElement } = fakeEnv({ stored: 'ur', languages: ['hi-IN'] });
    expect(boot(env)).toBe('ur');
    expect(documentElement).toEqual({ lang: 'ur', dir: 'rtl' });
  });

  it('falls back to the browser languages when nothing (or garbage) is stored', () => {
    expect(boot(fakeEnv({ languages: ['ta-IN', 'te-IN'] }).env)).toBe('te');
    const { env, documentElement } = fakeEnv({ stored: '<script>', languages: ['hi'] });
    expect(boot(env)).toBe('hi');
    expect(documentElement).toEqual({ lang: 'hi', dir: 'ltr' });
  });

  it('defaults to English and never throws when storage is blocked or missing', () => {
    const blocked = fakeEnv({ storageThrows: true, languages: ['ur'] });
    expect(boot(blocked.env)).toBe('en');
    expect(blocked.documentElement).toEqual({ lang: 'en', dir: 'ltr' });
    expect(boot(fakeEnv({ noStorage: true }).env)).toBe('en');
  });
});

describe('BOOT_SCRIPT', () => {
  // Runs the serialized source in an empty realm: proves it is self-contained (no imports, no bundler helpers).
  function run(options: FakeOptions) {
    const { env, documentElement } = fakeEnv(options);
    runInNewContext(BOOT_SCRIPT, { window: env });
    return documentElement;
  }

  it('is self-contained and applies the stored locale', () => {
    expect(run({ stored: 'ur' })).toEqual({ lang: 'ur', dir: 'rtl' });
    expect(run({ languages: ['te'] })).toEqual({ lang: 'te', dir: 'ltr' });
    expect(run({ storageThrows: true })).toEqual({ lang: 'en', dir: 'ltr' });
  });

  it('is a small classic script (no module syntax)', () => {
    expect(BOOT_SCRIPT).not.toMatch(/\b(import|export)\b/u);
    expect(BOOT_SCRIPT.length).toBeLessThan(2048);
  });
});
