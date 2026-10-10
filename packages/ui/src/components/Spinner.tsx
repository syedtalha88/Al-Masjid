export interface SpinnerProps {
  /** Diameter in px (default 20). */
  readonly size?: number;
  /** Accessible label; omit when the surrounding control already announces busy state (`aria-busy`). */
  readonly label?: string;
  readonly className?: string;
}

/**
 * Indeterminate spinner: a 3/4 arc in `currentColor` rotating on the compositor (`spin`, loop.spinnerMs). It
 * keeps turning with reduced motion because it is functional, not decorative.
 */
export function Spinner({ size = 20, label, className }: SpinnerProps) {
  const a11y = label ? { role: 'status', 'aria-label': label } : { 'aria-hidden': true };
  return (
    <span className={`inline-flex shrink-0 ${className ?? ''}`} {...a11y}>
      <svg viewBox="0 0 24 24" width={size} height={size} fill="none" className="spin" focusable={false}>
        <circle cx="12" cy="12" r="9.5" stroke="currentColor" strokeOpacity="0.25" strokeWidth="2.5" />
        <path d="M12 2.5a9.5 9.5 0 0 1 9.5 9.5" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
      </svg>
    </span>
  );
}
