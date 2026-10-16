// api-admin auth endpoints that need no WebAuthn verification (03 §4, PHASE_01 T1.8): invite read, current admin,
// own sessions, logout. Registration, login and step-up (SimpleWebAuthn) are added next to these.
import { type DbHandle, idText, isId, parseId, publicScope, scoped } from '@mc/db';
import { listSessions, readInvite, revokeSessions } from '@mc/db/state';
import { z } from 'zod';

import { clearCookie, SESSION_COOKIE } from '../auth/cookies.ts';
import { hashToken } from '../crypto/field.ts';
import { defineRoute, type RouteDefinition } from '../http/define-route.ts';
import { ApiProblem } from '../http/problem.ts';

export interface AdminAuthDeps {
  readonly db: DbHandle;
  /** `SESSION_PEPPER` bytes. */
  readonly pepper: Buffer;
}

/** Invite and session tokens: 32 random bytes, base64url (43 characters). */
const TOKEN = z.string().regex(/^[A-Za-z0-9_-]{43}$/);
const LOCALE = z.enum(['en', 'hi', 'ur', 'te']);

export const InviteInfo = z
  .object({
    adminDisplayName: z.string(),
    masjidNames: z.array(z.string()),
    purpose: z.enum(['register', 'add_device', 'recovery']),
    uiLocale: LOCALE,
  })
  .meta({ id: 'InviteInfo' });

export const Me = z
  .object({
    admin: z.object({
      id: z.string(),
      displayName: z.string(),
      role: z.enum(['super_admin', 'masjid_admin']),
      uiLocale: LOCALE,
    }),
    masjids: z.array(z.object({ id: z.string(), name: z.string(), role: z.enum(['owner', 'editor']) })),
    undertakingRequired: z.boolean(),
  })
  .meta({ id: 'AdminMe' });

export const SessionList = z
  .object({
    sessions: z.array(
      z.object({
        id: z.string(),
        current: z.boolean(),
        createdAt: z.iso.datetime(),
        lastSeenAt: z.iso.datetime(),
        device: z.string().optional(),
      }),
    ),
  })
  .meta({ id: 'AdminSessionList' });

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
      responses: { 200: InviteInfo },
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
      responses: { 200: Me },
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
        const settings = await scoped({ scope, db }, 'app_settings').findOne({ _id: 'global' });
        const current = typeof settings?.['undertaking_version'] === 'string' ? settings['undertaking_version'] : '';
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
          undertakingRequired: session.role === 'masjid_admin' && session.undertakingVersion !== current,
        });
      },
    }),
    defineRoute({
      method: 'get',
      path: '/auth/sessions',
      summary: 'Own live sessions',
      tags: ['auth'],
      auth: 'session',
      responses: { 200: SessionList },
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
            ...(requestId ? { requestId } : {}),
          });
          if (id.equals(auth.session.sessionId)) clearCookie(res, SESSION_COOKIE);
        }
        return reply(204, {});
      },
    }),
    defineRoute({
      method: 'post',
      path: '/auth/logout',
      summary: 'Sign out this session',
      tags: ['auth'],
      auth: 'session',
      rateLimit: [{ bucket: 'adminWrites', key: 'session' }],
      responses: { 204: Empty },
      handler: async ({ auth, clock, requestId, res, reply }) => {
        await revokeSessions(deps.db, auth.scope, {
          sessionId: auth.session.sessionId,
          reason: 'logout',
          now: clock.now(),
          ...(requestId ? { requestId } : {}),
        });
        clearCookie(res, SESSION_COOKIE);
        return reply(204, {});
      },
    }),
  ];
}
