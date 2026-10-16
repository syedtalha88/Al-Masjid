// Super Admin API (03 §5, PHASE_01 T1.11): dashboard, masjids, admins, settings, audit. Mounted under `/api/super`
// behind the router-level role guard (app.ts); ★ routes additionally need a step-up in the last 5 minutes. All changes
// go through the state functions (scope checks, visibility mirror, version bump, audit) — routes only validate input
// and shape output.
import { type DbHandle, idText, parseId } from '@mc/db';
import {
  type AdminOfMasjid,
  getDashboard,
  getMasjidDetail,
  getSettings,
  listAudit,
  listMasjids,
  type MasjidRow,
} from '@mc/db/repos';
import { ASR_MADHAB, CALC_METHOD, INDIA, MASJID_STATUS } from '@mc/db/schema';
import {
  changeMasjidStatus,
  createAdminForMasjid,
  createInvite,
  createMasjid,
  readAdminPhone,
  removeAdminFromMasjid,
  revokeAdminPasskeys,
  revokeAdminSessions,
  updateMasjid,
  updateSettings,
} from '@mc/db/state';
import { z } from 'zod';

import { decryptField, encryptField, type FieldKeyRing, hashToken, newToken } from '../crypto/field.ts';
import { defineRoute, type RouteDefinition } from '../http/define-route.ts';
import { ApiProblem } from '../http/problem.ts';

export interface SuperRouteDeps {
  readonly db: DbHandle;
  /** `SESSION_PEPPER` bytes (invite token hashes). */
  readonly pepper: Buffer;
  /** `ADMIN_ORIGIN` — invite links point there. */
  readonly adminOrigin: string;
  /** Field encryption keys (admin phone numbers). */
  readonly keyRing: FieldKeyRing;
}

const PHONE_CONTEXT = 'admin_users.phone_enc';
const LOCALE = z.enum(['en', 'hi', 'ur', 'te']);
const Id = z.string().max(64);
const text = (max: number, min = 0) => z.string().trim().min(min).max(max);
const Lat = z.number().min(INDIA.lat[0]).max(INDIA.lat[1]);
const Lng = z.number().min(INDIA.lng[0]).max(INDIA.lng[1]);
const HijriOffset = z.union([z.literal(-2), z.literal(-1), z.literal(0), z.literal(1), z.literal(2)]);
const NameI18n = z.object({ hi: text(120).optional(), ur: text(120).optional(), te: text(120).optional() });
const Reason = z.object({ reason: text(300, 3) });

const MasjidRowOut = z
  .object({
    id: z.string(),
    name: z.string(),
    area: z.string(),
    city: z.string(),
    status: z.enum(MASJID_STATUS),
    followCode: z.string(),
    adminCount: z.number(),
    createdAt: z.iso.datetime(),
  })
  .meta({ id: 'SuperMasjidRow' });
const rowOut = (row: MasjidRow) => ({
  id: idText(row.id),
  name: row.name,
  area: row.area,
  city: row.city,
  status: row.status,
  followCode: row.followCode,
  adminCount: row.adminCount,
  createdAt: row.createdAt.toISOString(),
});

const AdminOut = z
  .object({
    id: z.string(),
    displayName: z.string(),
    role: z.enum(['owner', 'editor']),
    status: z.enum(['invited', 'active', 'disabled']),
    uiLocale: LOCALE,
    hasPhone: z.boolean(),
    undertakingVersion: z.string().optional(),
    lastLoginAt: z.iso.datetime().optional(),
  })
  .meta({ id: 'SuperMasjidAdmin' });

