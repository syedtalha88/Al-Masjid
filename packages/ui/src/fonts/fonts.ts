// Self-hosted fonts (06 §3, 09 §6). Only the subsets we use are declared, each with the `unicode-range`
// from its Fontsource CSS, so a browser downloads a file only when text in that range renders with that
// family. Per-locale stacks put Inter first (Latin, times, amounts) and the locale's script font second.
// `fonts.css` is generated from this file (`pnpm --filter @mc/ui generate`).
import type { Locale } from '@mc/i18n/locales';

export interface FontFile {
  /** CSS font-family name (Fontsource naming). */
  readonly family: string;
  /** Package path of the woff2 file (resolved from packages/ui/node_modules). */
  readonly file: string;
  /** `font-weight` descriptor: a range for variable fonts. */
  readonly weight: string;
  readonly format: 'woff2' | 'woff2-variations';
}

/**
 * Inter ships Latin only: its latin-ext file (85 KB) would be needed mostly for "₹", which the metric-matched
 * system fallback renders instead (DECISIONS #41).
 */
export const FONT_FILES = {
  inter: {
    family: 'Inter Variable',
    file: '@fontsource-variable/inter/files/inter-latin-wght-normal.woff2',
    weight: '100 900',
    format: 'woff2-variations',
  },
  devanagari: {
    family: 'Noto Sans Devanagari Variable',
    file: '@fontsource-variable/noto-sans-devanagari/files/noto-sans-devanagari-devanagari-wght-normal.woff2',
    weight: '100 900',
    format: 'woff2-variations',
  },
  telugu: {
    family: 'Noto Sans Telugu Variable',
    file: '@fontsource-variable/noto-sans-telugu/files/noto-sans-telugu-telugu-wght-normal.woff2',
    weight: '100 900',
    format: 'woff2-variations',
  },
  nastaliq: {
    family: 'Noto Nastaliq Urdu Variable',
    file: '@fontsource-variable/noto-nastaliq-urdu/files/noto-nastaliq-urdu-arabic-wght-normal.woff2',
    weight: '400 700',
    format: 'woff2-variations',
  },
  amiri400: {
    family: 'Amiri',
    file: '@fontsource/amiri/files/amiri-arabic-400-normal.woff2',
    weight: '400',
    format: 'woff2',
  },
  amiri700: {
    family: 'Amiri',
    file: '@fontsource/amiri/files/amiri-arabic-700-normal.woff2',
    weight: '700',
    format: 'woff2',
  },
} as const satisfies Record<string, FontFile>;

export type FontKey = keyof typeof FONT_FILES;

/** System fonts per script, used while the web font loads (`font-display: swap`) or if it fails. */
const SYSTEM = {
  latin: ['system-ui', 'sans-serif'],
  devanagari: ["'Noto Sans Devanagari'", "'Kohinoor Devanagari'"],
  telugu: ["'Noto Sans Telugu'", "'Kohinoor Telugu'"],
  urdu: ["'Noto Nastaliq Urdu'", "'Noto Naskh Arabic'", "'Geeza Pro'"],
  arabic: ["'Noto Naskh Arabic'", "'Geeza Pro'", 'serif'],
} as const;

/** Metric-matched Inter fallbacks (generated with Capsize into `font-fallbacks.css`). */
export const INTER_FALLBACKS = ["'Inter Fallback: Arial'", "'Inter Fallback: Roboto'"] as const;

const quote = (family: string) => `'${family}'`;
const latinStack = [quote(FONT_FILES.inter.family), ...INTER_FALLBACKS];

/** UI font stack per locale (`--mc-font-ui`). */
export const UI_FONT_STACK: Readonly<Record<Locale, string>> = {
  en: [...latinStack, ...SYSTEM.latin].join(', '),
  hi: [...latinStack, quote(FONT_FILES.devanagari.family), ...SYSTEM.devanagari, ...SYSTEM.latin].join(', '),
  te: [...latinStack, quote(FONT_FILES.telugu.family), ...SYSTEM.telugu, ...SYSTEM.latin].join(', '),
  ur: [...latinStack, quote(FONT_FILES.nastaliq.family), ...SYSTEM.urdu, ...SYSTEM.latin].join(', '),
};

/** Arabic religious text in every locale (`--mc-font-arabic`, 06 §3). */
export const ARABIC_FONT_STACK = [quote(FONT_FILES.amiri400.family), ...SYSTEM.arabic].join(', ');

/**
 * Fonts preloaded by `/boot.js` for the active locale (09 §6). Nastaliq is not preloaded: Urdu shows the
 * system font first and swaps (lazy, 09 §6); Amiri loads only when Arabic text renders.
 */
export const LOCALE_PRELOAD_FONTS: Readonly<Record<Locale, readonly FontKey[]>> = {
  en: ['inter'],
  hi: ['inter', 'devanagari'],
  te: ['inter', 'telugu'],
  ur: ['inter'],
};

/** The emitted file's base name (`inter-latin-wght-normal`) — Vite adds a content hash after it. */
export const fontBaseName = (key: FontKey): string =>
  FONT_FILES[key].file.slice(FONT_FILES[key].file.lastIndexOf('/') + 1, -'.woff2'.length);
