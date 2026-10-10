import type { ReactNode } from 'react';

export interface EmptyStateProps {
  /** A decorative illustration (06 §5), e.g. `<MosqueIllustration />`. */
  readonly illustration?: ReactNode;
  readonly title: string;
  readonly body?: ReactNode;
  /** The way forward ("Scan a QR code") — empty states always offer one (CLAUDE.md §6 UI). */
  readonly action?: ReactNode;
  readonly className?: string;
}

/** Empty state (06 §6): illustration + headline + body + action, centered. */
export function EmptyState({ illustration, title, body, action, className }: EmptyStateProps) {
  return (
    <div className={`flex flex-col items-center px-6 py-10 text-center ${className ?? ''}`}>
      {illustration ? <div className="mb-5">{illustration}</div> : null}
      <h2 className="type-headline text-text">{title}</h2>
      {body ? <p className="mt-2 max-w-xs type-callout text-text-secondary">{body}</p> : null}
      {action ? <div className="mt-6">{action}</div> : null}
    </div>
  );
}
