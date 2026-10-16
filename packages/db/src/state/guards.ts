// Scope assertions shared by the state functions (02 §3: "each function asserts the scope").
import { StateError } from '../effects.ts';
import type { Scope, SuperScope } from '../scope.ts';

/** 04 §4: a ★ action needs a step-up within the last 5 minutes. */
export const STEP_UP_WINDOW_MS = 5 * 60 * 1000;

/**
 * @throws StateError FORBIDDEN unless `scope` is the Super Admin; STEP_UP_REQUIRED when `stepUp` is asked for and the
 *   scope's step-up is missing, older than 5 minutes or in the future.
 */
export function requireSuper(scope: Scope, options: { stepUp?: boolean; now?: Date } = {}): SuperScope {
  if (scope.kind !== 'super') throw new StateError('FORBIDDEN');
  if (options.stepUp) {
    const now = (options.now ?? new Date()).getTime();
    const at = scope.stepUpAt?.getTime();
    if (at === undefined || now - at > STEP_UP_WINDOW_MS || at > now) throw new StateError('STEP_UP_REQUIRED');
  }
  return scope;
}
