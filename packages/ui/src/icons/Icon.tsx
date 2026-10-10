import type { ReactNode } from 'react';

export interface IconProps {
  /** Rendered size in px (default 24, as Phosphor). */
  readonly size?: number;
  /** Accessible name. Omit for decorative icons next to visible text (then the icon is hidden). */
  readonly title?: string;
  readonly className?: string;
}

/**
 * Shared frame for our custom stroke icons: 256-unit grid and 16-unit stroke = Phosphor `regular` (1.5px at
 * 24px), round caps/joins, `currentColor` so the parent's token color applies (06 §5).
 */
export function IconFrame({ size = 24, title, className, children }: IconProps & { readonly children: ReactNode }) {
  const a11y = title ? { role: 'img', 'aria-label': title } : { 'aria-hidden': true, focusable: false };
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 256 256"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={16}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      {...a11y}
    >
      {children}
    </svg>
  );
}
