export interface DividerProps {
  /** Indent from the leading edge (rows with a 44 px icon: 72 px) so the line starts under the text. */
  readonly inset?: 'none' | 'icon';
  readonly className?: string;
}

/** Hairline divider (06 §4): 1 px `--color-border`, a true 0.5 px on high-density screens. */
export function Divider({ inset = 'none', className }: DividerProps) {
  return <div role="separator" className={`hairline ${inset === 'icon' ? 'ms-18' : ''} ${className ?? ''}`} />;
}
