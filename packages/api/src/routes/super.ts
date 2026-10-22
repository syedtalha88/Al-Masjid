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
import {
  changeMasjidStatus,
  createAdminForMasjid,
  createInvite,
  createMasjid,
  readAdminPhone,
  recordAuditExport,
  removeAdminFromMasjid,
  revokeAdminPasskeys,
  revokeAdminSessions,
  updateMasjid,
  updateSettings,
} from '@mc/db/state';
import {
  adminPhoneSchema,
  type ASR_MADHABS,
  auditPageSchema,
  auditQuerySchema,
  type CALC_METHODS,
  changedSchema,
  countSchema,
  type hijriOffsetSchema,
  inviteLinkSchema,
  invitePurposeSchema,
  MASJID_STATUSES,
  nameI18nSchema,
  reasonSchema,
  superAdminCreatedSchema,
  superAdminCreateSchema,
  superAdminListSchema,
  superDashboardSchema,
  superMasjidCreatedSchema,
  superMasjidCreateSchema,
  superMasjidDetailSchema,
  superMasjidListSchema,
  superMasjidPatchSchema,
  superQuotaSchema,
  superSettingsPatchSchema,
  superSettingsSchema,
} from '@mc/shared/contracts';
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
const Id = z.string().max(64);
const Empty = z.object({});
const NameI18n = nameI18nSchema;
const Reason = reasonSchema;
const AuditQuery = auditQuerySchema;
/** Rows in one audit CSV export (the header line not counted). */
export const AUDIT_EXPORT_MAX_ROWS = 10_000;
const SettingsOut = superSettingsSchema;

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
      summary: 'Pending activations, masjid counts and passkey clone alerts (C1)',
      tags: ['super'],
      auth: 'super',
      responses: {
        200: superDashboardSchema,
      },
      handler: async ({ auth, clock, reply }) => {
        const dashboard = await getDashboard(db, auth.scope, { now: clock.now() });
        return reply(200, {
          pending: dashboard.pending.map(rowOut),
          counts: { ...dashboard.counts },
          passkeyAlerts: dashboard.passkeyAlerts,
        });
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
          status: z.enum(MASJID_STATUSES).optional(),
          cursor: z.string().max(200).optional(),
        }),
      },
      responses: {
        200: superMasjidListSchema,
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
        body: superMasjidCreateSchema,
      },
      responses: { 201: superMasjidCreatedSchema },
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
      responses: { 200: superMasjidDetailSchema },
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
            status: m['status'] as (typeof MASJID_STATUSES)[number], // validator-enforced enum
            calcMethod: m['calc_method'] as (typeof CALC_METHODS)[number], // validator-enforced enum
            asrMadhab: m['asr_madhab'] as (typeof ASR_MADHABS)[number], // validator-enforced enum
            ...(typeof m['hijri_offset'] === 'number'
              ? { hijriOffset: m['hijri_offset'] as z.infer<typeof hijriOffsetSchema> } // validator: -2..2
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
        body: superMasjidPatchSchema,
      },
      responses: { 200: changedSchema },
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
      request: { params: z.object({ id: Id }), body: superQuotaSchema },
      responses: { 200: changedSchema },
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
        body: superAdminCreateSchema,
      },
      responses: { 201: superAdminCreatedSchema },
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
      responses: { 200: superAdminListSchema },
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
        body: invitePurposeSchema,
      },
      responses: { 201: inviteLinkSchema },
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
      responses: { 200: countSchema },
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
      responses: { 200: countSchema },
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
      responses: { 200: adminPhoneSchema },
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
        body: superSettingsPatchSchema,
      },
      responses: { 200: changedSchema },
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
        200: auditPageSchema,
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
      handler: async ({ auth, query, clock, requestId, reply }) => {
        const filters = auditFilters(query);
        const lines = ['at,actor_type,actor_id,action,masjid_id,target_type,target_id,meta,request_id'];
        let cursor: string | undefined;
        do {
          const page = await listAudit(db, auth.scope, { ...filters, limit: 100, ...(cursor ? { cursor } : {}) });
          for (const r of page.rows.slice(0, AUDIT_EXPORT_MAX_ROWS + 1 - lines.length)) {
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
        } while (cursor && lines.length - 1 < AUDIT_EXPORT_MAX_ROWS); // never more than 10 000 rows (review L-12)
        // The export itself is audited (04 R4, review L9): which filters, how many rows — never the rows.
        await recordAuditExport(db, auth.scope, {
          filters: Object.fromEntries(Object.entries(query).map(([key, value]) => [key, String(value)])),
          rows: lines.length - 1,
          ...(cursor ? { truncated: true } : {}),
          requestId,
          now: clock.now(),
        });
        return reply(200, `${lines.join('\r\n')}\r\n`);
      },
    }),
  ];
}
