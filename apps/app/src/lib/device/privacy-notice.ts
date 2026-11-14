// Privacy notice re-acceptance (05 §2, PHASE_08 T8.6): after onboarding, the notice is shown again when the server's
// current version (`/config` → `legalVersions.privacy`, changed by the Super Admin after a legal update) differs from
// the one this phone accepted, and once a year as a reminder. Accepting stores the version and time on the phone and
// tells the server through the usual preferences sync (offline: queued).
import type { DeviceState } from './store.ts';

/** The yearly reminder (05 §2). */
export const PRIVACY_REMINDER_MS = 365 * 24 * 60 * 60 * 1000;

export type PrivacyRecheck = 'changed' | 'yearly' | null;

/**
 * Whether to show the notice again, and why.
 *
 * @param serverVersion - the current version from `/config`; `undefined` (not loaded, offline) never prompts.
 * @returns `changed` (another version is current), `yearly` (accepted a year ago or more), or `null`.
 */
export function privacyRecheck(
  state: Pick<DeviceState, 'onboardedAt' | 'privacyVersion' | 'privacyAcceptedAt'>,
  serverVersion: string | undefined,
  now: Date,
): PrivacyRecheck {
  if (!state.onboardedAt || !state.privacyVersion || serverVersion === undefined) return null;
  if (state.privacyVersion !== serverVersion) return 'changed';
  // Phones onboarded before T8.6 have no acceptance time: their onboarding time stands in.
  const accepted = Date.parse(state.privacyAcceptedAt ?? state.onboardedAt);
  return Number.isFinite(accepted) && now.getTime() - accepted >= PRIVACY_REMINDER_MS ? 'yearly' : null;
}
