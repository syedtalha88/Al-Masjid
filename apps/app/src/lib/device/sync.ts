// Device registration retry queue and follow synchronisation (T2.3, 07 A1 "registration offline → app continues,
// registers later"). The local store is the user's intention; the server copy is reconciled with it:
// - follows/unfollows are queued locally (`sync`) and sent when the device is registered and online;
// - a device the server forgot (401 DEVICE_AUTH_REQUIRED, e.g. after 180-day retention) registers again and re-sends
//   every follow; the server's own extra follows (another tab) are adopted.
import { NetworkError, ProblemError } from '@mc/shared/http';

import type { ApiClient } from '../api/client.ts';
import { isAuthLost, isProblem } from '../api/client.ts';
import type { PlatformKind } from '../platform.ts';
import { type DeviceStore, type LocalFollow, MAX_FOLLOWS } from './store.ts';

export { visibleFollows } from './store.ts';

export interface SyncDeps {
  readonly store: DeviceStore;
  readonly api: ApiClient;
  /** A fresh Turnstile token (invisible/managed widget, T2.4). */
  readonly turnstileToken: () => Promise<string>;
  readonly platform: PlatformKind;
}

export type RegistrationResult = 'registered' | 'already' | 'deferred' | 'not-ready';

/**
 * Registers the device when it owes a registration (onboarding finished, no credentials yet), then sends its queued
 * follows. Offline / server trouble → `deferred` (the caller retries on `online` and on the next start).
 *
 * @throws only for problems that will not fix themselves on retry (e.g. TURNSTILE_FAILED is retried; a validation
 *   error is thrown — it is a bug).
 */
export async function ensureRegistered(deps: SyncDeps): Promise<RegistrationResult> {
  const state = deps.store.current();
  if (state.credentials) return 'already';
  if (!state.audiencePref || !state.privacyVersion) return 'not-ready';
  try {
    const token = await deps.turnstileToken();
    const { deviceId, secret } = await deps.api.register({
      locale: state.locale,
      audiencePref: state.audiencePref,
      platform: deps.platform,
      privacyVersion: state.privacyVersion,
      turnstileToken: token,
    });
    await deps.store.update((current) => ({
      ...current,
      credentials: { deviceId, secret },
      registrationPending: false,
      // A new device id knows nothing yet: every kept follow must be sent.
      follows: current.follows.map((follow) => (follow.sync === 'synced' ? { ...follow, sync: 'follow' } : follow)),
    }));
  } catch (error) {
    if (error instanceof NetworkError || isProblem(error, 'TURNSTILE_FAILED') || isRetryableStatus(error)) {
      await deps.store.update((current) => ({ ...current, registrationPending: true }));
      return 'deferred';
    }
    throw error;
  }
  await syncFollows(deps);
  return 'registered';
}

const isRetryableStatus = (error: unknown) =>
  (error instanceof ProblemError && (error.status === 429 || error.status >= 500)) ||
  (typeof error === 'object' &&
    error !== null &&
    'status' in error &&
    typeof error.status === 'number' &&
    error.status >= 500);

/** The device lost its server record: forget the credentials and register again (follows are re-sent). */
export async function handleAuthLost(deps: SyncDeps): Promise<RegistrationResult> {
  await deps.store.update((current) => {
    const { credentials: _forgotten, ...rest } = current;
    return { ...rest, registrationPending: true };
  });
  return ensureRegistered(deps);
}

/** Adds a follow locally (queued) — idempotent; refuses beyond 20 (00 §4.1). */
export async function followLocally(
  store: DeviceStore,
  masjidId: string,
  now: Date,
): Promise<'added' | 'already' | 'limit'> {
  const state = store.current();
  const existing = state.follows.find((follow) => follow.masjidId === masjidId);
  if (existing && existing.sync !== 'unfollow') return 'already';
  if (!existing && state.follows.filter((follow) => follow.sync !== 'unfollow').length >= MAX_FOLLOWS) return 'limit';
  await store.update((current) => ({
    ...current,
    // A pending unfollow that is taken back: the server still has the follow.
    follows: existing
      ? current.follows.map((follow) => (follow.masjidId === masjidId ? { ...follow, sync: 'synced' } : follow))
      : [...current.follows, { masjidId, followedAt: now.toISOString(), muted: false, sync: 'follow' }],
  }));
  return 'added';
}

