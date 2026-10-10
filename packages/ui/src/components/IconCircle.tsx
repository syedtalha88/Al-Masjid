import type { ReactNode } from 'react';

import { type Tone, TONE_CLASS } from './tone.ts';

export type IconCircleSize = 44 | 48 | 56;

const SIZE: Readonly<Record<IconCircleSize, string>> = { 44: 'size-11', 48: 'size-12', 56: 'size-14' };

export interface IconCircleProps {
  readonly tone?: Tone;
  readonly size?: IconCircleSize;
  /** The icon (decorative — the row/card next to it carries the text). */
  readonly children: ReactNode;
  readonly className?: string;
}

/** Tinted circle with a category icon (06 §2 mapping, §6): 44 / 48 / 56 px. */
export function IconCircle({ tone = 'primary', size = 44, children, className }: IconCircleProps) {
  return (
    <span
      aria-hidden
      className={`inline-flex shrink-0 items-center justify-center rounded-full ${SIZE[size]} ${TONE_CLASS[tone]} ${
        className ?? ''
      }`}
    >
      {children}
    </span>
  );
}
