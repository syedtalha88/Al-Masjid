// Ameen on dua requests (07 A9, 08 §5.6, 00 §4.3): counted once per device. The tap is recorded on the phone at once
// (button state) and queued; the queue is sent when the device is registered and online — on the tap, on start and
// when the browser comes back online. The server is idempotent per device (`recordAmeen`), so a resend never counts
// twice. Failures retry later, quietly.
import { NetworkError, ProblemError } from '@mc/shared/http';

import { isAuthLost, isProblem } from '../api/client.ts';
import { AMEEN_SYNC_TAG } from '../sw-protocol.ts';
import type { DeviceStore } from './store.ts';
import { handleAuthLost, type SyncDeps } from './sync.ts';

/** Matches the device document's limit: the oldest Ameen states are forgotten first. */
const MAX_AMEENS = 2000;

/**
 * Records this device's Ameen (button state) and queues it for the server.
 *
 * @returns `false` when this device already said Ameen on the item (nothing changes).
 */
export async function sayAmeenLocally(store: DeviceStore, publicId: string): Promise<boolean> {
  if (store.current().ameens.includes(publicId)) return false;
  await store.update((current) => ({
    ...current,
    ameens: [...current.ameens, publicId].slice(-MAX_AMEENS),
    pendingAmeens: current.pendingAmeens.includes(publicId)
      ? current.pendingAmeens
      : [...current.pendingAmeens, publicId].slice(-MAX_AMEENS),
  }));
  return true;
}

export interface AmeenFlush {
  /** Exact counts the server returned for the Ameens sent now. */
  readonly confirmed: ReadonlyMap<string, number>;
  /** Still queued (offline, not registered, server busy or rate-limited). */
  readonly pending: number;
}

const dequeue = (store: DeviceStore, publicId: string) =>
  store.update((current) => ({ ...current, pendingAmeens: current.pendingAmeens.filter((id) => id !== publicId) }));

/**
 * Sends the queued Ameens in order. Stops at the first answer that a retry may fix (offline, 5xx, 429); an item that no
 * longer exists is dropped from the queue; a device the server forgot registers again first.
 *
 * @throws only for unexpected problems (a bug) — expected failures leave the queue for later.
 */
export async function flushAmeens(deps: SyncDeps): Promise<AmeenFlush> {
  const confirmed = new Map<string, number>();
  const remaining = () => ({ confirmed, pending: deps.store.current().pendingAmeens.length });
  if (!deps.store.current().credentials) return remaining();
  for (const publicId of [...deps.store.current().pendingAmeens]) {
    try {
      confirmed.set(publicId, await deps.api.ameen(publicId));
      await dequeue(deps.store, publicId);
    } catch (error) {
      if (isProblem(error, 'ITEM_NOT_FOUND')) {
        await dequeue(deps.store, publicId);
        continue;
      }
      if (isAuthLost(error)) {
        await handleAuthLost(deps);
        return remaining();
      }
      if (
        error instanceof NetworkError ||
        (error instanceof ProblemError && (error.status === 429 || error.status >= 500)) ||
        (typeof error === 'object' && error !== null && 'status' in error && Number(error.status) >= 500)
      ) {
        return remaining();
      }
      throw error;
    }
  }
  return remaining();
}

/** Background Sync (WICG; Chromium only) — not in TypeScript's DOM library. */
interface SyncRegistration {
  readonly sync: { register(tag: string): Promise<void> };
}
const hasSync = (
  registration: ServiceWorkerRegistration,
): registration is ServiceWorkerRegistration & SyncRegistration =>
  'sync' in registration && typeof registration.sync === 'object' && registration.sync !== null;

/**
 * Asks the service worker to send the queued Ameens when the connection returns, even if the app is closed by then
 * (01 §5.6 "Background Sync where supported"). Elsewhere the queue waits for the next start / `online` event.
 *
 * @returns whether a sync was registered; never rejects.
 */
export async function requestBackgroundAmeens(
  container: ServiceWorkerContainer | undefined = typeof navigator === 'undefined'
    ? undefined
    : navigator.serviceWorker,
): Promise<boolean> {
  try {
    // `getRegistration`, not `ready`: `ready` never settles without a worker (dev server, tests).
    const registration = await container?.getRegistration();
    if (!registration?.active || !hasSync(registration)) return false;
    await registration.sync.register(AMEEN_SYNC_TAG);
    return true;
  } catch {
    return false;
  }
}

/**
 * The count to show: the larger of the server's live count (`GET /ameens`, up to 30 s old at the CDN) and the exact
 * count confirmed for this device's own Ameen, plus one while this device's Ameen is still queued.
 *
 * @returns `undefined` when nothing is known yet (no number rather than a wrong one).
 */
export function ameenDisplayCount(
  server: number | undefined,
  confirmed: number | undefined,
  pending: boolean,
): number | undefined {
  if (server === undefined && confirmed === undefined) return undefined;
  const known = Math.max(server ?? 0, confirmed ?? 0);
  return pending ? known + 1 : known;
}