/** Marks a follow for removal (it disappears from every list at once; the server is told on the next sync). */
export async function unfollowLocally(store: DeviceStore, masjidId: string): Promise<void> {
  await store.update((current) => ({
    ...current,
    follows: current.follows.flatMap((follow): LocalFollow[] => {
      if (follow.masjidId !== masjidId) return [follow];
      // Never sent → nothing to undo on the server.
      return follow.sync === 'follow' ? [] : [{ ...follow, sync: 'unfollow' }];
    }),
  }));
}

export type SyncOutcome = { readonly sent: number; readonly dropped: readonly string[] };

/**
 * Sends queued follows/unfollows. A masjid the server refuses (no longer active, or the 20-limit) is dropped locally
 * and reported in `dropped`. Stops quietly when offline; re-registers when the device was forgotten.
 */
export async function syncFollows(deps: SyncDeps): Promise<SyncOutcome> {
  if (!deps.store.current().credentials) return { sent: 0, dropped: [] };
  let sent = 0;
  const dropped: string[] = [];
  for (const follow of deps.store.current().follows) {
    if (follow.sync === 'synced') continue;
    try {
      if (follow.sync === 'follow') await deps.api.follow(follow.masjidId);
      else await deps.api.unfollow(follow.masjidId);
      sent += 1;
      await deps.store.update((current) => ({
        ...current,
        follows: current.follows.flatMap((item): LocalFollow[] => {
          if (item.masjidId !== follow.masjidId || item.sync !== follow.sync) return [item];
          return item.sync === 'unfollow' ? [] : [{ ...item, sync: 'synced' }];
        }),
      }));
    } catch (error) {
      if (isProblem(error, 'MASJID_NOT_FOUND') || isProblem(error, 'FOLLOW_LIMIT_REACHED')) {
        dropped.push(follow.masjidId);
        await deps.store.update((current) => ({
          ...current,
          follows: current.follows.filter((item) => item.masjidId !== follow.masjidId),
        }));
        continue;
      }
      if (isAuthLost(error)) {
        await handleAuthLost(deps);
        return { sent, dropped };
      }
      if (error instanceof NetworkError) return { sent, dropped };
      throw error;
    }
  }
  return { sent, dropped };
}

/**
 * Reconciles with the server copy (`GET /devices/me/follows`): local synced follows the server lacks are re-sent;
 * server follows unknown here (another tab or install of the same device) are adopted at the end of the order, with
 * the server's mute flag.
 */
export async function reconcileFollows(deps: SyncDeps): Promise<SyncOutcome> {
  if (!deps.store.current().credentials) return { sent: 0, dropped: [] };
  let server;
  try {
    server = await deps.api.follows();
  } catch (error) {
    if (isAuthLost(error)) {
      await handleAuthLost(deps);
      return { sent: 0, dropped: [] };
    }
    if (error instanceof NetworkError) return { sent: 0, dropped: [] };
    throw error;
  }
  const onServer = new Map(server.follows.map((follow) => [follow.masjidId, follow]));
  await deps.store.update((current) => {
    const known = new Set(current.follows.map((follow) => follow.masjidId));
    const follows = current.follows.map((follow) =>
      follow.sync === 'synced' && !onServer.has(follow.masjidId) ? { ...follow, sync: 'follow' as const } : follow,
    );
    for (const follow of server.follows) {
      if (!known.has(follow.masjidId)) {
        follows.push({ masjidId: follow.masjidId, followedAt: follow.followedAt, muted: follow.muted, sync: 'synced' });
      }
    }
    return { ...current, follows };
  });
  return syncFollows(deps);
}
