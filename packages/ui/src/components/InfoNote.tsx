import type { ReactNode } from 'react';

import { InfoIcon } from '../icons/glyphs.tsx';

export interface InfoNoteProps {
  readonly children: ReactNode;
  /** Replace the default info glyph. */
  readonly icon?: ReactNode;
  readonly className?: string;
}

/** Quiet information note (06 §6, ref-1/ref-3 footers): surface-muted, radius 16, info icon, `footnote`. */
export function InfoNote({ children, icon, className }: InfoNoteProps) {
  return (
    <div
      className={`flex items-start gap-3 rounded-md bg-surface-muted p-4 type-footnote text-text-secondary ${
        className ?? ''
      }`}
    >
      <span className="mt-px inline-flex shrink-0" aria-hidden>
        {icon ?? <InfoIcon size={20} />}
      </span>
      <div className="min-w-0">{children}</div>
    </div>
  );
}
