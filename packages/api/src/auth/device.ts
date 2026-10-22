// Middleware 5 (03 §0) for api-public: `Authorization: Device <deviceId>.<secret>` (03 §1). The secret is 32 random
// bytes (base64url, 43 characters); the server keeps only its SHA-256 and compares in constant time. A device is
// pseudonymous — no IP, user agent or location is read or stored (05 §1).
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

import { type DbHandle, type DeviceScope, deviceScope, parseId, publicScope } from '@mc/db';
import { findDeviceCredential, touchDevice } from '@mc/db/state';
import type { Clock } from '@mc/shared/clock';
import type { Request } from 'express';

import { ApiProblem } from '../http/problem.ts';

/** How a public route authenticates: a registered device, or a device when one is presented. */
export type DeviceRouteAuth = 'device' | 'device_optional';

export interface AuthedDevice {
  /** Canonical id text (rate-limit key). */
  readonly deviceId: string;
  readonly scope: DeviceScope;
}

/** `null`: no device header at all; `false`: a header that does not authenticate. */
export type AuthenticateDevice = (req: Request) => Promise<AuthedDevice | null | false>;

const HEADER = /^Device ([0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\.([A-Za-z0-9_-]{43})$/;

/** A new device secret: 32 random bytes, base64url (the client stores it in IndexedDB — 04 §4). */
export const newDeviceSecret = (): string => randomBytes(32).toString('base64url');

/** SHA-256 of a device secret (what `devices.secret_hash` holds). */
export const deviceSecretHash = (secret: string): Buffer => createHash('sha256').update(secret).digest();

/** The production authenticator: header → stored hash → constant-time compare; marks the device seen once a day. */
export function deviceAuthenticator(deps: { db: DbHandle; clock: Clock }): AuthenticateDevice {
  return async (req) => {
    const header = req.get('authorization');
    if (header === undefined) return null;
    const match = HEADER.exec(header);
    const id = match ? parseId(match[1] ?? '') : undefined;
    if (!match || !id) return false;
    const credential = await findDeviceCredential(deps.db, publicScope(), id);
    // Always hash and compare, so an unknown id costs the same as a wrong secret.
    const presented = deviceSecretHash(match[2] ?? '');
    const stored = credential?.secretHash ?? Buffer.alloc(32);
    if (!timingSafeEqual(presented, stored) || !credential) return false;
    const scope = deviceScope(id);
    await touchDevice(deps.db, scope, credential.lastSeenAt, deps.clock.now());
    return { deviceId: id.toHexString(true), scope };
  };
}

const AUTHENTICATE_DEVICE = 'authenticateDevice';

/** Stores the app's device authenticator (read by {@link authenticateDevice}). */
export function installDeviceAuthenticator(
  locals: Record<string, unknown>,
  authenticate: AuthenticateDevice | undefined,
): void {
  if (authenticate) locals[AUTHENTICATE_DEVICE] = authenticate;
}

/**
 * Applies a route's device requirement. A device route on an app without an authenticator fails closed (500).
 *
 * @returns the device; `undefined` for `device_optional` without a device header.
 * @throws ApiProblem 401 `DEVICE_AUTH_REQUIRED` — missing header on a `device` route, or any header that does not
 *   authenticate (the app then registers again).
 */
export async function authenticateDevice(req: Request, auth: DeviceRouteAuth): Promise<AuthedDevice | undefined> {
  const authenticate: unknown = req.app.locals[AUTHENTICATE_DEVICE];
  if (typeof authenticate !== 'function') throw new Error('route requires a device but the app has no authenticator');
  const result = await (authenticate as AuthenticateDevice)(req); // installed by installDeviceAuthenticator
  if (result) return result;
  if (result === null && auth === 'device_optional') return undefined;
  throw new ApiProblem(401, 'DEVICE_AUTH_REQUIRED');
}
