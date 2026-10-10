import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { LOCALES } from '@mc/i18n/locales';
import { describe, expect, it } from 'vitest';

import { unicodeRangeFor } from '../scripts/fonts-css.ts';
import { FONT_FILES, fontBaseName, INTER_FALLBACKS, LOCALE_PRELOAD_FONTS, UI_FONT_STACK } from '../src/fonts/fonts.ts';

const root = fileURLToPath(new URL('..', import.meta.url));
const SCRIPT_FONTS = {
  hi: FONT_FILES.devanagari.family,
  te: FONT_FILES.telugu.family,
  ur: FONT_FILES.nastaliq.family,
} as const;

describe('fonts (09 §6)', () => {
  it('every declared file exists in its package and has an upstream unicode-range', () => {
    for (const font of Object.values(FONT_FILES)) {
      expect(existsSync(`${root}node_modules/${font.file}`), font.file).toBe(true);
      expect(unicodeRangeFor(font)).toMatch(/^U\+[0-9A-F]/);
    }
  });

  it('Inter covers Latin only (no latin-ext download just for ₹ — DECISIONS #41)', () => {
    expect(unicodeRangeFor(FONT_FILES.inter)).not.toMatch(/20B9|20AD-20C0/);
  });

  it.each(LOCALES)('%s stack: Inter first, metric fallbacks next, only its own script font', (locale) => {
    const stack = UI_FONT_STACK[locale];
    expect(stack.startsWith(`'${FONT_FILES.inter.family}', ${INTER_FALLBACKS.join(', ')}`)).toBe(true);
    for (const [other, family] of Object.entries(SCRIPT_FONTS)) {
      expect(stack.includes(family), `${locale} vs ${other}`).toBe(other === locale);
    }
    expect(stack).not.toContain('Amiri');
  });

  it('preloads only the active locale UI fonts; never Nastaliq (lazy) or Amiri', () => {
    expect(LOCALE_PRELOAD_FONTS.en).toEqual(['inter']);
    expect(LOCALE_PRELOAD_FONTS.hi).toEqual(['inter', 'devanagari']);
    expect(LOCALE_PRELOAD_FONTS.te).toEqual(['inter', 'telugu']);
    expect(LOCALE_PRELOAD_FONTS.ur).toEqual(['inter']);
    expect(fontBaseName('devanagari')).toBe('noto-sans-devanagari-devanagari-wght-normal');
  });
});
