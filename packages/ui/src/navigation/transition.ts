import { navigation } from '../motion/tokens.ts';

/**
 * Navigator animations run as CSS transitions on the compositor, using the spring curves Motion generated
 * into `motion.css` (DECISIONS #44). A new target while a transition runs re-targets smoothly from the
 * current position, so rapid push/pop never jumps.
 */
export type Curve = 'smooth' | 'fade' | 'quick' | 'none';
type Property = 'transform' | 'opacity' | 'border-radius';

const CURVE: Record<Exclude<Curve, 'none'>, string> = {
  smooth: 'var(--mc-spring-smooth)',
  fade: 'var(--mc-tween-fade)',
  quick: 'var(--mc-tween-quick)',
};

const active = new WeakMap<HTMLElement, Map<Property, string>>();

function applyTransitions(element: HTMLElement, property: Property, curve: Curve) {
  const map = active.get(element) ?? new Map<Property, string>();
  if (curve === 'none') map.delete(property);
  else map.set(property, `${property} ${CURVE[curve]}`);
  active.set(element, map);
  element.style.transition = [...map.values()].join(', ');
}

const styleKey = { transform: 'transform', opacity: 'opacity', 'border-radius': 'borderRadius' } as const;

/**
 * Sets `property` to `value`, animated with `curve` (or instantly with `'none'`).
 *
 * @returns resolves when the transition ends, is cancelled/retargeted, or after the safety timeout.
 */
export function transitionTo(
  element: HTMLElement | undefined | null,
  property: Property,
  value: string,
  curve: Curve,
): Promise<void> {
  if (!element) return Promise.resolve();
  const key = styleKey[property];
  if (curve === 'none') {
    applyTransitions(element, property, 'none');
    element.style[key] = value;
    return Promise.resolve();
  }
  if (element.style[key] === value) return Promise.resolve();
  applyTransitions(element, property, curve);
  // Make sure the starting value has been computed (freshly mounted elements), so the transition runs.
  // A call (not a bare property read) so no minifier can drop it.
  element.getBoundingClientRect();
  element.style[key] = value;
  return new Promise((resolve) => {
    const finish = () => {
      clearTimeout(timer);
      element.removeEventListener('transitionend', onEnd);
      element.removeEventListener('transitioncancel', onEnd);
      resolve();
    };
    const onEnd = (event: TransitionEvent) => {
      if (event.target === element && event.propertyName === property) finish();
    };
    const timer = setTimeout(finish, navigation.settleTimeoutMs);
    element.addEventListener('transitionend', onEnd);
    element.addEventListener('transitioncancel', onEnd);
  });
}

export const translateX = (percent: number) => `translateX(${String(percent)}%)`;
