// Super Admin bootstrap (04 §3, PHASE_01 T1.9) — shared by the local CLI (`pnpm bootstrap:super-admin`) and the
// server one-off. A one-time invite link is printed; the token exists only in that link (the database stores its
// peppered hash) and sits in the URL fragment, so it never reaches a server log or a Referer header.
import { type DbHandle, systemScope } from '@mc/db';
import { bootstrapSuperAdmin } from '@mc/db/state';

import { hashToken, newToken } from '../crypto/field.ts';

export interface BootstrapOptions {
  readonly displayName: string;
  readonly uiLocale: 'en' | 'hi' | 'ur' | 'te';
  /** `--force-additional`: add another Super Admin although one exists. */
  readonly force: boolean;
}

/** Usage text for the CLI. */
export const BOOTSTRAP_USAGE =
  'Usage: bootstrap-super-admin --name "<display name>" [--locale en|hi|ur|te] [--force-additional]';

/**
 * Parses the CLI arguments.
 *
 * @returns the options, or an error message (unknown flag, missing or too long name, bad locale).
 */
export function parseBootstrapArgs(argv: readonly string[]): BootstrapOptions | { error: string } {
  let displayName: string | undefined;
  let uiLocale: BootstrapOptions['uiLocale'] = 'en';
  let force = false;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--force-additional') force = true;
    else if (arg === '--name') displayName = argv[(i += 1)]?.trim();
    else if (arg === '--locale') {
      const value = argv[(i += 1)];
      if (value !== 'en' && value !== 'hi' && value !== 'ur' && value !== 'te') return { error: 'bad --locale' };
      uiLocale = value;
    } else return { error: `unknown argument ${String(arg)}` };
  }
  if (!displayName) return { error: '--name is required' };
  if (displayName.length > 80) return { error: '--name is longer than 80 characters' };
  return { displayName, uiLocale, force };
}

/**
 * Creates a Super Admin with a `register` invite and returns the one-time link.
 *
 * @param adminOrigin - `ADMIN_ORIGIN` (e.g. `https://admin-staging.almasjids.com`).
 * @param pepper - `SESSION_PEPPER` bytes (the api-admin hashes the token the same way when the link is opened).
 * @throws StateError SUPER_ADMIN_EXISTS (without `force`).
 */
export async function bootstrapSuperAdminInvite(
  handle: DbHandle,
  options: BootstrapOptions & { adminOrigin: string; pepper: Buffer; now?: Date },
): Promise<{ inviteUrl: string; expiresAt: Date }> {
  const token = newToken();
  const { expiresAt } = await bootstrapSuperAdmin(handle, systemScope(), {
    displayName: options.displayName,
    uiLocale: options.uiLocale,
    inviteTokenHash: hashToken(token, options.pepper),
    force: options.force,
    ...(options.now ? { now: options.now } : {}),
  });
  return { inviteUrl: `${new URL('/invite', options.adminOrigin).toString()}#${token}`, expiresAt };
}
