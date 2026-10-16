import type { ReactNode } from 'react';

export interface FlowLayoutProps {
  readonly children: ReactNode;
  /** The one obvious action, pinned to the bottom (07 Part B principles). */
  readonly footer?: ReactNode;
}

/**
 * Full-page layout for the flows that run before the app shell (invite, login, undertaking): warm canvas, phone-width
 * column, content scrolls, the primary action stays at the bottom above the safe area.
 */
export function FlowLayout({ children, footer }: FlowLayoutProps) {
  return (
    <div className="flex min-h-dvh flex-col bg-bg">
      <main className="mx-auto flex w-full max-w-content flex-1 flex-col px-screen pt-safe">
        <div className="flex flex-1 flex-col pt-8 pb-6">{children}</div>
      </main>
      {footer ? (
        <div className="sticky bottom-0 bg-bg">
          <div className="mx-auto flex w-full max-w-content flex-col gap-3 px-screen pt-3 pb-safe">{footer}</div>
        </div>
      ) : null}
    </div>
  );
}