const MasjidDetailOut = z
  .object({
    masjid: z.object({
      id: z.string(),
      followCode: z.string(),
      name: z.string(),
      nameI18n: NameI18n,
      area: z.string(),
      city: z.string(),
      state: z.string(),
      address: z.string(),
      lat: z.number(),
      lng: z.number(),
      status: z.enum(MASJID_STATUS),
      calcMethod: z.enum(CALC_METHOD),
      asrMadhab: z.enum(ASR_MADHAB),
      hijriOffset: HijriOffset.optional(),
      pushDailyQuota: z.number(),
      adminCount: z.number(),
      verifiedAt: z.iso.datetime().optional(),
      createdAt: z.iso.datetime(),
    }),
    followers: z.number(),
    admins: z.array(AdminOut),
  })
  .meta({ id: 'SuperMasjidDetail' });

const adminOut = (a: AdminOfMasjid) => ({
  id: idText(a.id),
  displayName: a.displayName,
  role: a.role,
  status: a.status,
  uiLocale: a.uiLocale,
  hasPhone: a.hasPhone,
  ...(a.undertakingVersion ? { undertakingVersion: a.undertakingVersion } : {}),
  ...(a.lastLoginAt ? { lastLoginAt: a.lastLoginAt.toISOString() } : {}),
});

const InviteOut = z.object({ inviteUrl: z.url(), expiresAt: z.iso.datetime() }).meta({ id: 'SuperInvite' });
const Empty = z.object({});
const Count = z.object({ count: z.number() }).meta({ id: 'SuperCount' });

const SettingsOut = z
  .object({
    globalHijriOffset: z.number(),
    defaultPushQuota: z.number(),
    supportWhatsapp: z.string().optional(),
    grievanceOfficer: z.object({ name: z.string(), email: z.string(), address: z.string(), city: z.string() }),
    undertakingVersion: z.string(),
    privacyVersion: z.string(),
    termsVersion: z.string(),
    updatedAt: z.iso.datetime(),
  })
  .meta({ id: 'SuperSettings' });

const AuditRowOut = z
  .object({
    id: z.string(),
    at: z.iso.datetime(),
    actorType: z.string(),
    actorId: z.string().optional(),
    action: z.string(),
    masjidId: z.string().optional(),
    targetType: z.string().optional(),
    targetId: z.string().optional(),
    meta: z.record(z.string(), z.unknown()).optional(),
    requestId: z.string().optional(),
  })
  .meta({ id: 'SuperAuditRow' });

/** Drops `undefined` values so optional input fields stay absent (exactOptionalPropertyTypes). */
function defined<T extends object>(value: T): { [K in keyof T]?: Exclude<T[K], undefined> } {
  return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)) as {
    [K in keyof T]?: Exclude<T[K], undefined>;
  }; // same keys, undefined values removed
}

/** Resolves an id path parameter; malformed ids answer like unknown ones. */
function idOr404(text: string, code: 'MASJID_NOT_FOUND' | 'ADMIN_NOT_FOUND') {
  const id = parseId(text);
  if (!id) throw new ApiProblem(404, code);
  return id;
}

const inviteUrl = (adminOrigin: string, token: string) => `${new URL('/invite', adminOrigin).toString()}#${token}`;

/** CSV cell: quoted, quotes doubled, and formula-leading characters neutralised (CSV injection). */
const csvCell = (value: unknown): string => {
  const raw = value === undefined || value === null ? '' : typeof value === 'string' ? value : JSON.stringify(value);
  const safe = /^[=+\-@\t\r]/.test(raw) ? `'${raw}` : raw;
  return `"${safe.replace(/"/g, '""')}"`;
};

const AuditQuery = z.object({
  actor: Id.optional(),
  masjid: Id.optional(),
  action: z
    .string()
    .regex(/^[a-z_]+\.[a-z_]+$/)
    .optional(),
  from: z.iso.datetime().optional(),
  to: z.iso.datetime().optional(),
  cursor: z.string().max(200).optional(),
});
const auditFilters = (query: z.infer<typeof AuditQuery>) => {
  const actorId = query.actor ? parseId(query.actor) : undefined;
  const masjidId = query.masjid ? parseId(query.masjid) : undefined;
  if ((query.actor && !actorId) || (query.masjid && !masjidId)) {
    throw new ApiProblem(400, 'VALIDATION_FAILED', undefined, [{ path: 'query', code: 'invalid_id' }]);
  }
  return {
    ...(actorId ? { actorId } : {}),
    ...(masjidId ? { masjidId } : {}),
    ...(query.action ? { action: query.action } : {}),
    ...(query.from ? { from: new Date(query.from) } : {}),
    ...(query.to ? { to: new Date(query.to) } : {}),
  };
};

