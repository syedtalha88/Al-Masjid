import { useTranslation } from '@mc/i18n/react';
import { type ReactNode, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';

import { useMotionPrefs } from '../motion/MotionProvider.tsx';
import { animateChannel, initLayer } from '../navigation/driver.ts';
import { Button } from './Button.tsx';

export interface DialogProps {
  readonly open: boolean;
  /** Asked to close (Cancel, Esc, backdrop tap). */
  readonly onClose: () => void;
  readonly title: string;
  readonly body: ReactNode;
  readonly confirmLabel: string;
  /** Defaults to the shared "Cancel". */
  readonly cancelLabel?: string;
  readonly onConfirm: () => void;
  /** Destructive action (Clear data, Delete): red confirm button, `alertdialog`, Cancel focused first. */
  readonly destructive?: boolean;
  /** Confirm in progress: spinner, presses ignored, the dialog stays open. */
  readonly loading?: boolean;
}

/**
 * Centered confirm dialog (06 §6) for destructive or important choices. A native modal `<dialog>`
 * (focus trap, inert background, Esc); it scales 0.96 → 1 and fades in (reduced motion: fade), and focus
 * returns to the opener on close.
 */
export function Dialog({
  open,
  onClose,
  title,
  body,
  confirmLabel,
  cancelLabel,
  onConfirm,
  destructive = false,
  loading = false,
}: DialogProps) {
  const { t } = useTranslation();
  const { reduced } = useMotionPrefs();
  const titleId = useId();
  const bodyId = useId();
  const [mounted, setMounted] = useState(open);
  const dialog = useRef<HTMLDialogElement>(null);
  const card = useRef<HTMLDivElement>(null);
  const backdrop = useRef<HTMLDivElement>(null);
  const cancel = useRef<HTMLButtonElement>(null);
  const confirm = useRef<HTMLButtonElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  const closing = useRef(false);

  if (open && !mounted) setMounted(true);

  useLayoutEffect(() => {
    const node = dialog.current;
    if (!open || !node) return;
    closing.current = false;
    if (!node.open) {
      opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      node.showModal();
      (destructive ? cancel.current : confirm.current)?.focus({ preventScroll: true });
      initLayer(card.current, { opacity: 0, scale: reduced ? 1 : 0.96 });
      initLayer(backdrop.current, { opacity: 0 });
    }
    void animateChannel(card.current, 'opacity', 1, 'fade');
    if (!reduced) void animateChannel(card.current, 'scale', 1, 'smooth');
    void animateChannel(backdrop.current, 'opacity', 1, 'fade');
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs when the dialog opens
  }, [open, mounted]);

  useEffect(() => {
    if (open || !mounted) return;
    closing.current = true;
    void Promise.all([
      animateChannel(card.current, 'opacity', 0, 'fade'),
      animateChannel(backdrop.current, 'opacity', 0, 'fade'),
    ]).then((done) => {
      if (!done.every(Boolean) || !closing.current) return;
      dialog.current?.close();
      setMounted(false);
      const target = opener.current;
      if (target?.isConnected && document.activeElement === document.body) target.focus({ preventScroll: true });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs when asked to close
  }, [open]);

  if (!mounted) return null;
  return (
    <dialog
      ref={dialog}
      role={destructive ? 'alertdialog' : undefined}
      aria-labelledby={titleId}
      aria-describedby={bodyId}
      onCancel={(event) => {
        event.preventDefault();
        if (!loading) onClose();
      }}
      onClose={() => {
        if (closing.current) return;
        closing.current = true;
        setMounted(false);
        onClose();
      }}
      className="m-0 h-dvh max-h-none w-full max-w-none bg-transparent p-0 backdrop:bg-transparent"
    >
      <div
        ref={backdrop}
        aria-hidden
        onClick={() => {
          if (!loading) onClose();
        }}
        className="absolute inset-0 bg-overlay opacity-0"
      />
      <div className="pointer-events-none absolute inset-0 flex items-center justify-center p-6">
        <div ref={card} className="pointer-events-auto w-full max-w-sm rounded-lg bg-surface p-6 shadow-e2 opacity-0">
          <h2 id={titleId} className="type-headline text-text">
            {title}
          </h2>
          <div id={bodyId} className="mt-2 type-callout text-text-secondary">
            {body}
          </div>
          <div className="mt-6 flex flex-col gap-3">
            <Button
              ref={confirm}
              variant={destructive ? 'danger' : 'primary'}
              fullWidth
              loading={loading}
              onPress={onConfirm}
            >
              {confirmLabel}
            </Button>
            <Button ref={cancel} variant="ghost" fullWidth disabled={loading} onPress={onClose}>
              {cancelLabel ?? t('ui.cancel')}
            </Button>
          </div>
        </div>
      </div>
    </dialog>
  );
}
