// Design tokens (06 §2–4) — the single source of truth. `pnpm --filter @mc/ui generate` writes
// `tokens.css` and `type.css` from this file; a unit test fails if they drift. Components use the semantic
// Tailwind names (`bg-primary-700`, `text-text-secondary`, `type-headline`) — never raw values.

/**
 * Colors (06 §2). Six foregrounds were darkened from the sampled reference values to pass WCAG AA
 * (≥ 4.5:1) on every background they are used on — PROGRESS F8, DECISIONS #41:
 * text-tertiary #8A938E→#676F6A, danger #C93C3C→#C43636, rose #B4475A→#AD4456, info #2E6BE6→#2363E5,
 * heart #D64550→#CB2D39, facilities #9A6A00→#926500.
 */
export const COLORS = {
  'primary-900': '#0A3324',
  'primary-800': '#0E4430',
  'primary-700': '#13543C',
  'primary-600': '#1B6B4C',
  'primary-500': '#2C956B',
  'mint-200': '#C3E3CF',
  'mint-100': '#DCEEE2',
  'mint-50': '#ECF6EE',
  bg: '#F8F8F5',
  surface: '#FFFFFF',
  'surface-muted': '#F2F3EF',
  border: '#E6E8E3',
  text: '#111814',
  'text-secondary': '#5B6560',
  'text-tertiary': '#676F6A',
  'on-primary': '#FFFFFF',
  sun: '#F2B233',
  'sun-bg': '#FFF4DA',
  facilities: '#926500',
  danger: '#C43636',
  'danger-bg': '#FDECEB',
  rose: '#AD4456',
  'rose-bg': '#FBE3E6',
  info: '#2363E5',
  'info-bg': '#EAF1FE',
  slate: '#5E6B7A',
  'slate-bg': '#EEF1F5',
  purple: '#6B4FD8',
  'purple-bg': '#F1EDFE',
  heart: '#CB2D39',
  'heart-bg': '#FDECEE',
  overlay: 'rgb(10 20 15 / 0.45)',
  focus: '#1B6B4C',
} as const;

export type ColorToken = keyof typeof COLORS;

/**
 * Text/background pairs used by the design (06 §2 category table, buttons, tags, notes). Every pair must
 * pass WCAG AA for normal text (4.5:1) — enforced by `test/contrast.test.ts`.
 */
export const TEXT_PAIRS: readonly (readonly [fg: ColorToken, bg: ColorToken])[] = [
  ['text', 'bg'],
  ['text', 'surface'],
  ['text', 'surface-muted'],
  ['text-secondary', 'bg'],
  ['text-secondary', 'surface'],
  ['text-secondary', 'surface-muted'],
  ['text-tertiary', 'bg'],
  ['text-tertiary', 'surface'],
  ['text-tertiary', 'surface-muted'],
  ['primary-700', 'surface'],
  ['primary-700', 'bg'],
  ['primary-700', 'mint-50'],
  ['primary-700', 'mint-100'],
  ['primary-800', 'mint-100'],
  ['primary-900', 'mint-50'],
  ['on-primary', 'primary-700'],
  ['on-primary', 'primary-800'],
  ['on-primary', 'danger'],
  ['danger', 'danger-bg'],
  ['danger', 'surface'],
  ['rose', 'rose-bg'],
  ['info', 'info-bg'],
  ['slate', 'slate-bg'],
  ['purple', 'purple-bg'],
  ['heart', 'heart-bg'],
  ['facilities', 'sun-bg'],
];

/** Radius scale (06 §4). `rounded-full` is a Tailwind built-in. */
export const RADII = { xs: '8px', sm: '12px', md: '16px', lg: '20px', xl: '28px' } as const;

/** Elevation (06 §4): very soft, warm. */
export const SHADOWS = {
  e1: '0 1px 2px rgb(17 24 20 / 0.04), 0 4px 14px rgb(17 24 20 / 0.05)',
  e2: '0 -2px 10px rgb(17 24 20 / 0.04), 0 8px 28px rgb(17 24 20 / 0.08)',
  fab: '0 8px 20px rgb(19 84 60 / 0.32), 0 2px 6px rgb(19 84 60 / 0.2)',
} as const;

export type TypeFamily = 'ui' | 'arabic';

export interface TypeStyle {
  /** Font size in px (Latin, musalli app). */
  readonly size: number;
  /** Line height in px. */
  readonly lineHeight: number;
  readonly weight: 400 | 500 | 600 | 700;
  /** Letter spacing in em (dropped for hi/te/ur — 06 §3). */
  readonly tracking: number;
  readonly family: TypeFamily;
  /** Tabular figures (times, amounts). */
  readonly tabular?: boolean;
}

/** Type scale (06 §3) → `type-<name>` utilities. Locale/admin adjustments are applied in CSS. */
export const TYPE_SCALE = {
  'large-title': { size: 28, lineHeight: 34, weight: 700, tracking: -0.02, family: 'ui' },
  title1: { size: 22, lineHeight: 28, weight: 700, tracking: -0.01, family: 'ui' },
  title2: { size: 20, lineHeight: 26, weight: 700, tracking: -0.01, family: 'ui' },
  headline: { size: 17, lineHeight: 22, weight: 600, tracking: -0.005, family: 'ui' },
  body: { size: 15, lineHeight: 22, weight: 400, tracking: 0, family: 'ui' },
  callout: { size: 14, lineHeight: 20, weight: 400, tracking: 0, family: 'ui' },
  'subhead-strong': { size: 14, lineHeight: 20, weight: 600, tracking: 0, family: 'ui' },
  footnote: { size: 13, lineHeight: 18, weight: 400, tracking: 0, family: 'ui' },
  caption: { size: 12, lineHeight: 16, weight: 500, tracking: 0.01, family: 'ui' },
  micro: { size: 11, lineHeight: 14, weight: 600, tracking: 0.01, family: 'ui' },
  'time-large': { size: 17, lineHeight: 22, weight: 600, tracking: 0, family: 'ui', tabular: true },
  'amount-large': { size: 24, lineHeight: 30, weight: 700, tracking: -0.01, family: 'ui', tabular: true },
  'arabic-hero': { size: 28, lineHeight: 52, weight: 400, tracking: 0, family: 'arabic' },
  'arabic-body': { size: 22, lineHeight: 40, weight: 400, tracking: 0, family: 'arabic' },
} as const satisfies Record<string, TypeStyle>;

export type TypeToken = keyof typeof TYPE_SCALE;

/** Locale adjustments (06 §3), applied through CSS variables on `<html lang>`. */
export const LOCALE_TYPE = {
  /** hi, te: line-height × 1.12, no tracking. */
  indicLineHeightScale: 1.12,
  /** ur (Nastaliq): +2px size, line-height ≥ 1.9 × size, no tracking. */
  urduSizeBumpPx: 2,
  urduMinLineHeight: 1.9,
  /** Admin app: everything +2px (body 17/24, headline 19/26 — 06 §3). */
  adminSizeBumpPx: 2,
} as const;

/** Screen gutter (06 §4): 20px, 16px under 360px width. Max content width 560px. */
export const LAYOUT = { gutterPx: 20, narrowGutterPx: 16, narrowBelowPx: 360, maxContentPx: 560 } as const;
