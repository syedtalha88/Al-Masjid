// api-admin auth endpoints that need no WebAuthn verification (03 §4, PHASE_01 T1.8): invite read, current admin,
// own sessions, logout. Registration, login and step-up (SimpleWebAuthn) are added next to these.
import { type DbHandle, idText, isId, parseId, publicScope, scoped } from '@mc/db';
import {
  acceptUndertaking,
  createAddDeviceInvite,
  listPasskeys,
  listSessions,
  readInvite,
  renamePasskey,
  revokeSessions,
} from '@mc/db/state';
import {
  adminMeSchema,
  adminPasskeyListSchema,
  adminSessionListSchema,
  inviteInfoSchema,
  inviteLinkSchema,
  passkeyLabelSchema,
  undertakingAcceptSchema,
} from '@mc/shared/contracts';
import { z } from 'zod';

import { clearCookie, SESSION_COOKIE } from '../auth/cookies.ts';
import { hashToken, newToken } from '../crypto/field.ts';
import { defineRoute, type RouteDefinition } from '../http/define-route.ts';
import { ApiProblem } from '../http/problem.ts';

export interface AdminAuthDeps {
  readonly db: DbHandle;
  /** `SESSION_PEPPER` bytes. */
  readonly pepper: Buffer;
  /** `ADMIN_ORIGIN` — "Add another device" links point there. */
  readonly adminOrigin: string;
}

/** Invite and session tokens: 32 random bytes, base64url (43 characters). */
const TOKEN = z.string().regex(/^[A-Za-z0-9_-]{43}$/);
const Empty = z.object({}).meta({ id: 'Empty' });

