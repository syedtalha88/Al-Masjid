// api-admin passkey ceremonies (03 §4, 04 §3, PHASE_01 T1.8): registration with an invite, discoverable login,
// step-up on the current session. Options come with a one-time challenge (Redis GETDEL, 5 min, bound to the invite /
// the `__Host-mc_chal` cookie / the session); verification failures of every kind answer the same 401 PASSKEY_FAILED
// (no admin enumeration — 04 §3). Sessions are created, rotated and revoked by the data layer (DECISIONS #69).
import { type DbHandle, parseAaguid, publicScope, StateError } from '@mc/db';
import {
  completeAssertion,
  credentialLabel,
  findLoginCredential,
  readInvite,
  recordLoginFailure,
  registerCredential,
  SESSION_LIFETIMES,
} from '@mc/db/state';
import {
  assertionVerifyRequestSchema,
  creationOptionsSchema,
  registerOptionsRequestSchema,
  registerVerifyRequestSchema,
  requestOptionsSchema,
} from '@mc/shared/contracts';
import type { Request, Response } from 'express';
import type { Logger } from 'pino';
import { z } from 'zod';

import { CHALLENGE_TTL_SEC, type ChallengeStore } from '../auth/challenges.ts';
import { CHALLENGE_COOKIE, clearCookie, readCookie, SESSION_COOKIE, setCookie } from '../auth/cookies.ts';
import { uaSummary } from '../auth/user-agent.ts';
import {
  authenticationOptions,
  registrationOptions,
  type RelyingParty,
  verifyAssertion,
  verifyRegistration,
} from '../auth/webauthn.ts';
import { hashToken, newToken } from '../crypto/field.ts';
import { defineRoute, type RouteDefinition } from '../http/define-route.ts';
import { ApiProblem } from '../http/problem.ts';
import { consumeInHandler, type RateLimitRule } from '../http/rate-limit.ts';

export interface AdminPasskeyDeps {
  readonly db: DbHandle;
  /** `SESSION_PEPPER` bytes. */
  readonly pepper: Buffer;
  /** `RP_ID` (= the admin host), the passkey name and `ADMIN_ORIGIN`. */
  readonly rp: RelyingParty;
  readonly challenges: ChallengeStore;
  readonly logger: Logger;
}

const Empty = z.object({}).meta({ id: 'Empty' });
const failed = () => new ApiProblem(401, 'PASSKEY_FAILED');

// 03 §2 "30 / 10 min / IP" (DECISIONS #81; IPv6 by /64 and /48 — reviews M1, L-2). The "20 / hour / credential" limit counts FAILED assertions of a
// known credential only (in the handler): counting every claim would let anyone who knows a credential id lock its
// owner out (review L3), and a valid signature cannot be guessed anyway. It also caps the failure audit entries.
const LOGIN_LIMITS: readonly RateLimitRule[] = [{ bucket: 'adminLoginIp', key: 'ip' }];

const credentialBytes = (id: string) => new Uint8Array(Buffer.from(id, 'base64url'));

function setSession(res: Response, token: string, role: keyof typeof SESSION_LIFETIMES): void {
  setCookie(res, SESSION_COOKIE, token, SESSION_LIFETIMES[role].absoluteMs / 1000);
}

