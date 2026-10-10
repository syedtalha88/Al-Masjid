import type { ReactNode } from 'react';

export interface ArabicTextProps {
  /** Arabic religious text — only ever from the owner's licensed import (CLAUDE.md §2.3), never typed in code. */
  readonly children: ReactNode;
  /** `hero` = today's hadith/ayah (28/52), `body` = dua box and other cards (22/40). */
  readonly variant?: 'hero' | 'body';
  readonly align?: 'center' | 'start';
  readonly className?: string;
}

/**
 * Arabic religious text (06 §6): `lang="ar"` + `dir="rtl"` on the element itself, Amiri, centered by default,
 * never mirrored or restyled by the UI locale, selectable for copying.
 */
export function ArabicText({ children, variant = 'body', align = 'center', className }: ArabicTextProps) {
  return (
    <p
      lang="ar"
      dir="rtl"
      className={`select-text text-text ${variant === 'hero' ? 'type-arabic-hero' : 'type-arabic-body'} ${
        align === 'center' ? 'text-center' : 'text-start'
      } ${className ?? ''}`}
    >
      {children}
    </p>
  );
}
