// @vitest-environment jsdom
import type { AdminMe } from '@mc/shared/contracts';
import { NetworkError, ProblemError } from '@mc/shared/http';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { authApi } from '../api/auth-api.ts';
import {
  handleSessionError,
  isSignedOut,
  ME_KEY,
  MeContext,
  takeSessionEnded,
  useErrorText,
  useMe,
  useSignedInAdmin,
} from '../hooks/use-session.ts';

vi.mock('../api/auth-api.ts', () => ({ authApi: { me: vi.fn() } }));
vi.mock('@mc/i18n/react', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { defaultValue?: string }) =>
      ['INTERNAL_ERROR', 'NETWORK', 'SESSION_EXPIRED'].includes(key) ? `msg:${key}` : (options?.defaultValue ?? key),
  }),
}));

const ME: AdminMe = {
  admin: { id: 'a1', displayName: 'Test Admin', role: 'masjid_admin', uiLocale: 'en' },
  masjids: [{ id: 'm1', name: 'Test Masjid Alpha', role: 'owner' }],
  undertakingRequired: false,
};
const problem = (status: number, code: string) =>
  new ProblemError({ type: 'about:blank', title: code, status, code }, undefined);

const wrapper = (client: QueryClient) =>
  function Wrapper({ children }: { readonly children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  };

afterEach(() => {
  vi.resetAllMocks();
  takeSessionEnded();
});

// PHASE_01 T1.10 "session-expired handling": a 401 anywhere drops the cached admin and the login screen says why.
describe('admin session', () => {
  it('only a 401 problem means "signed out"', () => {
    expect(isSignedOut(problem(401, 'UNAUTHENTICATED'))).toBe(true);
    expect(isSignedOut(problem(403, 'FORBIDDEN'))).toBe(false);
    expect(isSignedOut(new NetworkError('failed'))).toBe(false);
  });

  it('a 401 after being signed in flags "session ended" once and refetches /me', () => {
    const client = new QueryClient();
    client.setQueryData(ME_KEY, ME);
    const invalidate = vi.spyOn(client, 'invalidateQueries');
    handleSessionError(client, problem(500, 'INTERNAL_ERROR'));
    expect(takeSessionEnded()).toBe(false);
    handleSessionError(client, problem(401, 'UNAUTHENTICATED'));
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ME_KEY });
    expect(takeSessionEnded()).toBe(true);
    expect(takeSessionEnded()).toBe(false);
  });

  it('a 401 before any sign-in is just "signed out", not "session ended"', () => {
    handleSessionError(new QueryClient(), problem(401, 'UNAUTHENTICATED'));
    expect(takeSessionEnded()).toBe(false);
  });

  it('useMe loads the admin; a 401 is not retried', async () => {
    vi.mocked(authApi.me).mockResolvedValueOnce(ME);
    const ok = renderHook(() => useMe(), { wrapper: wrapper(new QueryClient()) });
    await waitFor(() => {
      expect(ok.result.current.data).toEqual(ME);
    });

    vi.mocked(authApi.me).mockRejectedValue(problem(401, 'UNAUTHENTICATED'));
    const signedOut = renderHook(() => useMe(), { wrapper: wrapper(new QueryClient()) });
    await waitFor(() => {
      expect(signedOut.result.current.isError).toBe(true);
    });
    expect(authApi.me).toHaveBeenCalledTimes(2); // one success + one 401, no retries
  });

  it('useSignedInAdmin works only below the session gate', () => {
    expect(() => renderHook(() => useSignedInAdmin())).toThrow(/SessionGate/);
    const { result } = renderHook(() => useSignedInAdmin(), {
      wrapper: ({ children }) => <MeContext value={ME}>{children}</MeContext>,
    });
    expect(result.current.admin.displayName).toBe('Test Admin');
  });

  it('error text: the code’s message, NETWORK offline, the generic one for unknown codes and other errors', () => {
    const { result } = renderHook(() => useErrorText());
    expect(result.current(problem(401, 'SESSION_EXPIRED'))).toBe('msg:SESSION_EXPIRED');
    expect(result.current(problem(409, 'SOME_FUTURE_CODE'))).toBe('msg:INTERNAL_ERROR');
    expect(result.current(new NetworkError('timeout'))).toBe('msg:NETWORK');
    expect(result.current(new Error('boom'))).toBe('msg:INTERNAL_ERROR');
  });
});
