import { runInNewContext } from 'node:vm';

import { describe, expect, it } from 'vitest';

import { BOOT_SCRIPT, bootDocumentLocale, type BootEnvironment, type BootLink, bootScript } from '../src/boot.ts';
import { LOCALE_STORAGE_KEY, LOCALES, RTL_LOCALES } from '../src/locales.ts';
import { resolveFontPreloads } from '../src/vite-plugin.ts';

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

describe('font preloads (09 §6)', () => {
  function withHead(options: FakeOptions) {
    const { env, documentElement } = fakeEnv(options);
    const links: BootLink[] = [];
    const full: BootEnvironment = {
      ...env,
      document: {
        documentElement,
        head: { appendChild: (link) => links.push(link) },
        createElement: () => ({ rel: '', as: '', type: '', crossOrigin: null, href: '' }),
      },
    };
    return { env: full, links };
  }
  const PRELOADS = { en: ['/assets/inter-a1.woff2'], hi: ['/assets/inter-a1.woff2', '/assets/deva-b2.woff2'] };

  it('preloads only the active locale fonts, in CORS mode', () => {
    const { env, links } = withHead({ stored: 'hi' });
    bootDocumentLocale(env, LOCALE_STORAGE_KEY, LOCALES, RTL_LOCALES, 'en', PRELOADS);
    expect(links.map((link) => link.href)).toEqual(PRELOADS.hi);
    expect(links.every((link) => link.rel === 'preload' && link.as === 'font')).toBe(true);
    expect(links.every((link) => link.type === 'font/woff2' && link.crossOrigin === 'anonymous')).toBe(true);
  });

  it('adds nothing for a locale without preloads, and survives a missing head', () => {
    const { env, links } = withHead({ stored: 'ur' });
    expect(bootDocumentLocale(env, LOCALE_STORAGE_KEY, LOCALES, RTL_LOCALES, 'en', PRELOADS)).toBe('ur');
    expect(links).toEqual([]);
    expect(boot(fakeEnv({ stored: 'hi' }).env)).toBe('hi');
  });

  it('bootScript embeds the preload map and still runs in an empty realm', () => {
    const { env, links } = withHead({ stored: 'en' });
    runInNewContext(bootScript(PRELOADS), { window: env });
    expect(links.map((link) => link.href)).toEqual(PRELOADS.en);
  });
});

describe('resolveFontPreloads', () => {
  const bundle = ['assets/inter-latin-wght-normal-Dx4kXJAl.woff2', 'assets/index-abc123.js'];

  it('maps base names to hashed asset URLs', () => {
    expect(resolveFontPreloads(bundle, { en: ['inter-latin-wght-normal'] })).toEqual({
      en: ['/assets/inter-latin-wght-normal-Dx4kXJAl.woff2'],
    });
  });

  it('fails the build when a configured font is missing', () => {
    expect(() => resolveFontPreloads(bundle, { hi: ['noto-sans-devanagari-devanagari-wght-normal'] })).toThrow(
      /not in the build output/,
    );
  });
});
