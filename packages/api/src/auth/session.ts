// Middleware 5 (03 §0) for api-admin: the session cookie → `resolveSession` (04 §4 expiry, active admin only) → the
// typed DB scope the handler must use (02 §4: built from memberships loaded server-side, never from request input).
import { type AdminScope, adminScope, type DbHandle, publicScope, type SuperScope, superScope } from '@mc/db';
import { type ResolvedSession, resolveSession, STEP_UP_WINDOW_MS } from '@mc/db/state';
import type { Clock } from '@mc/shared/clock';
import type { Request, Response } from 'express';

import { hashToken } from '../crypto/field.ts';
import { ApiProblem } from '../http/problem.ts';
import { readCookie, SESSION_COOKIE } from './cookies.ts';

/**
 * How a route authenticates (03 §1): `none`; `session` (any active admin); `super` (Super Admin); `super_step_up`
 * (Super Admin with a passkey assertion in the last 5 minutes — ★ actions).
 */
export type RouteAuth = 'none' | 'session' | 'super' | 'super_step_up';

export interface AuthedSession {
  readonly session: ResolvedSession;
  /** Super Admins get a super scope, everyone else an admin scope over their memberships. */
  readonly scope: AdminScope | SuperScope;
}

/** Resolves the request's session, or `null` when there is none / it is dead. */
export type Authenticate = (req: Request) => Promise<AuthedSession | null>;

/** The production authenticator: cookie token → SHA-256(token‖pepper) → live session. */
export function sessionAuthenticator(deps: { db: DbHandle; pepper: Buffer; clock: Clock }): Authenticate {
  return async (req) => {
    const token = readCookie(req, SESSION_COOKIE);
    if (!token) return null;
    const session = await resolveSession(deps.db, publicScope(), {
      tokenHash: hashToken(token, deps.pepper),
      now: deps.clock.now(),
    });
    if (!session) return null;
    const scope =
      session.role === 'super_admin'
        ? superScope(session.adminId, session.stepUpAt)
        : adminScope({ adminId: session.adminId, masjids: session.masjids });
    return { session, scope };
  };
}

const AUTHENTICATE = 'authenticate';
const AUTHED = 'mcAuth';

/** Stores the app's authenticator (read by {@link authenticateRequest}). */
export function installAuthenticator(locals: Record<string, unknown>, authenticate: Authenticate | undefined): void {
  if (authenticate) locals[AUTHENTICATE] = authenticate;
}

/** The authenticated session of this request, once {@link authenticateRequest} ran (rate-limit keys use it). */
export function authedOf(res: Response): AuthedSession | undefined {
  const value: unknown = res.locals[AUTHED];
  return typeof value === 'object' && value !== null && 'session' in value ? (value as AuthedSession) : undefined; // set below
}

/**
 * Applies a route's auth requirement. A protected route on an app without an authenticator fails closed (500).
 *
 * @returns the session for protected routes, `undefined` for `none`.
 * @throws ApiProblem 401 `SESSION_REQUIRED`, 403 `FORBIDDEN` (not a Super Admin), 403 `STEP_UP_REQUIRED`.
 */
export async function authenticateRequest(
  req: Request,
  res: Response,
  auth: RouteAuth,
  now: Date,
): Promise<AuthedSession | undefined> {
  if (auth === 'none') return undefined;
  const authenticate: unknown = req.app.locals[AUTHENTICATE];
  if (typeof authenticate !== 'function') throw new Error('route requires a session but the app has no authenticator');
  const authed = await (authenticate as Authenticate)(req); // installed by installAuthenticator
  if (!authed) throw new ApiProblem(401, 'SESSION_REQUIRED');
  if (auth !== 'session' && authed.session.role !== 'super_admin') throw new ApiProblem(403, 'FORBIDDEN');
  if (auth === 'super_step_up') {
    const at = authed.session.stepUpAt;
    if (!at || now.getTime() - at.getTime() > STEP_UP_WINDOW_MS) throw new ApiProblem(403, 'STEP_UP_REQUIRED');
  }
  res.locals[AUTHED] = authed;
  return authed;
}
