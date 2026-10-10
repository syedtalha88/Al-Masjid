/**
 * Category tones (06 §2 "Category → color mapping"): a tinted background with its matching foreground.
 * Used by IconCircle, Tag and anything else that carries a category color. Class strings are literal so
 * Tailwind finds them.
 */
export type Tone = 'primary' | 'danger' | 'info' | 'rose' | 'slate' | 'purple' | 'heart' | 'sun' | 'neutral';

export const TONE_CLASS: Readonly<Record<Tone, string>> = {
  primary: 'bg-mint-50 text-primary-700',
  danger: 'bg-danger-bg text-danger',
  info: 'bg-info-bg text-info',
  rose: 'bg-rose-bg text-rose',
  slate: 'bg-slate-bg text-slate',
  purple: 'bg-purple-bg text-purple',
  heart: 'bg-heart-bg text-heart',
  sun: 'bg-sun-bg text-facilities',
  neutral: 'bg-surface-muted text-text-secondary',
};