/** The auth routes of api-admin that do not verify passkeys. */
export function adminSessionRoutes(deps: AdminAuthDeps): RouteDefinition[] {
  return [
    defineRoute({
      method: 'get',
      path: '/auth/invite/:token',
      summary: 'Read an invite without using it (uniform 404 when invalid)',
      tags: ['auth'],
      auth: 'none',
      rateLimit: [{ bucket: 'adminLoginIp', key: 'ip' }],
      request: { params: z.object({ token: z.string() }) },
      responses: { 200: inviteInfoSchema },
      handler: async ({ params, clock, reply }) => {
        // Malformed tokens get the same 404 as unknown ones (no oracle on the format either).
        const token = TOKEN.safeParse(params.token);
        const invite = token.success
          ? await readInvite(deps.db, publicScope(), {
              tokenHash: hashToken(token.data, deps.pepper),
              now: clock.now(),
            })
          : null;
        if (!invite) throw new ApiProblem(404, 'INVITE_INVALID');
        return reply(200, {
          adminDisplayName: invite.adminDisplayName,
          masjidNames: [...invite.masjidNames],
          purpose: invite.purpose,
          uiLocale: invite.uiLocale,
        });
      },
    }),
    defineRoute({
      method: 'get',
      path: '/auth/me',
      summary: 'The signed-in admin, their masjids and whether the undertaking must be accepted',
      tags: ['auth'],
      auth: 'session',
      responses: { 200: adminMeSchema },
      handler: async ({ auth, reply }) => {
        const { session, scope } = auth;
        const db = await deps.db.db();
        const ids = session.masjids.map((m) => m.id);
        const names = new Map<string, string>();
        if (ids.length > 0) {
          const docs = await scoped({ scope, db }, 'masjids').find({ _id: { $in: ids } });
          for (const doc of docs) {
            const id: unknown = doc['_id'];
            if (isId(id) && typeof doc['name'] === 'string') names.set(idText(id), doc['name']);
          }
        }
        return reply(200, {
          admin: {
            id: idText(session.adminId),
            displayName: session.displayName,
            role: session.role,
            uiLocale: session.uiLocale,
          },
          masjids: session.masjids.map((m) => ({
            id: idText(m.id),
            name: names.get(idText(m.id)) ?? '',
            role: m.role,
          })),
          undertakingRequired: session.role === 'masjid_admin' && !session.undertakingCurrent,
          ...(session.undertakingVersion ? { undertakingVersion: session.undertakingVersion } : {}),
        });
      },
    }),
    defineRoute({
      method: 'get',
      path: '/auth/sessions',
      summary: 'Own live sessions',
      tags: ['auth'],
      auth: 'session',
      responses: { 200: adminSessionListSchema },
      handler: async ({ auth, clock, reply }) => {
        const sessions = await listSessions(deps.db, auth.scope, clock.now());
        return reply(200, {
          sessions: sessions.map((s) => ({
            id: idText(s.id),
            current: s.id.equals(auth.session.sessionId),
            createdAt: s.createdAt.toISOString(),
            lastSeenAt: s.lastSeenAt.toISOString(),
            ...(s.uaSummary ? { device: s.uaSummary } : {}),
          })),
        });
      },
    }),
    defineRoute({
      method: 'delete',
      path: '/auth/sessions/:id',
      summary: 'Sign out one of your own sessions (204 even for unknown ids)',
      tags: ['auth'],
      auth: 'session',
      undertaking: 'exempt',
      rateLimit: [{ bucket: 'adminWrites', key: 'session' }],
      request: { params: z.object({ id: z.string().max(64) }) },
      responses: { 204: Empty },
      handler: async ({ auth, params, clock, requestId, res, reply }) => {
        const id = parseId(params.id);
        if (id) {
          await revokeSessions(deps.db, auth.scope, {
            sessionId: id,
            reason: 'revoked_by_admin',
            now: clock.now(),
            requestId,
          });
          if (id.equals(auth.session.sessionId)) clearCookie(res, SESSION_COOKIE);
        }
        return reply(204, {});
      },
    }),
    defineRoute({
      method: 'post',
      path: '/auth/undertaking',
      summary: 'Accept the current admin undertaking (B2)',
      tags: ['auth'],
      auth: 'session',
      undertaking: 'exempt',
      rateLimit: [{ bucket: 'adminWrites', key: 'session' }],
      request: { body: undertakingAcceptSchema },
      responses: { 204: Empty },
      handler: async ({ auth, body, clock, requestId, reply }) => {
        await acceptUndertaking(deps.db, auth.scope, {
          version: body.version,
          now: clock.now(),
          requestId,
        });
        return reply(204, {});
      },
    }),
    defineRoute({
      method: 'delete',
      path: '/auth/sessions',
      summary: 'Sign out on every device, this one included',
      tags: ['auth'],
      auth: 'session',
      undertaking: 'exempt',
      rateLimit: [{ bucket: 'adminWrites', key: 'session' }],
      responses: { 204: Empty },
      handler: async ({ auth, clock, requestId, res, reply }) => {
        await revokeSessions(deps.db, auth.scope, { reason: 'logout', now: clock.now(), requestId });
        clearCookie(res, SESSION_COOKIE);
        return reply(204, {});
      },
    }),
    defineRoute({
      method: 'get',
      path: '/auth/passkeys',
      summary: 'Own passkeys (labels and dates only)',
      tags: ['auth'],
      auth: 'session',
      responses: { 200: adminPasskeyListSchema },
      handler: async ({ auth, reply }) => {
        const passkeys = await listPasskeys(deps.db, auth.scope);
        return reply(200, {
          passkeys: passkeys.map((p) => ({
            id: idText(p.id),
            label: p.label,
            deviceType: p.deviceType,
            backedUp: p.backedUp,
            createdAt: p.createdAt.toISOString(),
            ...(p.lastUsedAt ? { lastUsedAt: p.lastUsedAt.toISOString() } : {}),
          })),
        });
      },
    }),
    defineRoute({
      method: 'patch',
      path: '/auth/passkeys/:id',
      summary: 'Rename one of your passkeys',
      tags: ['auth'],
      auth: 'session',
      undertaking: 'exempt',
      rateLimit: [{ bucket: 'adminWrites', key: 'session' }],
      request: {
        params: z.object({ id: z.string().max(64) }),
        body: passkeyLabelSchema,
      },
      responses: { 204: Empty },
      handler: async ({ auth, params, body, reply }) => {
        const id = parseId(params.id);
        if (!id || !(await renamePasskey(deps.db, auth.scope, { passkeyId: id, label: body.label }))) {
          throw new ApiProblem(404, 'NOT_FOUND');
        }
        return reply(204, {});
      },
    }),
    defineRoute({
      method: 'post',
      path: '/auth/passkeys/invite',
      summary: 'Link to add a passkey on another device (72 h, one use)',
      tags: ['auth'],
      auth: 'session',
      undertaking: 'exempt',
      rateLimit: [{ bucket: 'adminWrites', key: 'session' }],
      responses: {
        201: inviteLinkSchema,
      },
      handler: async ({ auth, clock, requestId, reply }) => {
        const token = newToken();
        const expiresAt = await createAddDeviceInvite(deps.db, auth.scope, {
          tokenHash: hashToken(token, deps.pepper),
          now: clock.now(),
          requestId,
        });
        return reply(201, {
          inviteUrl: `${new URL('/invite', deps.adminOrigin).toString()}#${token}`,
          expiresAt: expiresAt.toISOString(),
        });
      },
    }),
    defineRoute({
      method: 'post',
      path: '/auth/logout',
      summary: 'Sign out this session',
      tags: ['auth'],
      auth: 'session',
      undertaking: 'exempt',
      rateLimit: [{ bucket: 'adminWrites', key: 'session' }],
      responses: { 204: Empty },
      handler: async ({ auth, clock, requestId, res, reply }) => {
        await revokeSessions(deps.db, auth.scope, {
          sessionId: auth.session.sessionId,
          reason: 'logout',
          now: clock.now(),
          requestId,
        });
        clearCookie(res, SESSION_COOKIE);
        return reply(204, {});
      },
    }),
  ];
}
