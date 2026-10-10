import { type ComponentPropsWithoutRef, type MouseEvent, type PointerEvent, useEffect, useRef } from 'react';

import { gesture, type PressKind } from './tokens.ts';

export interface PressableProps extends Omit<ComponentPropsWithoutRef<'button'>, 'onClick'> {
  /** Pressed scale: button 0.96, card/row 0.98, FAB 0.92 (08 §2). */
  readonly kind?: PressKind;
  /** Activation (pointer tap, Enter, Space) — never fires after a scroll or a long-press. */
  readonly onPress?: (event: MouseEvent<HTMLButtonElement>) => void;
  /** Fires after 500 ms of holding still (context sheet). */
  readonly onLongPress?: () => void;
}

const KIND_CLASS: Record<PressKind, string> = { button: '', card: 'press-card', fab: 'press-fab' };

/**
 * Press feedback primitive (08 §5.1). On `pointerdown` it sets `data-pressed` synchronously, so the pressed
 * scale (CSS `pressable`, spring.snappy curve) starts in the same frame; components can style the darkened
 * background with `data-[pressed]:…`. Moving ≥ 8 px (a scroll) or `pointercancel` releases without
 * activating. Activation stays a native button click, so keyboard and screen readers work unchanged.
 */
export function Pressable({
  kind = 'button',
  onPress,
  onLongPress,
  className,
  type = 'button',
  onPointerDown,
  onPointerMove,
  onPointerUp,
  onPointerCancel,
  onPointerLeave,
  children,
  ...rest
}: PressableProps) {
  const ref = useRef<HTMLButtonElement>(null);
  const press = useRef({ x: 0, y: 0, timer: undefined as ReturnType<typeof setTimeout> | undefined, suppress: false });

  const release = () => {
    const state = press.current;
    if (state.timer !== undefined) clearTimeout(state.timer);
    state.timer = undefined;
    ref.current?.removeAttribute('data-pressed');
  };

  useEffect(() => release, []);

  return (
    <button
      ref={ref}
      type={type}
      className={`pressable ${KIND_CLASS[kind]} ${className ?? ''}`}
      onPointerDown={(event: PointerEvent<HTMLButtonElement>) => {
        onPointerDown?.(event);
        if (event.button !== 0 || rest.disabled) return;
        const state = press.current;
        state.x = event.clientX;
        state.y = event.clientY;
        state.suppress = false;
        event.currentTarget.setAttribute('data-pressed', '');
        if (onLongPress) {
          state.timer = setTimeout(() => {
            state.timer = undefined;
            state.suppress = true;
            release();
            onLongPress();
          }, gesture.longPressMs);
        }
      }}
      onPointerMove={(event: PointerEvent<HTMLButtonElement>) => {
        onPointerMove?.(event);
        const state = press.current;
        if (!ref.current?.hasAttribute('data-pressed')) return;
        const moved = Math.hypot(event.clientX - state.x, event.clientY - state.y);
        if (moved >= gesture.pressCancelDistance) {
          state.suppress = true;
          release();
        }
      }}
      onPointerUp={(event: PointerEvent<HTMLButtonElement>) => {
        onPointerUp?.(event);
        release();
      }}
      onPointerCancel={(event: PointerEvent<HTMLButtonElement>) => {
        onPointerCancel?.(event);
        press.current.suppress = true;
        release();
      }}
      onPointerLeave={(event: PointerEvent<HTMLButtonElement>) => {
        onPointerLeave?.(event);
        release();
      }}
      onClick={(event: MouseEvent<HTMLButtonElement>) => {
        // A pointer press that turned into a scroll or long-press must not activate. Keyboard clicks
        // (detail 0) never set `suppress`.
        if (press.current.suppress && event.detail > 0) {
          press.current.suppress = false;
          return;
        }
        onPress?.(event);
      }}
      {...rest}
    >
      {children}
    </button>
  );
}
