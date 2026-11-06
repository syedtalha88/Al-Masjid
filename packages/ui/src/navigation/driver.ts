import { animate, type MotionValue, motionValue } from 'motion/react';

import { spring, springPhysics, tween } from '../motion/tokens.ts';

/**
 * Navigator animation driver (08 §1.2, §3, §9; DECISIONS #44). Every animated property of a navigator layer
 * (screen, dim overlay, tab layer, app layer, modal) is a Motion `MotionValue` written straight to the
 * element's style — React never re-renders during a transition or a gesture. A new target while a value is
 * moving starts from its current position **and velocity**; a swipe release passes the finger's velocity.
 */
export type Curve = 'smooth' | 'fade' | 'quick';

/** `x`/`y` are translations in % of the layer's own size; `radius` is px. */
export type Channel = 'x' | 'y' | 'scale' | 'opacity' | 'radius';
export type ChannelValues = Partial<Record<Channel, number>>;

const DEFAULTS: Record<Channel, number> = { x: 0, y: 0, scale: 1, opacity: 1, radius: 0 };

// Physics form: Motion's visualDuration springs ignore velocity (see `springPhysics`).
const TRANSITION = {
  smooth: springPhysics(spring.smooth),
  fade: tween.fade,
  quick: tween.quick,
} as const;

interface Layer {
  readonly element: HTMLElement;
  readonly values: Partial<Record<Channel, MotionValue<number>>>;
  /** The running animation per channel, so asking for the same target again joins it. */
  readonly running: Map<Channel, { readonly target: number; readonly done: Promise<boolean> }>;
  /** Running animations + held gestures; `will-change` and `data-animating` are set while > 0. */
  busy: number;
}

const layers = new WeakMap<HTMLElement, Layer>();

const read = (layer: Layer, channel: Channel) => layer.values[channel]?.get() ?? DEFAULTS[channel];

function render(layer: Layer, channel: Channel) {
  const { style } = layer.element;
  if (channel === 'opacity') {
    style.opacity = String(read(layer, 'opacity'));
  } else if (channel === 'radius') {
    style.borderRadius = `${String(read(layer, 'radius'))}px`;
  } else {
    const parts: string[] = [];
    if (layer.values.x) parts.push(`translateX(${String(read(layer, 'x'))}%)`);
    if (layer.values.y) parts.push(`translateY(${String(read(layer, 'y'))}%)`);
    if (layer.values.scale) parts.push(`scale(${String(read(layer, 'scale'))})`);
    style.transform = parts.join(' ');
  }
}

function layerOf(element: HTMLElement): Layer {
  let layer = layers.get(element);
  if (!layer) {
    layer = { element, values: {}, running: new Map(), busy: 0 };
    layers.set(element, layer);
  }
  return layer;
}

function valueOf(element: HTMLElement, channel: Channel): MotionValue<number> {
  const layer = layerOf(element);
  let value = layer.values[channel];
  if (!value) {
    value = motionValue(DEFAULTS[channel]);
    layer.values[channel] = value;
    // This subscription also keeps the value "observed": Motion stops animations of unobserved values.
    const owner = layer;
    value.on('change', () => {
      render(owner, channel);
    });
  }
  return value;
}

function hold(element: HTMLElement): () => void {
  const layer = layerOf(element);
  layer.busy += 1;
  if (layer.busy === 1) {
    // Promote only while moving (08 §9); `data-animating` lets tests wait for the navigator to settle.
    element.style.willChange = 'transform, opacity';
    element.setAttribute('data-animating', '');
  }
  let released = false;
  return () => {
    if (released) return;
    released = true;
    layer.busy -= 1;
    if (layer.busy === 0) {
      element.style.removeProperty('will-change');
      element.removeAttribute('data-animating');
    }
  };
}

/**
 * Declares a layer's starting values (they must match the style React rendered at mount, so nothing jumps).
 *
 * @param element - the layer's DOM node; missing nodes are ignored.
 * @param values - starting value per channel; channels not listed keep their current value.
 */
export function initLayer(element: HTMLElement | null | undefined, values: ChannelValues): void {
  if (!element) return;
  for (const [channel, value] of Object.entries(values) as [Channel, number][]) {
    valueOf(element, channel).jump(value);
  }
}

/** Current value of `channel` on `element` (its default when never set). */
export function getChannel(element: HTMLElement | null | undefined, channel: Channel): number {
  return element ? read(layerOf(element), channel) : DEFAULTS[channel];
}

/**
 * Sets `channel` immediately, stopping any running animation of it (gesture tracking, instant moves).
 */
export function setChannel(element: HTMLElement | null | undefined, channel: Channel, value: number): void {
  if (!element) return;
  valueOf(element, channel).jump(value);
}

/**
 * Animates `channel` to `target` with a motion token, from the current position. Interrupting a running
 * animation keeps its velocity unless `velocity` (units per second) is given, e.g. a swipe release. Asking
 * for the target a running animation already heads to (without a new velocity) joins that animation.
 *
 * @returns resolves `true` when the target is reached, `false` when the animation was interrupted (by a new
 *   target, a gesture or an instant set). Never rejects.
 */
export function animateChannel(
  element: HTMLElement | null | undefined,
  channel: Channel,
  target: number,
  curve: Curve,
  velocity?: number,
): Promise<boolean> {
  if (!element) return Promise.resolve(true);
  const layer = layerOf(element);
  const value = valueOf(element, channel);
  const running = layer.running.get(channel);
  if (value.isAnimating()) {
    if (running?.target === target && velocity === undefined) return running.done;
  } else if (value.get() === target) return Promise.resolve(true);
  const release = hold(element);
  const transition = velocity === undefined ? TRANSITION[curve] : { ...TRANSITION[curve], velocity };
  // Starting the new animation cancels the previous one first, so subscribe only afterwards.
  void animate(value, target, transition);
  const done = new Promise<boolean>((resolve) => {
    const settle = (completed: boolean) => {
      offComplete();
      offCancel();
      if (layer.running.get(channel)?.done === done) layer.running.delete(channel);
      release();
      // Resolved in a task after the frame: completion fires inside Motion's requestAnimationFrame batch, and the
      // callers' follow-ups (focus a title, close a dialog, unmount) read layout — inside the frame that forced a
      // layout (08 §8 "no layout from animation frames"; F46 trace: sheet dismiss, push/pop focus).
      setTimeout(() => {
        resolve(completed);
      }, 0);
    };
    const offComplete = value.on('animationComplete', () => {
      settle(true);
    });
    const offCancel = value.on('animationCancel', () => {
      settle(false);
    });
  });
  layer.running.set(channel, { target, done });
  return done;
}

/**
 * Marks `element` as moving under a finger (promoted, `data-animating`) until the returned release runs.
 */
export function holdLayer(element: HTMLElement | null | undefined): () => void {
  return element ? hold(element) : () => undefined;
}

/** CSS `transform` for a screen at `x` % — used for the first render, before the driver owns the node. */
export const translateX = (percent: number) => `translateX(${String(percent)}%)`;
