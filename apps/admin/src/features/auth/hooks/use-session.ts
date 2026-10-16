// The signed-in admin (`GET /auth/me`) and session-expiry handling (T1.10 "session-expired handling"): any request
// that comes back 401 drops the cached admin, so the gate shows the login screen with a friendly note.
import { useTranslation } from '@mc/i18n/react';
import type { AdminMe } from '@mc/shared/contracts';
import { NetworkError, ProblemError } from '@mc/shared/http';
import { type QueryClient, useQuery } from '@tanstack/react-query';
import { createContext, use } from 'react';

import { authApi } from '../api/auth-api.ts';

export const ME_KEY = ['auth', 'me'] as const;

/** True for the API's "no valid session" answer. */
export const isSignedOut = (error: unknown): boolean => error instanceof ProblemError && error.status === 401;

/** `GET /auth/me`; a 401 is an answer (signed out), not something to retry. */
export function useMe() {
  return useQuery({
    queryKey: ME_KEY,
    queryFn: ({ signal }) => authApi.me(signal),
    retry: (count, error) => !isSignedOut(error) && count < 2,
    staleTime: 5 * 60_000,
  });
}

let sessionEnded = false;

/**
 * Called by the query client for every failed query/mutation: a 401 anywhere means the session ended (expired,
 * revoked on another device, logged out everywhere) — the cached admin is dropped and the login screen says so.
 */
export function handleSessionError(client: QueryClient, error: unknown): void {
  if (!isSignedOut(error)) return;
  const cached = client.getQueryData(ME_KEY);
  if (cached !== undefined) {
    sessionEnded = true;
    void client.invalidateQueries({ queryKey: ME_KEY });
  }
}

/** Reads (and clears) the "your session ended" flag for the login screen. */
export function takeSessionEnded(): boolean {
  const value = sessionEnded;
  sessionEnded = false;
  return value;
}

/** The signed-in admin, provided by the session gate to every screen. */
export const MeContext = createContext<AdminMe | null>(null);

/** The signed-in admin. Only valid below the session gate. */
export function useSignedInAdmin(): AdminMe {
  const me = use(MeContext);
  if (!me) throw new Error('useSignedInAdmin() must be used below <SessionGate>');
  return me;
}

/**
 * A friendly message for any API failure (09 §2: `errors.<CODE>`): offline → NETWORK, unknown or internal → the
 * generic message. Never the raw error text.
 */
export function useErrorText(): (error: unknown) => string {
  const { t } = useTranslation('errors');
  return (error) => {
    const code =
      error instanceof ProblemError ? error.problem.code : error instanceof NetworkError ? 'NETWORK' : 'INTERNAL_ERROR';
    // A server code this build doesn't know (newer server) falls back to the generic message.
    return t(code as 'INTERNAL_ERROR', { defaultValue: t('INTERNAL_ERROR') }); // code-shaped key, checked by i18n
  };
}
