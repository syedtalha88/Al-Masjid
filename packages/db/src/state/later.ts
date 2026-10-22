// State functions owned by later phases (02 §3): exact names, scopes and signatures now, so callers and the policy
// matrix are stable; each throws NotImplementedError until its phase replaces the stub (PHASE_01 T1.3).
import type { UUID } from 'mongodb';

import type { DbHandle } from '../client.ts';
import { NotImplementedError } from '../effects.ts';
import type { Scope } from '../scope.ts';

const later = (name: string, phase: string) => (): never => {
  throw new NotImplementedError(name, phase);
};

export const requestPaymentChange: (
  handle: DbHandle,
  scope: Scope,
  input: { masjidId: UUID; vpa: string; payeeName: string; note?: string },
) => Promise<UUID> = later('requestPaymentChange', 'Phase 5');
export const approvePaymentChange: (handle: DbHandle, scope: Scope, profileId: UUID) => Promise<void> = later(
  'approvePaymentChange',
  'Phase 5',
);
export const rejectPaymentChange: (handle: DbHandle, scope: Scope, profileId: UUID, reason: string) => Promise<void> =
  later('rejectPaymentChange', 'Phase 5');
export const activateDuePaymentProfiles: (handle: DbHandle, scope: Scope) => Promise<number> = later(
  'activateDuePaymentProfiles',
  'Phase 5',
);
export const removeItem: (handle: DbHandle, scope: Scope, itemId: UUID, reason: string) => Promise<void> = later(
  'removeItem',
  'Phase 8',
);
export const restoreItem: (handle: DbHandle, scope: Scope, itemId: UUID) => Promise<void> = later(
  'restoreItem',
  'Phase 8',
);
export const setShowChanda: (handle: DbHandle, scope: Scope, masjidId: UUID, show: boolean) => Promise<void> = later(
  'setShowChanda',
  'Phase 5',
);
export const setDevicePush: (handle: DbHandle, scope: Scope, input: Record<string, unknown>) => Promise<void> = later(
  'setDevicePush',
  'Phase 4',
);
