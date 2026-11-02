import { useEffect, useId, useRef } from 'react';

import { Button } from '../components/Button.tsx';
import { crossfadeIn } from '../motion/effects.ts';
import { haptic } from '../motion/haptics.ts';
import { SuccessCheck } from '../motion/SuccessCheck.tsx';

export interface PublishSuccessProps {
  /** "Published". */
  readonly title: string;
  /** "1,240 people will be notified." */
  readonly message?: string | undefined;
  readonly doneLabel: string;
  readonly onDone: () => void;
  /** "View" — opens the post in My Posts. */
  readonly view?: { readonly label: string; readonly onPress: () => void } | undefined;
}

/**
 * The publish moment (08 §5.12, 07 B5): a full-screen `SuccessCheck` with "Published" and who will be told, then
 * "Done" / "View". Fades in over the flow, success haptic on Android; with reduced motion the check appears drawn.
 * Focus moves to the title so screen readers announce it.
 */
export function PublishSuccess({ title, message, doneLabel, onDone, view }: PublishSuccessProps) {
  const titleId = useId();
  const root = useRef<HTMLDivElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    haptic('success');
    heading.current?.focus();
    const element = root.current;
    if (!element) return;
    const effect = crossfadeIn(element);
    return () => {
      effect.stop();
    };
  }, []);
  return (
    <div
      ref={root}
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      className="fixed inset-0 z-40 flex flex-col items-center justify-center gap-6 bg-bg px-screen pt-safe pb-safe text-center"
    >
      <SuccessCheck size={96} title={title} />
      <div className="flex flex-col gap-2">
        <h1 ref={heading} id={titleId} tabIndex={-1} className="type-title1 text-text outline-none">
          {title}
        </h1>
        {message ? <p className="type-body text-text-secondary">{message}</p> : null}
      </div>
      <div className="flex w-full max-w-sm flex-col gap-3">
        <Button size="lg" fullWidth onPress={onDone}>
          {doneLabel}
        </Button>
        {view ? (
          <Button size="lg" variant="outline" fullWidth onPress={view.onPress}>
            {view.label}
          </Button>
        ) : null}
      </div>
    </div>
  );
}