/** The passkey routes of api-admin (register / login / step-up, options + verify). */
export function adminPasskeyRoutes(deps: AdminPasskeyDeps): RouteDefinition[] {
  const { db, pepper, rp, challenges, logger } = deps;
  const inviteBinding = (inviteToken: string) => hashToken(inviteToken, pepper).toString('base64url');

  /**
   * Shared by login and step-up: the claimed credential, the assertion verification, and the failure accounting.
   * Failures of a KNOWN credential are audited (`auth.login_failed`, credential hash only) up to the 20/h credential
   * limit; the first failure over it writes one more entry marked `capped` plus a warning, so a burst on one
   * credential stays visible without filling the audit log (review L-7). Unknown credential ids are only logged — an
   * audit entry per anonymous request would let a flood fill the database (review M1).
   *
   * @returns the stored credential and the authenticator's new counter.
   * @throws ApiProblem 401 PASSKEY_FAILED.
   */
  async function verifiedAssertion(
    req: Request,
    response: z.infer<typeof assertionVerifyRequestSchema>['response'],
    challenge: string | undefined,
    requestId: string,
    ownerId?: { equals(other: unknown): boolean },
  ) {
    const claimedId = credentialBytes(response.id);
    const label = credentialLabel(claimedId);
    const credential = await findLoginCredential(db, publicScope(), claimedId);
    const fail = async (reason: string) => {
      const decision = credential === null ? null : await consumeInHandler(req, 'adminLoginCredential', label);
      const capped = decision !== null && !decision.allowed && decision.firstRefusal;
      const audited = decision !== null && (decision.allowed || capped);
      logger.info({ event: 'passkey.assertion_failed', reason, credential: label, audited }, 'passkey failed');
      if (capped) {
        logger.warn(
          { event: 'passkey.failure_cap', credential: label },
          'failed passkey attempts on one credential reached the hourly cap: further failures are not audited',
        );
      }
      if (audited) await recordLoginFailure(db, publicScope(), { credentialId: claimedId, requestId, capped });
      return failed();
    };
    if (!challenge) throw await fail('no live challenge (expired, used or never issued)');
    if (!credential) throw await fail('unknown or revoked credential');
    if (ownerId && !ownerId.equals(credential.adminId)) throw await fail('credential of another admin');
    const verified = await verifyAssertion(rp, response, challenge, credential);
    if (!verified.ok) throw await fail(verified.reason);
    return { credential, newCounter: verified.value.newCounter };
  }

  /** The data layer's refusals after a verified assertion — all the same 401. */
  function assertionRefusal(error: unknown, credentialId: Uint8Array): ApiProblem {
    if (!(error instanceof StateError)) throw error;
    if (error.code === 'COUNTER_REGRESSION') {
      // 04 §3: possible cloned authenticator — the credential and every session of its admin are revoked and audited
      // (credential.revoke). The Super Admin alert (push) lands in Phase 4; until then this warning + the audit entry.
      logger.warn(
        { event: 'passkey.counter_regression', credential: credentialLabel(credentialId) },
        'passkey sign counter went backwards: credential revoked',
      );
      return failed();
    }
    if (['CREDENTIAL_REVOKED', 'SESSION_INVALID'].includes(error.code)) return failed();
    throw error;
  }

  return [
    defineRoute({
      method: 'post',
      path: '/auth/register/options',
      summary: 'Passkey creation options for an invite (uniform 404 when the invite is invalid)',
      tags: ['auth'],
      auth: 'none',
      rateLimit: [{ bucket: 'adminLoginIp', key: 'ip' }],
      request: { body: registerOptionsRequestSchema },
      responses: { 200: creationOptionsSchema },
      handler: async ({ body, clock, reply }) => {
        const invite = await readInvite(db, publicScope(), {
          tokenHash: hashToken(body.inviteToken, pepper),
          now: clock.now(),
        });
        if (!invite) throw new ApiProblem(404, 'INVITE_INVALID');
        const challenge = await challenges.issue('register', inviteBinding(body.inviteToken));
        return reply(
          200,
          await registrationOptions(rp, {
            challenge,
            userHandle: invite.userHandle,
            displayName: invite.adminDisplayName,
            exclude: invite.existingCredentials,
          }),
        );
      },
    }),
    defineRoute({
      method: 'post',
      path: '/auth/register/verify',
      summary: 'Store the new passkey, use the invite and sign in (one transaction)',
      tags: ['auth'],
      auth: 'none',
      rateLimit: [{ bucket: 'adminLoginIp', key: 'ip' }],
      request: { body: registerVerifyRequestSchema },
      responses: { 204: Empty },
      handler: async ({ body, clock, requestId, req, res, reply }) => {
        const challenge = await challenges.take('register', inviteBinding(body.inviteToken));
        if (!challenge) throw failed();
        const verified = await verifyRegistration(rp, body.response, challenge);
        if (!verified.ok) {
          logger.info({ event: 'passkey.registration_failed', reason: verified.reason }, 'passkey registration failed');
          throw failed();
        }
        const c = verified.value;
        const aaguid = parseAaguid(c.aaguid);
        const sessionToken = newToken();
        try {
          const session = await registerCredential(db, publicScope(), {
            inviteTokenHash: hashToken(body.inviteToken, pepper),
            credential: {
              id: c.id,
              publicKey: c.publicKey,
              counter: c.counter,
              transports: c.transports,
              ...(aaguid ? { aaguid } : {}),
              backedUp: c.backedUp,
              deviceType: c.deviceType,
              label: body.label,
            },
            sessionTokenHash: hashToken(sessionToken, pepper),
            uaSummary: uaSummary(req.get('user-agent')),
            requestId,
            now: clock.now(),
          });
          setSession(res, sessionToken, session.role);
        } catch (error) {
          if (error instanceof StateError && error.code === 'CREDENTIAL_EXISTS') throw failed();
          throw error; // INVITE_INVALID → the uniform 404 (http/errors.ts)
        }
        return reply(204, {});
      },
    }),
    defineRoute({
      method: 'post',
      path: '/auth/login/options',
      summary: 'Passkey request options for a discoverable login (challenge bound to a 5-minute cookie)',
      tags: ['auth'],
      auth: 'none',
      rateLimit: [{ bucket: 'adminLoginIp', key: 'ip' }],
      responses: { 200: requestOptionsSchema },
      handler: async ({ res, reply }) => {
        const challengeId = newToken();
        const challenge = await challenges.issue('login', challengeId);
        setCookie(res, CHALLENGE_COOKIE, challengeId, CHALLENGE_TTL_SEC);
        return reply(200, await authenticationOptions(rp, challenge));
      },
    }),
    defineRoute({
      method: 'post',
      path: '/auth/login/verify',
      summary: 'Verify a passkey assertion and sign in (new session)',
      tags: ['auth'],
      auth: 'none',
      rateLimit: LOGIN_LIMITS,
      request: { body: assertionVerifyRequestSchema },
      responses: { 204: Empty },
      handler: async ({ body, clock, requestId, req, res, reply }) => {
        const challengeId = readCookie(req, CHALLENGE_COOKIE);
        clearCookie(res, CHALLENGE_COOKIE);
        const challenge = challengeId ? await challenges.take('login', challengeId) : undefined;
        const { credential, newCounter } = await verifiedAssertion(req, body.response, challenge, requestId);
        const sessionToken = newToken();
        try {
          const session = await completeAssertion(db, publicScope(), {
            credentialDocId: credential.credentialDocId,
            newCounter,
            sessionTokenHash: hashToken(sessionToken, pepper),
            uaSummary: uaSummary(req.get('user-agent')),
            requestId,
            now: clock.now(),
          });
          setSession(res, sessionToken, session.role);
        } catch (error) {
          throw assertionRefusal(error, credential.id);
        }
        return reply(204, {});
      },
    }),
    defineRoute({
      method: 'post',
      path: '/auth/step-up/options',
      summary: 'Passkey request options to confirm a sensitive action (bound to this session)',
      tags: ['auth'],
      auth: 'session',
      // Confirms who is there and writes no content — like logout, allowed before the undertaking (T1.10).
      undertaking: 'exempt',
      rateLimit: [{ bucket: 'adminWrites', key: 'session' }],
      responses: { 200: requestOptionsSchema },
      handler: async ({ auth, reply }) => {
        const challenge = await challenges.issue('step_up', auth.session.sessionId.toHexString());
        return reply(200, await authenticationOptions(rp, challenge));
      },
    }),
    defineRoute({
      method: 'post',
      path: '/auth/step-up/verify',
      summary: 'Verify a passkey assertion of the signed-in admin: rotates the session and opens the 5-minute window',
      tags: ['auth'],
      auth: 'session',
      // Confirms who is there and writes no content — like logout, allowed before the undertaking (T1.10).
      undertaking: 'exempt',
      rateLimit: [{ bucket: 'adminWrites', key: 'session' }],
      request: { body: assertionVerifyRequestSchema },
      responses: { 204: Empty },
      handler: async ({ auth, body, clock, requestId, req, res, reply }) => {
        const challenge = await challenges.take('step_up', auth.session.sessionId.toHexString());
        const { credential, newCounter } = await verifiedAssertion(
          req,
          body.response,
          challenge,
          requestId,
          auth.session.adminId,
        );
        const sessionToken = newToken();
        try {
          const session = await completeAssertion(db, publicScope(), {
            credentialDocId: credential.credentialDocId,
            newCounter,
            sessionTokenHash: hashToken(sessionToken, pepper),
            stepUpSessionId: auth.session.sessionId,
            requestId,
            now: clock.now(),
          });
          setSession(res, sessionToken, session.role);
        } catch (error) {
          throw assertionRefusal(error, credential.id);
        }
        return reply(204, {});
      },
    }),
  ];
}
