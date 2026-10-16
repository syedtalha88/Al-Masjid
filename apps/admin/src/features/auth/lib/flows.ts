// The three passkey flows of the admin app (07 B1, 04 §3): options from api-admin → the device's screen lock →
// verification by api-admin, which sets or rotates the session cookie.
import { authApi } from '../api/auth-api.ts';
import { createPasskey, getPasskey } from './passkey.ts';

/** A short label for the new passkey, e.g. "Chrome on Android — 16 Oct" (02 §2 label ≤ 60). */
export function deviceLabel(userAgent: string, now: Date, locale: string): string {
  const os = /Android/i.test(userAgent)
    ? 'Android'
    : /iPhone|iPad/i.test(userAgent)
      ? 'iPhone'
      : /Windows/i.test(userAgent)
        ? 'Windows'
        : /Mac OS X/i.test(userAgent)
          ? 'Mac'
          : 'Device';
  const date = new Intl.DateTimeFormat(`${locale}-u-nu-latn`, { day: 'numeric', month: 'short' }).format(now);
  return `${os} — ${date}`.slice(0, 60);
}

/** Registers a passkey with an invite link's token; on success the browser holds a session cookie. */
export async function registerWithInvite(inviteToken: string, label: string): Promise<void> {
  const options = await authApi.registerOptions(inviteToken);
  const response = await createPasskey(options);
  await authApi.registerVerify(inviteToken, response, label);
}

/** Logs in with a discoverable passkey (no username — 04 §3). */
export async function signIn(): Promise<void> {
  const options = await authApi.loginOptions();
  await authApi.loginVerify(await getPasskey(options));
}

/** Confirms a sensitive action with the screen lock again (★, 5 minutes). */
export async function stepUp(): Promise<void> {
  const options = await authApi.stepUpOptions();
  await authApi.stepUpVerify(await getPasskey(options));
}
