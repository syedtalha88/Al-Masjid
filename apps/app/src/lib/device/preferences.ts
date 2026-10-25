// Settings that live on the server too (07 A15, T2.12): language and the brother/sister choice go to the device record
// (`PATCH /devices/me` — the server needs them for notifications in the right language and audience); feeds refilter
// by themselves, their query keys carry `aud`. "Clear all data" (05 §4, 10 §6 journey 12) deletes the server record and
// everything on the phone; offline, the deletion of the old record is queued.
import type { Locale } from '@mc/i18n/locales';
import { NetworkError, ProblemError } from '@mc/shared/http';

import { isAuthLost } from '../api/client.ts';
import { handleAuthLost, type SyncDeps } from './sync.ts';

export interface PreferenceChange {
  readonly locale?: Locale;
  readonly audiencePref?: 'brothers' | 'sisters';
}

/** Offline, or a server answer a retry may fix. */
const retryLater = (error: unknown): boolean =>
  error instanceof NetworkError ||
  (error instanceof ProblemError && (error.status === 429 || error.status >= 500)) ||
  (typeof error === 'object' && error !== null && 'status' in error && Number(error.status) >= 500);

/** Sends the current language and brother/sister choice. */
async function send(deps: SyncDeps): Promise<'saved' | 'queued'> {
  const state = deps.store.current();
  try {
    await deps.api.updateMe({
      locale: state.locale,
      ...(state.audiencePref ? { audiencePref: state.audiencePref } : {}),
    });
    await deps.store.update((current) => {
      const { prefsPending: _sent, ...rest } = current;
      return rest;
    });
    return 'saved';
  } catch (error) {
    if (isAuthLost(error)) {
      // Registering again sends the current choices; nothing stays pending.
      await deps.store.update((current) => {
        const { prefsPending: _resent, ...rest } = current;
        return rest;
      });
      await handleAuthLost(deps);
      return 'queued';
    }
    if (retryLater(error)) return 'queued';
    throw error;
  }
}

/**
 * Changes language and/or brother/sister choice on the phone at once, then on the server.
 *
 * @returns `saved` (server updated) or `queued` (offline, server busy, or not registered yet — registration sends it).
 * @throws only for unexpected problems (a bug).
 */
export async function updatePreferences(deps: SyncDeps, change: PreferenceChange): Promise<'saved' | 'queued'> {
  const registered = deps.store.current().credentials !== undefined;
  await deps.store.update((current) => ({
    ...current,
    ...(change.locale ? { locale: change.locale } : {}),
    ...(change.audiencePref ? { audiencePref: change.audiencePref } : {}),
    ...(registered ? { prefsPending: true } : {}),
  }));
  if (!registered) return 'queued';
  return send(deps);
}

/** Sends a queued preference change (start, back online). */
export async function syncPreferences(deps: SyncDeps): Promise<'saved' | 'queued' | 'none'> {
  const state = deps.store.current();
  if (!state.prefsPending || !state.credentials) return 'none';
  return send(deps);
}

/**
 * Clear all data (05 §4): deletes this device's server record (its follows and Ameens go with it — 02 §5), then wipes
 * the phone's copy back to a fresh state in the current language (the app shows onboarding). Offline, the phone is
 * cleared at once and only the old credentials stay, to delete the server record later ({@link finishPendingDeletion}).
 * The caller clears the query cache.
 *
 * @returns `deleted` or `queued`.
 */
export async function clearAllData(deps: SyncDeps): Promise<'deleted' | 'queued'> {
  const credentials = deps.store.current().credentials;
  let queued = false;
  if (credentials) {
    try {
      await deps.api.deleteMe(credentials);
    } catch (error) {
      if (!isAuthLost(error)) {
        if (!retryLater(error)) throw error;
        queued = true;
      }
    }
  }
  await deps.store.clear();
  if (queued && credentials) {
    await deps.store.update((current) => ({ ...current, pendingDeletion: credentials }));
  }
  return queued ? 'queued' : 'deleted';
}

/** Deletes a former device whose "Clear all data" happened offline. */
export async function finishPendingDeletion(deps: SyncDeps): Promise<'deleted' | 'pending' | 'none'> {
  const pending = deps.store.current().pendingDeletion;
  if (!pending) return 'none';
  try {
    await deps.api.deleteMe(pending);
  } catch (error) {
    if (!isAuthLost(error)) {
      if (retryLater(error)) return 'pending';
      throw error;
    }
  }
  await deps.store.update((current) => {
    const { pendingDeletion: _done, ...rest } = current;
    return rest;
  });
  return 'deleted';
}