/** Every `/api/super` route (03 §5, Phase 1 part). */
export function superRoutes(deps: SuperRouteDeps): RouteDefinition[] {
  const { db } = deps;
  const writes = [{ bucket: 'superWrites', key: 'session' }] as const;
  return [
    defineRoute({
      method: 'get',
      path: '/dashboard',
      summary: 'Pending activations and masjid counts (C1)',
      tags: ['super'],
      auth: 'super',
      responses: {
        200: z
          .object({
            pending: z.array(MasjidRowOut),
            counts: z.object({ pending: z.number(), active: z.number(), suspended: z.number(), deleted: z.number() }),
          })
          .meta({ id: 'SuperDashboard' }),
      },
      handler: async ({ auth, reply }) => {
        const dashboard = await getDashboard(db, auth.scope);
        return reply(200, { pending: dashboard.pending.map(rowOut), counts: { ...dashboard.counts } });
      },
    }),
    defineRoute({
      method: 'get',
      path: '/masjids',
      summary: 'List and search masjids (C2)',
      tags: ['super'],
      auth: 'super',
      request: {
        query: z.object({
          q: z.string().max(80).optional(),
          status: z.enum(MASJID_STATUS).optional(),
          cursor: z.string().max(200).optional(),
        }),
      },
      responses: {
        200: z.object({ masjids: z.array(MasjidRowOut), next: z.string().optional() }).meta({ id: 'SuperMasjidList' }),
      },
      handler: async ({ auth, query, reply }) => {
        const page = await listMasjids(db, auth.scope, {
          ...(query.q ? { q: query.q } : {}),
          ...(query.status ? { status: query.status } : {}),
          ...(query.cursor ? { cursor: query.cursor } : {}),
        });
        return reply(200, { masjids: page.rows.map(rowOut), ...(page.next ? { next: page.next } : {}) });
      },
    }),
    defineRoute({
      method: 'post',
      path: '/masjids',
      summary: 'Create a masjid (pending until activated)',
      tags: ['super'],
      auth: 'super',
      rateLimit: writes,
      request: {
        body: z.object({
          name: text(120, 1),
          nameI18n: NameI18n.optional(),
          area: text(80),
          city: text(80, 1),
          state: text(80, 1),
          address: text(300),
          lat: Lat,
          lng: Lng,
          calcMethod: z.enum(CALC_METHOD).optional(),
          asrMadhab: z.enum(ASR_MADHAB).optional(),
          hijriOffset: HijriOffset.optional(),
        }),
      },
      responses: { 201: z.object({ id: z.string(), followCode: z.string() }).meta({ id: 'SuperMasjidCreated' }) },
      handler: async ({ auth, body, requestId, reply }) => {
        const { id, followCode } = await createMasjid(
          db,
          auth.scope,
          {
            name: body.name,
            ...(body.nameI18n ? { nameI18n: defined(body.nameI18n) } : {}),
            area: body.area,
            city: body.city,
            state: body.state,
            address: body.address,
            lat: body.lat,
            lng: body.lng,
            ...(body.calcMethod ? { calcMethod: body.calcMethod } : {}),
            ...(body.asrMadhab ? { asrMadhab: body.asrMadhab } : {}),
            ...(body.hijriOffset === undefined ? {} : { hijriOffset: body.hijriOffset }),
          },
          { requestId },
        );
        return reply(201, { id: idText(id), followCode });
      },
    }),
    defineRoute({
      method: 'get',
      path: '/masjids/:id',
      summary: 'Masjid page: profile, followers, admins (C2)',
      tags: ['super'],
      auth: 'super',
      request: { params: z.object({ id: Id }) },
      responses: { 200: MasjidDetailOut },
      handler: async ({ auth, params, reply }) => {
        const detail = await getMasjidDetail(db, auth.scope, idOr404(params.id, 'MASJID_NOT_FOUND'));
        if (!detail) throw new ApiProblem(404, 'MASJID_NOT_FOUND');
        const m = detail.masjid;
        return reply(200, {
          masjid: {
            id: params.id.toLowerCase(),
            followCode: String(m['follow_code']),
            name: String(m['name']),
            nameI18n: NameI18n.catch({}).parse(m['name_i18n']),
            area: String(m['area']),
            city: String(m['city']),
            state: String(m['state']),
            address: String(m['address']),
            lat: Number(m['lat']),
            lng: Number(m['lng']),
            status: m['status'] as (typeof MASJID_STATUS)[number], // validator-enforced enum
            calcMethod: m['calc_method'] as (typeof CALC_METHOD)[number], // validator-enforced enum
            asrMadhab: m['asr_madhab'] as (typeof ASR_MADHAB)[number], // validator-enforced enum
            ...(typeof m['hijri_offset'] === 'number'
              ? { hijriOffset: m['hijri_offset'] as z.infer<typeof HijriOffset> } // validator: -2..2
              : {}),
            pushDailyQuota: Number(m['push_daily_quota']),
            adminCount: Number(m['admin_count']),
            ...(m['verified_at'] instanceof Date ? { verifiedAt: m['verified_at'].toISOString() } : {}),
            createdAt: (m['created_at'] as Date).toISOString(), // validator-enforced date
          },
          followers: detail.followers,
          admins: detail.admins.map(adminOut),
        });
      },
    }),
    defineRoute({
      method: 'patch',
      path: '/masjids/:id',
      summary: 'Edit a masjid profile (bumps its content version)',
      tags: ['super'],
      auth: 'super',
      rateLimit: writes,
      request: {
        params: z.object({ id: Id }),
        body: z.object({
          name: text(120, 1).optional(),
          nameI18n: NameI18n.optional(),
          area: text(80).optional(),
          city: text(80, 1).optional(),
          state: text(80, 1).optional(),
          address: text(300).optional(),
          lat: Lat.optional(),
          lng: Lng.optional(),
          calcMethod: z.enum(CALC_METHOD).optional(),
          asrMadhab: z.enum(ASR_MADHAB).optional(),
          hijriOffset: HijriOffset.nullable().optional(),
        }),
      },
      responses: { 200: z.object({ changed: z.array(z.string()) }).meta({ id: 'SuperChanged' }) },
      handler: async ({ auth, params, body, requestId, reply }) => {
        const { nameI18n, ...rest } = body;
        const changed = await updateMasjid(db, auth.scope, {
          masjidId: idOr404(params.id, 'MASJID_NOT_FOUND'),
          patch: { ...defined(rest), ...(nameI18n ? { nameI18n: defined(nameI18n) } : {}) },
          requestId,
        });
        return reply(200, { changed: [...changed] });
      },
    }),
    defineRoute({
      method: 'patch',
      path: '/masjids/:id/quotas',
      summary: 'Set the masjid’s daily notification quota',
      tags: ['super'],
      auth: 'super',
      rateLimit: writes,
      request: { params: z.object({ id: Id }), body: z.object({ pushDailyQuota: z.int().min(0).max(50) }) },
      responses: { 200: z.object({ changed: z.array(z.string()) }) },
      handler: async ({ auth, params, body, requestId, reply }) => {
        const changed = await updateMasjid(db, auth.scope, {
          masjidId: idOr404(params.id, 'MASJID_NOT_FOUND'),
          patch: { pushDailyQuota: body.pushDailyQuota },
          requestId,
        });
        return reply(200, { changed: [...changed] });
      },
    }),
    ...(
      [
        [
          'activate',
          'super',
          'post',
          '/masjids/:id/activate',
          'Activate (needs an active admin who accepted the undertaking)',
        ],
        ['suspend', 'super_step_up', 'post', '/masjids/:id/suspend', '★ Suspend with a reason'],
        ['unsuspend', 'super_step_up', 'post', '/masjids/:id/unsuspend', '★ Unsuspend with a reason'],
        ['delete', 'super_step_up', 'delete', '/masjids/:id', '★ Delete (soft; retention applies)'],
      ] as const
    ).map(([transition, auth, method, path, summary]) =>
      defineRoute({
        method,
        path,
        summary,
        tags: ['super'],
        auth,
        rateLimit: writes,
        request: {
          params: z.object({ id: Id }),
          ...(transition === 'activate' ? {} : { body: transition === 'delete' ? Reason.partial() : Reason }),
        },
        responses: { 204: Empty },
        handler: async ({ auth: session, params, body, clock, requestId, reply }) => {
          const reason = typeof body === 'object' && 'reason' in body ? body.reason : undefined;
          await changeMasjidStatus(db, session.scope, {
            masjidId: idOr404(params.id, 'MASJID_NOT_FOUND'),
            transition,
            now: clock.now(),
            ...(reason ? { reason } : {}),
            requestId,
          });
          return reply(204, {});
        },
      }),
    ),
    defineRoute({
      method: 'post',
      path: '/admins',
      summary: 'Create a masjid admin and their one-time invite link',
      tags: ['super'],
      auth: 'super',
      rateLimit: writes,
      request: {
        body: z.object({
          displayName: text(80, 1),
          phone: z
            .string()
            .regex(/^\+?[0-9]{10,15}$/)
            .optional(),
          uiLocale: LOCALE,
          masjidId: Id,
          role: z.enum(['owner', 'editor']),
        }),
      },
      responses: { 201: InviteOut.extend({ adminId: z.string() }).meta({ id: 'SuperAdminCreated' }) },
      handler: async ({ auth, body, requestId, reply }) => {
        const token = newToken();
        const { adminId, expiresAt } = await createAdminForMasjid(db, auth.scope, {
          displayName: body.displayName,
          uiLocale: body.uiLocale,
          ...(body.phone ? { phoneEnc: encryptField(deps.keyRing, body.phone, PHONE_CONTEXT) } : {}),
          masjidId: idOr404(body.masjidId, 'MASJID_NOT_FOUND'),
          role: body.role,
          inviteTokenHash: hashToken(token, deps.pepper),
          requestId,
        });
        return reply(201, {
          adminId: idText(adminId),
          inviteUrl: inviteUrl(deps.adminOrigin, token),
          expiresAt: expiresAt.toISOString(),
        });
      },
    }),
    defineRoute({
      method: 'get',
      path: '/admins',
      summary: 'Admins of a masjid',
      tags: ['super'],
      auth: 'super',
      request: { query: z.object({ masjidId: Id }) },
      responses: { 200: z.object({ admins: z.array(AdminOut) }).meta({ id: 'SuperAdminList' }) },
      handler: async ({ auth, query, reply }) => {
        const detail = await getMasjidDetail(db, auth.scope, idOr404(query.masjidId, 'MASJID_NOT_FOUND'));
        if (!detail) throw new ApiProblem(404, 'MASJID_NOT_FOUND');
        return reply(200, {
          admins: detail.admins.map(adminOut),
        });
      },
    }),
    defineRoute({
      method: 'post',
      path: '/admins/:id/invites',
      summary: '★ New invite link (closes the previous one of the same purpose)',
      tags: ['super'],
      auth: 'super_step_up',
      rateLimit: writes,
      request: {
        params: z.object({ id: Id }),
        body: z.object({ purpose: z.enum(['register', 'add_device', 'recovery']) }),
      },
      responses: { 201: InviteOut },
      handler: async ({ auth, params, body, clock, requestId, reply }) => {
        const token = newToken();
        const expiresAt = await createInvite(db, auth.scope, {
          adminId: idOr404(params.id, 'ADMIN_NOT_FOUND'),
          purpose: body.purpose,
          tokenHash: hashToken(token, deps.pepper),
          now: clock.now(),
          requestId,
        });
        return reply(201, { inviteUrl: inviteUrl(deps.adminOrigin, token), expiresAt: expiresAt.toISOString() });
      },
    }),
    defineRoute({
      method: 'post',
      path: '/admins/:id/revoke-sessions',
      summary: '★ Sign the admin out everywhere',
      tags: ['super'],
      auth: 'super_step_up',
      rateLimit: writes,
      request: { params: z.object({ id: Id }) },
      responses: { 200: Count },
      handler: async ({ auth, params, clock, requestId, reply }) => {
        const count = await revokeAdminSessions(db, auth.scope, {
          adminId: idOr404(params.id, 'ADMIN_NOT_FOUND'),
          now: clock.now(),
          requestId,
        });
        return reply(200, { count });
      },
    }),
    defineRoute({
      method: 'post',
      path: '/admins/:id/revoke-passkeys',
      summary: '★ Revoke all passkeys (and sessions) of the admin',
      tags: ['super'],
      auth: 'super_step_up',
      rateLimit: writes,
      request: { params: z.object({ id: Id }) },
      responses: { 200: Count },
      handler: async ({ auth, params, clock, requestId, reply }) => {
        const count = await revokeAdminPasskeys(db, auth.scope, {
          adminId: idOr404(params.id, 'ADMIN_NOT_FOUND'),
          now: clock.now(),
          requestId,
        });
        return reply(200, { count });
      },
    }),
    defineRoute({
      method: 'delete',
      path: '/admins/:id/masjids/:masjidId',
      summary: '★ Remove the admin from a masjid',
      tags: ['super'],
      auth: 'super_step_up',
      rateLimit: writes,
      request: { params: z.object({ id: Id, masjidId: Id }) },
      responses: { 204: Empty },
      handler: async ({ auth, params, clock, requestId, reply }) => {
        await removeAdminFromMasjid(db, auth.scope, {
          adminId: idOr404(params.id, 'ADMIN_NOT_FOUND'),
          masjidId: idOr404(params.masjidId, 'MASJID_NOT_FOUND'),
          now: clock.now(),
          requestId,
        });
        return reply(204, {});
      },
    }),
    defineRoute({
      method: 'get',
      path: '/admins/:id/phone',
      summary: '★ Decrypt and show the admin’s phone (audited)',
      tags: ['super'],
      auth: 'super_step_up',
      request: { params: z.object({ id: Id }) },
      responses: { 200: z.object({ phone: z.string().nullable() }).meta({ id: 'SuperAdminPhone' }) },
      handler: async ({ auth, params, clock, requestId, reply }) => {
        const encrypted = await readAdminPhone(db, auth.scope, {
          adminId: idOr404(params.id, 'ADMIN_NOT_FOUND'),
          now: clock.now(),
          requestId,
        });
        return reply(200, { phone: encrypted ? decryptField(deps.keyRing, encrypted, PHONE_CONTEXT) : null });
      },
    }),
    defineRoute({
      method: 'get',
      path: '/settings',
      summary: 'Global settings (C10)',
      tags: ['super'],
      auth: 'super',
      responses: { 200: SettingsOut },
      handler: async ({ auth, reply }) => {
        const s = await getSettings(db, auth.scope);
        return reply(200, {
          globalHijriOffset: Number(s['global_hijri_offset']),
          defaultPushQuota: Number(s['default_push_quota']),
          ...(typeof s['support_whatsapp'] === 'string' ? { supportWhatsapp: s['support_whatsapp'] } : {}),
          grievanceOfficer: s['grievance_officer'] as z.infer<typeof SettingsOut>['grievanceOfficer'], // validator
          undertakingVersion: String(s['undertaking_version']),
          privacyVersion: String(s['privacy_version']),
          termsVersion: String(s['terms_version']),
          updatedAt: (s['updated_at'] as Date).toISOString(), // validator-enforced date
        });
      },
    }),
    defineRoute({
      method: 'patch',
      path: '/settings',
      summary: 'Edit global settings (C10)',
      tags: ['super'],
      auth: 'super',
      rateLimit: writes,
      request: {
        body: z.object({
          globalHijriOffset: HijriOffset.optional(),
          defaultPushQuota: z.int().min(0).max(50).optional(),
          supportWhatsapp: z
            .string()
            .regex(/^\+?[0-9]{8,15}$/)
            .nullable()
            .optional(),
          grievanceOfficer: z
            .object({ name: text(120, 1), email: z.email().max(200), address: text(300, 1), city: text(80, 1) })
            .optional(),
          undertakingVersion: text(20, 1).optional(),
          privacyVersion: text(20, 1).optional(),
          termsVersion: text(20, 1).optional(),
        }),
      },
      responses: { 200: z.object({ changed: z.array(z.string()) }) },
      handler: async ({ auth, body, clock, requestId, reply }) => {
        const changed = await updateSettings(db, auth.scope, {
          patch: defined(body),
          now: clock.now(),
          requestId,
        });
        return reply(200, { changed: [...changed] });
      },
    }),
    defineRoute({
      method: 'get',
      path: '/audit',
      summary: 'Audit log (C11)',
      tags: ['super'],
      auth: 'super',
      request: { query: AuditQuery },
      responses: {
        200: z.object({ entries: z.array(AuditRowOut), next: z.string().optional() }).meta({ id: 'SuperAuditPage' }),
      },
      handler: async ({ auth, query, reply }) => {
        const page = await listAudit(db, auth.scope, {
          ...auditFilters(query),
          ...(query.cursor ? { cursor: query.cursor } : {}),
        });
        return reply(200, {
          entries: page.rows.map((r) => ({
            id: r.id,
            at: r.at.toISOString(),
            actorType: r.actorType,
            ...(r.actorId ? { actorId: idText(r.actorId) } : {}),
            action: r.action,
            ...(r.masjidId ? { masjidId: idText(r.masjidId) } : {}),
            ...(r.targetType ? { targetType: r.targetType } : {}),
            ...(r.targetId ? { targetId: r.targetId } : {}),
            ...(r.meta ? { meta: { ...r.meta } } : {}),
            ...(r.requestId ? { requestId: r.requestId } : {}),
          })),
          ...(page.next ? { next: page.next } : {}),
        });
      },
    }),
    defineRoute({
      method: 'get',
      path: '/audit/export.csv',
      summary: '★ Audit log as CSV (same filters, at most 10 000 rows)',
      tags: ['super'],
      auth: 'super_step_up',
      csvAttachment: 'audit.csv',
      request: { query: AuditQuery.omit({ cursor: true }) },
      responses: { 200: z.string() },
      handler: async ({ auth, query, reply }) => {
        const filters = auditFilters(query);
        const lines = ['at,actor_type,actor_id,action,masjid_id,target_type,target_id,meta,request_id'];
        let cursor: string | undefined;
        do {
          const page = await listAudit(db, auth.scope, { ...filters, limit: 100, ...(cursor ? { cursor } : {}) });
          for (const r of page.rows) {
            lines.push(
              [
                r.at.toISOString(),
                r.actorType,
                r.actorId ? idText(r.actorId) : '',
                r.action,
                r.masjidId ? idText(r.masjidId) : '',
                r.targetType,
                r.targetId,
                r.meta,
                r.requestId,
              ]
                .map(csvCell)
                .join(','),
            );
          }
          cursor = page.next;
        } while (cursor && lines.length <= 10_000);
        return reply(200, `${lines.join('\r\n')}\r\n`);
      },
    }),
  ];
}
