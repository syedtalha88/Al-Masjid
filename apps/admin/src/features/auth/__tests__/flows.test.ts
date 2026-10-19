import { beforeEach, describe, expect, it, vi } from 'vitest';

import { authApi } from '../api/auth-api.ts';
import { deviceLabel, registerWithInvite, signIn, stepUp } from '../lib/flows.ts';
import { createPasskey, getPasskey } from '../lib/passkey.ts';

vi.mock('../api/auth-api.ts', () => ({
  authApi: {
    registerOptions: vi.fn(),
    registerVerify: vi.fn(),
    loginOptions: vi.fn(),
    loginVerify: vi.fn(),
    stepUpOptions: vi.fn(),
    stepUpVerify: vi.fn(),
  },
}));
vi.mock('../lib/passkey.ts', () => ({ createPasskey: vi.fn(), getPasskey: vi.fn() }));

const TOKEN = 'A'.repeat(43);
const CREATION = {
  rp: { name: 'Test RP' },
  user: { id: 'dQ', name: 't', displayName: 'T' },
  challenge: 'Yw',
  pubKeyCredParams: [],
};
const REQUEST = { challenge: 'Yw' };
const CREDENTIAL = { id: 'cred-1' };

// PHASE_01 T1.8 client flows (07 B1): options → device screen lock → verify, in that order, with the same token.
describe('passkey flows', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('register: options for the invite, the new passkey, then verify with its label', async () => {
    vi.mocked(authApi.registerOptions).mockResolvedValue(CREATION);
    vi.mocked(createPasskey).mockResolvedValue(CREDENTIAL);
    await registerWithInvite(TOKEN, 'Android — 19 Oct');
    expect(authApi.registerOptions).toHaveBeenCalledWith(TOKEN);
    expect(createPasskey).toHaveBeenCalledWith(CREATION);
    expect(authApi.registerVerify).toHaveBeenCalledWith(TOKEN, CREDENTIAL, 'Android — 19 Oct');
  });

  it('register: a cancelled screen lock never reaches verify', async () => {
    vi.mocked(authApi.registerOptions).mockResolvedValue(CREATION);
    vi.mocked(createPasskey).mockRejectedValue(new Error('cancelled'));
    await expect(registerWithInvite(TOKEN, 'x')).rejects.toThrow('cancelled');
    expect(authApi.registerVerify).not.toHaveBeenCalled();
  });

  it('sign in and step-up: request options → assertion → verify', async () => {
    vi.mocked(authApi.loginOptions).mockResolvedValue(REQUEST);
    vi.mocked(authApi.stepUpOptions).mockResolvedValue(REQUEST);
    vi.mocked(getPasskey).mockResolvedValue(CREDENTIAL);
    await signIn();
    expect(authApi.loginVerify).toHaveBeenCalledWith(CREDENTIAL);
    await stepUp();
    expect(authApi.stepUpVerify).toHaveBeenCalledWith(CREDENTIAL);
    expect(getPasskey).toHaveBeenCalledTimes(2);
  });

  it('device labels name the platform and the date, ≤ 60 characters', () => {
    const now = new Date('2026-10-19T10:00:00+05:30');
    expect(deviceLabel('Mozilla/5.0 (Linux; Android 15; Pixel 7)', now, 'en')).toMatch(/^Android — (Oct 19|19 Oct)$/);
    expect(deviceLabel('Android', now, 'en').length).toBeLessThanOrEqual(60);
    expect(deviceLabel('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)', now, 'en')).toMatch(/^iPhone — /);
    expect(deviceLabel('Mozilla/5.0 (Windows NT 10.0; Win64; x64)', now, 'en')).toMatch(/^Windows — /);
    expect(deviceLabel('Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0)', now, 'en')).toMatch(/^Mac — /);
    expect(deviceLabel('curl/8', now, 'en')).toMatch(/^Device — /);
    // Latin digits in every locale (02 §2 labels are shown in lists next to Latin dates).
    expect(deviceLabel('Android', now, 'ur')).toMatch(/19/);
  });
});
