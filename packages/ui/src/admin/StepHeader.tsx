export interface StepHeaderProps {
  /** 1-based; clamped to 1…total. */
  readonly step: number;
  readonly total: number;
  /** "Step 2 of 3" in the admin language. */
  readonly label: string;
  /** The step's own title ("Fill the details"). */
  readonly title?: string;
  readonly className?: string;
}

/**
 * Where an admin is in a step flow (06 §6 admin, 07 B5/B7/B8): "Step 2 of 3" and progress dots — done and current
 * dots filled, the current one larger; dots change colour and scale on the snappy spring (08 §5.12; colour only with
 * reduced motion). The dots are decoration: the label says it all.
 */
export function StepHeader({ step, total, label, title, className }: StepHeaderProps) {
  const current = Math.min(Math.max(step, 1), total);
  return (
    <div className={`flex flex-col gap-2 ${className ?? ''}`}>
      <div className="flex items-center justify-between gap-3">
        <p className="type-footnote text-text-secondary">{label}</p>
        <ol aria-hidden className="flex items-center gap-2">
          {Array.from({ length: total }, (_, index) => (
            <li
              key={index}
              data-state={index + 1 < current ? 'done' : index + 1 === current ? 'current' : 'todo'}
              className={`size-2 rounded-full transition-state ${
                index + 1 <= current ? 'bg-primary-700' : 'bg-mint-200'
              } ${index + 1 === current ? 'scale-150' : ''}`}
            />
          ))}
        </ol>
      </div>
      {title ? <h2 className="type-title2 text-text">{title}</h2> : null}
    </div>
  );
}
