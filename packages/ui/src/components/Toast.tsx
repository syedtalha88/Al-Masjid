import { useTranslation } from '@mc/i18n/react';
import {
  createContext,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  use,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import { CheckCircleIcon, WarningIcon, XIcon } from '../icons/glyphs.tsx';
import { useMotionPrefs } from '../motion/MotionProvider.tsx';
import { Pressable } from '../motion/Pressable.tsx';
import { feedback } from '../motion/tokens.ts';
import { animateChannel, initLayer, setChannel } from '../navigation/driver.ts';

export type ToastTone = 'default' | 'success' | 'error';

export interface ToastOptions {
  readonly message: string;
  readonly tone?: ToastTone;
  /** One action button ("Refresh", "Undo"). Pressing it also dismisses the toast. */
  readonly action?: { readonly label: string; readonly onPress: () => void };
  /** Auto-dismiss after ms (default 3 s); `null` = stays until its action or a swipe (update available). */
  readonly duration?: number | null;
}

interface ToastEntry extends ToastOptions {
  readonly id: number;
}

export interface ToastApi {
  /** Shows a toast (replacing the current one). @returns its id. */
  show(options: ToastOptions): number;
  /** Dismisses a toast by id (no-op when it is already gone). */
  dismiss(id: number): void;
}

const ToastContext = createContext<ToastApi | null>(null);

/** The toast API. Must be used inside `<ToastProvider>`. */
export function useToast(): ToastApi {
  const api = use(ToastContext);
  if (!api) throw new Error('useToast() must be used inside <ToastProvider>');
  return api;
}

/**
 * Hosts toasts at the top of the screen (06 §6, 08 §5.10): one at a time, a pill that springs in from above
 * (`spring.snappy` feel via the shared driver), auto-dismisses after 3 s, can be swiped up, and is announced
 * politely (errors assertively) through a live region that exists before any toast appears.
 */
export function ToastProvider({ children }: { readonly children: ReactNode }) {
  const [current, setCurrent] = useState<ToastEntry | null>(null);
  const nextId = useRef(1);

  const dismiss = useCallback((id: number) => {
    setCurrent((entry) => (entry?.id === id ? null : entry));
  }, []);

  const show = useCallback((options: ToastOptions) => {
    const id = nextId.current;
    nextId.current += 1;
    setCurrent({ ...options, id });
    return id;
  }, []);

  const api = useMemo<ToastApi>(() => ({ show, dismiss }), [show, dismiss]);

  return (
    <ToastContext value={api}>
      {children}
      <ToastHost entry={current} onDismiss={dismiss} />
    </ToastContext>
  );
}

function ToastHost({
  entry,
  onDismiss,
}: {
  readonly entry: ToastEntry | null;
  readonly onDismiss: (id: number) => void;
}) {
  // The shown toast lingers while it animates out.
  const [shown, setShown] = useState<ToastEntry | null>(entry);
  if (entry && entry.id !== shown?.id) setShown(entry);
  const polite = shown && shown.tone !== 'error' ? shown.message : '';
  const assertive = shown?.tone === 'error' ? shown.message : '';
  return (
    <>
      {/* Live regions exist up front so the first toast is announced (08 §5.10). */}
      <div className="sr-only" role="status" aria-live="polite">
        {entry ? polite : ''}
      </div>
      <div className="sr-only" role="alert" aria-live="assertive">
        {entry ? assertive : ''}
      </div>
      {shown ? (
        <ToastView
          key={shown.id}
          entry={shown}
          visible={entry?.id === shown.id}
          onDismiss={onDismiss}
          onGone={() => {
            setShown((value) => (value?.id === shown.id ? null : value));
          }}
        />
      ) : null}
    </>
  );
}

const TONE_ICON: Readonly<Record<ToastTone, ReactNode>> = {
  default: null,
  success: <CheckCircleIcon size={20} className="text-primary-500" />,
  error: <WarningIcon size={20} className="text-danger" />,
};

function ToastView({
  entry,
  visible,
  onDismiss,
  onGone,
}: {
  readonly entry: ToastEntry;
  readonly visible: boolean;
  readonly onDismiss: (id: number) => void;
  readonly onGone: () => void;
}) {
  const { t } = useTranslation();
  const { reduced } = useMotionPrefs();
  const node = useRef<HTMLDivElement>(null);
  const drag = useRef<{ id: number; y: number } | null>(null);
  const duration = entry.duration === undefined ? feedback.toastMs : entry.duration;

  useLayoutEffect(() => {
    initLayer(node.current, reduced ? { opacity: 0 } : { y: -150, opacity: 1 });
    if (reduced) void animateChannel(node.current, 'opacity', 1, 'fade');
    else void animateChannel(node.current, 'y', 0, 'smooth');
    // eslint-disable-next-line react-hooks/exhaustive-deps -- enter once on mount
  }, []);

  useEffect(() => {
    if (!visible || duration === null) return;
    const timer = setTimeout(() => {
      onDismiss(entry.id);
    }, duration);
    return () => {
      clearTimeout(timer);
    };
  }, [visible, duration, entry.id, onDismiss]);

  useEffect(() => {
    if (visible) return;
    const move = reduced
      ? animateChannel(node.current, 'opacity', 0, 'fade')
      : animateChannel(node.current, 'y', -150, 'smooth');
    void move.then(onGone);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- exit once when replaced or dismissed
  }, [visible]);

  const height = () => node.current?.offsetHeight ?? 1;
  return (
    <div className="pointer-events-none fixed inset-x-0 top-0 z-50 flex justify-center px-screen pt-safe">
      <div
        ref={node}
        onPointerDown={(event: ReactPointerEvent<HTMLDivElement>) => {
          if (event.target instanceof Element && event.target.closest('button')) return;
          event.currentTarget.setPointerCapture(event.pointerId);
          drag.current = { id: event.pointerId, y: event.clientY };
        }}
        onPointerMove={(event: ReactPointerEvent<HTMLDivElement>) => {
          const state = drag.current;
          if (state?.id !== event.pointerId) return;
          const dy = event.clientY - state.y;
          // Up follows the finger; down resists.
          setChannel(node.current, 'y', ((dy < 0 ? dy : dy * 0.2) / height()) * 100);
        }}
        onPointerUp={(event: ReactPointerEvent<HTMLDivElement>) => {
          const state = drag.current;
          drag.current = null;
          if (state?.id !== event.pointerId) return;
          if (event.clientY - state.y < -24) onDismiss(entry.id);
          else void animateChannel(node.current, 'y', 0, 'smooth');
        }}
        className="pointer-events-auto mt-3 flex min-h-12 w-full max-w-content touch-none items-center gap-3 rounded-full bg-text py-2 ps-5 pe-2 text-surface shadow-e2"
      >
        {TONE_ICON[entry.tone ?? 'default']}
        <p className="min-w-0 flex-1 type-callout">{entry.message}</p>
        {entry.action ? (
          <Pressable
            onPress={() => {
              entry.action?.onPress();
              onDismiss(entry.id);
            }}
            className="inline-flex min-h-11 shrink-0 items-center rounded-full px-4 type-subhead-strong text-mint-100 data-[pressed]:bg-text-secondary"
          >
            {entry.action.label}
          </Pressable>
        ) : (
          <span className="w-3" aria-hidden />
        )}
        {entry.duration === null && !entry.action ? (
          <Pressable
            aria-label={t('ui.dismiss')}
            onPress={() => {
              onDismiss(entry.id);
            }}
            className="inline-flex size-11 shrink-0 items-center justify-center rounded-full text-mint-100"
          >
            <XIcon size={18} />
          </Pressable>
        ) : null}
      </div>
    </div>
  );
}
