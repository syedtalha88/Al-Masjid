import { z } from 'zod';

import { MODERATION_CATEGORIES, MODERATION_NOTE_MAX } from '../compliance.ts';
import { livePaymentSchema, paymentRequestRowSchema } from './admin.ts';
import { inviteLinkSchema } from './admin-auth.ts';
import { safeText } from './text.ts';

// Super Admin contracts (03 §5): the API validates with them, the admin PWA parses with them. The enums and bounds
// mirror `@mc/db/schema` (a test in packages/api keeps them equal — shared must not depend on the database package).

export const MASJID_STATUSES = ['pending', 'active', 'suspended', 'deleted'] as const;
export const CALC_METHODS = ['karachi', 'mwl', 'isna', 'egypt', 'umm_al_qura', 'other_custom'] as const;
export const ASR_MADHABS = ['hanafi', 'shafi'] as const;
/** Coordinates must lie inside India (02 §2 masjids). */
export const INDIA_BOUNDS = { lat: [6, 37.5], lng: [68, 97.5] } as const;

const LOCALE = z.enum(['en', 'hi', 'ur', 'te']);
/** Free text (04 §6): NFC, trimmed, no control / bidi-override characters — see ./text.ts. */
const text = (max: number, min = 0) => safeText(max, { min });
export const latSchema = z.number().min(INDIA_BOUNDS.lat[0]).max(INDIA_BOUNDS.lat[1]);
export const lngSchema = z.number().min(INDIA_BOUNDS.lng[0]).max(INDIA_BOUNDS.lng[1]);
export const hijriOffsetSchema = z.union([z.literal(-2), z.literal(-1), z.literal(0), z.literal(1), z.literal(2)]);
/** Nested request objects are strict too: unknown keys are refused, not dropped (04 §6, review L10). */
export const nameI18nSchema = z.strictObject({
  hi: text(120).optional(),
  ur: text(120).optional(),
  te: text(120).optional(),
});
/**
 * Names in other scripts as RESPONSES carry them: plain strings. Request rules (`safeText`) are never applied to
 * output — a name stored under older rules, or a character an older Unicode table in the browser does not know, must
 * not make the detail screen fail (security review, 22 Oct 2026).
 */
const nameI18nOutSchema = z.object({ hi: z.string().optional(), ur: z.string().optional(), te: z.string().optional() });
export const reasonSchema = z.object({ reason: text(300, 3) });

export const superMasjidRowSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    area: z.string(),
    city: z.string(),
    status: z.enum(MASJID_STATUSES),
    followCode: z.string(),
    adminCount: z.number(),
    createdAt: z.iso.datetime(),
  })
  .meta({ id: 'SuperMasjidRow' });
export type SuperMasjidRow = z.infer<typeof superMasjidRowSchema>;

export const superMasjidListSchema = z
  .object({ masjids: z.array(superMasjidRowSchema), next: z.string().optional() })
  .meta({ id: 'SuperMasjidList' });

export const superMasjidCreateSchema = z.object({
  name: text(120, 1),
  nameI18n: nameI18nSchema.optional(),
  area: text(80),
  city: text(80, 1),
  state: text(80, 1),
  address: text(300),
  lat: latSchema,
  lng: lngSchema,
  calcMethod: z.enum(CALC_METHODS).optional(),
  asrMadhab: z.enum(ASR_MADHABS).optional(),
  hijriOffset: hijriOffsetSchema.optional(),
});
export type SuperMasjidCreate = z.infer<typeof superMasjidCreateSchema>;

export const superMasjidCreatedSchema = z
  .object({ id: z.string(), followCode: z.string() })
  .meta({ id: 'SuperMasjidCreated' });

export const superMasjidPatchSchema = z.object({
  name: text(120, 1).optional(),
  nameI18n: nameI18nSchema.optional(),
  area: text(80).optional(),
  city: text(80, 1).optional(),
  state: text(80, 1).optional(),
  address: text(300).optional(),
  lat: latSchema.optional(),
  lng: lngSchema.optional(),
  calcMethod: z.enum(CALC_METHODS).optional(),
  asrMadhab: z.enum(ASR_MADHABS).optional(),
  hijriOffset: hijriOffsetSchema.nullable().optional(),
});
export type SuperMasjidPatch = z.infer<typeof superMasjidPatchSchema>;

export const superQuotaSchema = z.object({ pushDailyQuota: z.int().min(0).max(50) });
export const changedSchema = z.object({ changed: z.array(z.string()) }).meta({ id: 'SuperChanged' });

export const superAdminRowSchema = z
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
export type SuperAdminRow = z.infer<typeof superAdminRowSchema>;

export const superMasjidDetailSchema = z
  .object({
    masjid: z.object({
      id: z.string(),
      followCode: z.string(),
      name: z.string(),
      nameI18n: nameI18nOutSchema,
      area: z.string(),
      city: z.string(),
      state: z.string(),
      address: z.string(),
      lat: z.number(),
      lng: z.number(),
      status: z.enum(MASJID_STATUSES),
      calcMethod: z.enum(CALC_METHODS),
      asrMadhab: z.enum(ASR_MADHABS),
      hijriOffset: hijriOffsetSchema.optional(),
      pushDailyQuota: z.number(),
      adminCount: z.number(),
      verifiedAt: z.iso.datetime().optional(),
      createdAt: z.iso.datetime(),
    }),
    followers: z.number(),
    admins: z.array(superAdminRowSchema),
  })
  .meta({ id: 'SuperMasjidDetail' });
export type SuperMasjidDetail = z.infer<typeof superMasjidDetailSchema>;

export const superAdminCreateSchema = z.object({
  displayName: text(80, 1),
  phone: z
    .string()
    .regex(/^\+?[0-9]{10,15}$/)
    .optional(),
  uiLocale: LOCALE,
  masjidId: z.string().max(64),
  role: z.enum(['owner', 'editor']),
});
export type SuperAdminCreate = z.infer<typeof superAdminCreateSchema>;

export const superAdminCreatedSchema = inviteLinkSchema
  .extend({ adminId: z.string() })
  .meta({ id: 'SuperAdminCreated' });
export const superAdminListSchema = z.object({ admins: z.array(superAdminRowSchema) }).meta({ id: 'SuperAdminList' });
export const invitePurposeSchema = z.object({ purpose: z.enum(['register', 'add_device', 'recovery']) });
export const countSchema = z.object({ count: z.number() }).meta({ id: 'SuperCount' });
export const adminPhoneSchema = z.object({ phone: z.string().nullable() }).meta({ id: 'SuperAdminPhone' });

/** A banner as responses carry it: the same short text in all four languages (02 §2 app_settings). */
export const bannerOutSchema = z.object({ en: z.string(), hi: z.string(), ur: z.string(), te: z.string() });
/** A banner as the Super Admin sets it: every language required, at most 300 characters each (02 §2). */
export const bannerSchema = z.strictObject({ en: text(300, 1), hi: text(300, 1), ur: text(300, 1), te: text(300, 1) });
export const BANNER_MAX = 300;

export const superSettingsSchema = z
  .object({
    globalHijriOffset: z.number(),
    defaultPushQuota: z.number(),
    supportWhatsapp: z.string().optional(),
    grievanceOfficer: z.object({ name: z.string(), email: z.string(), address: z.string(), city: z.string() }),
    undertakingVersion: z.string(),
    privacyVersion: z.string(),
    termsVersion: z.string(),
    /** The push kill switch (C10 ★, T4.7). */
    pushPaused: z.boolean(),
    /** Admin read-only mode (C10 ★, PHASE_08 T8.9): masjid admins' writes answer 503 `READ_ONLY_MODE`. */
    adminReadOnly: z.boolean(),
    /** Shown in both apps while set (T8.9). */
    maintenanceBanner: bannerOutSchema.optional(),
    /** Shown to every musalli while set — incidents (T8.9). */
    incidentBanner: bannerOutSchema.optional(),
    updatedAt: z.iso.datetime(),
  })
  .meta({ id: 'SuperSettings' });

/** `POST /settings/push-pause` ★ — pause or resume every notification (T4.7). */
export const pushPauseRequestSchema = z.strictObject({ paused: z.boolean() });
/** The answer: whether the switch moved. */
export const pushPauseResponseSchema = z.object({ paused: z.boolean(), changed: z.boolean() });
export type SuperSettings = z.infer<typeof superSettingsSchema>;

/** `POST /settings/read-only` ★ — turn admin read-only mode on or off (T8.9). */
export const readOnlyRequestSchema = z.strictObject({ readOnly: z.boolean() });
/** The answer: whether the switch moved. */
export const readOnlyResponseSchema = z.object({ readOnly: z.boolean(), changed: z.boolean() });

export const superSettingsPatchSchema = z.object({
  globalHijriOffset: hijriOffsetSchema.optional(),
  defaultPushQuota: z.int().min(0).max(50).optional(),
  supportWhatsapp: z
    .string()
    .regex(/^\+?[0-9]{8,15}$/)
    .nullable()
    .optional(),
  grievanceOfficer: z
    .strictObject({ name: text(120, 1), email: z.email().max(200), address: text(300, 1), city: text(80, 1) })
    .optional(),
  undertakingVersion: text(20, 1).optional(),
  privacyVersion: text(20, 1).optional(),
  termsVersion: text(20, 1).optional(),
  /** `null` takes the banner down (T8.9). */
  maintenanceBanner: bannerSchema.nullable().optional(),
  incidentBanner: bannerSchema.nullable().optional(),
});
export type SuperSettingsPatch = z.infer<typeof superSettingsPatchSchema>;

const count = z.int().min(0);
/** On time vs late for one kind of deadline over 30 days; `rate` = on time / all (null when there were none). */
const slaTallySchema = z.object({ onTime: count, late: count, rate: z.number().min(0).max(1).nullable() });

/**
 * `GET /stats` (07 C12, PHASE_08 T8.10): the newest hourly snapshot (`now`, null before the first run) and one point
 * per India day for the last 30 days (`trend`, oldest first). Aggregates only — never a device or follow.
 */
export const superStatsSchema = z
  .object({
    at: z.iso.datetime().nullable(),
    now: z
      .object({
        masjids: z.object({ pending: count, active: count, suspended: count, deleted: count }),
        devices: z.object({
          total: count,
          platform: z.object({ android: count, ios: count, desktop: count, other: count }),
          locale: z.object({ en: count, hi: count, ur: count, te: count }),
          push: z.object({ active: count, dead: count, none: count }),
        }),
        follows: count,
        push24h: z.object({
          jobs: count,
          sent: count,
          failed: count,
          successRate: z.number().min(0).max(1).nullable(),
        }),
        queues: z.object({ waiting: count, active: count, delayed: count, failed: count, lagS: count }).optional(),
        cloudinary: z
          .object({
            usedPercent: z.number().min(0),
            plan: z.string().optional(),
            credits: z.object({ usage: z.number().min(0), limit: z.number().min(0) }).optional(),
          })
          .optional(),
        sla: z.object({ reports: slaTallySchema, grievanceAck: slaTallySchema, grievanceResolve: slaTallySchema }),
      })
      .nullable(),
    trend: z.array(
      z.object({
        day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        activeMasjids: count,
        devices: count,
        follows: count,
        pushSent: count,
        pushFailed: count,
      }),
    ),
  })
  .meta({ id: 'SuperStats' });
export type SuperStats = z.infer<typeof superStatsSchema>;

/**
 * Every audit action (mirrors `AUDIT_ACTIONS` in @mc/db — a test in packages/api keeps them equal): the C11 filter
 * offers all of them, grouped by the part before the dot. Shown as written: these are log identifiers.
 */
export const AUDIT_ACTION_NAMES = [
  'adhkar.update',
  'admin.add_to_masjid',
  'admin.create',
  'admin.invite',
  'admin.phone_view',
  'admin.remove_from_masjid',
  'admin.undertaking_accept',
  'audio.upload',
  'audit.export',
  'auth.login',
  'auth.login_failed',
  'auth.logout',
  'auth.register',
  'auth.step_up',
  'beneficiary.close',
  'beneficiary.create',
  'beneficiary.delete',
  'beneficiary.private_view',
  'beneficiary.received',
  'beneficiary.update',
  'campaign.complete',
  'campaign.create',
  'campaign.received',
  'campaign.update',
  'chanda.save',
  'chanda.settings',
  'contact.create',
  'contact.delete',
  'contact.update',
  'credential.revoke',
  'grievance.ack',
  'grievance.contact',
  'grievance.resolve',
  'image.upload',
  'invite.consume',
  'item.autohide',
  'item.delete',
  'item.edit',
  'item.publish',
  'item.remove',
  'item.restore',
  'legal_order.create',
  'legal_order.document',
  'legal_order.document_read',
  'legal_order.update',
  'library.import',
  'library.retire',
  'library.update',
  'library.verify',
  'masjid.activate',
  'masjid.change_request',
  'masjid.create',
  'masjid.delete',
  'masjid.profile',
  'masjid.suspend',
  'masjid.unsuspend',
  'masjid.update',
  'payment.activate',
  'payment.approve',
  'payment.reject',
  'payment.request',
  'push.pause',
  'push.resume',
  'ramadan.update',
  'report.dismiss',
  'retention.run',
  'ruqyah.create',
  'ruqyah.delete',
  'ruqyah.order',
  'ruqyah.update',
  'session.revoke',
  'settings.read_only_off',
  'settings.read_only_on',
  'settings.update',
  'special.create',
  'special.delete',
  'special.update',
  'template.add_starters',
  'template.create',
  'template.update',
  'timings.update',
  'video.publish',
] as const;
export type AuditActionName = (typeof AUDIT_ACTION_NAMES)[number];

export const auditRowSchema = z
  .object({
    id: z.string(),
    at: z.iso.datetime(),
    actorType: z.enum(['admin', 'super_admin', 'system', 'device']),
    actorId: z.string().optional(),
    action: z.string(),
    masjidId: z.string().optional(),
    targetType: z.string().optional(),
    targetId: z.string().optional(),
    meta: z.record(z.string(), z.unknown()).optional(),
    requestId: z.string().optional(),
  })
  .meta({ id: 'SuperAuditRow' });
export type AuditRow = z.infer<typeof auditRowSchema>;

export const auditPageSchema = z
  .object({ entries: z.array(auditRowSchema), next: z.string().optional() })
  .meta({ id: 'SuperAuditPage' });

export const auditQuerySchema = z.object({
  actor: z.string().max(64).optional(),
  masjid: z.string().max(64).optional(),
  action: z
    .string()
    .regex(/^[a-z_]+\.[a-z_]+$/)
    .optional(),
  from: z.iso.datetime().optional(),
  to: z.iso.datetime().optional(),
  cursor: z.string().max(200).optional(),
});
export type AuditQuery = z.infer<typeof auditQuerySchema>;

export const superDashboardSchema = z
  .object({
    pending: z.array(superMasjidRowSchema),
    counts: z.object({ pending: z.number(), active: z.number(), suspended: z.number(), deleted: z.number() }),
    /** Passkeys revoked in the last 30 days because their sign counter went backwards (possible clone, 04 §3). */
    passkeyAlerts: z.number().int().min(0),
    /** Donation campaigns that are active and visible to followers now, across all masjids (C1 Stats, T5.6). */
    activeCampaigns: z.number().int().min(0),
    /** Push delivery over the last 24 hours and the kill switch (C1 Stats, T4.5 / T4.7). */
    push: z.object({
      jobs: z.number().int().min(0),
      running: z.number().int().min(0),
      failedJobs: z.number().int().min(0),
      sent: z.number().int().min(0),
      failed: z.number().int().min(0),
      pruned: z.number().int().min(0),
      successRate: z.number().min(0).max(1).nullable(),
      paused: z.boolean(),
    }),
    /** Open SLA timers, earliest due first (C1 "SLA alerts", PHASE_08 T8.3–T8.5). */
    sla: z.array(
      z.object({
        kind: z.enum(['urgent_report', 'report', 'grievance_ack', 'grievance_resolve', 'legal_order']),
        id: z.string(),
        startAt: z.string(),
        dueAt: z.string(),
      }),
    ),
    /** Admins' open "Request change" notes (B13, T3.10) — closed by the next edit of that masjid. */
    changeRequests: z.array(
      z.object({
        id: z.string(),
        masjidId: z.string(),
        masjidName: z.string(),
        note: z.string(),
        at: z.iso.datetime(),
      }),
    ),
  })
  .meta({ id: 'SuperDashboard' });
export type SuperDashboard = z.infer<typeof superDashboardSchema>;

export { inviteLinkSchema as superInviteSchema };

// --- Payment approvals (C4, 04 R1, PHASE_05 T5.2) ----------------------------------------------------------------------

export const superPaymentRowSchema = paymentRequestRowSchema
  .extend({
    masjid: z.object({ id: z.string(), name: z.string(), city: z.string() }),
    requestedBy: z.object({ id: z.string(), displayName: z.string() }),
    /** The details live now (old vs new side by side); `null` for a masjid's first UPI details. */
    current: livePaymentSchema.nullable(),
    /**
     * 07 C4 "history": the masjid's earlier details and refused requests, newest first (at most 5) — a masjid that
     * keeps changing its UPI ID, or was refused before, is worth a second look.
     */
    history: z.array(
      z.object({
        vpa: z.string(),
        payeeName: z.string(),
        status: z.enum(['superseded', 'rejected']),
        at: z.string(),
      }),
    ),
  })
  .meta({ id: 'SuperPaymentRow' });
export type SuperPaymentRow = z.infer<typeof superPaymentRowSchema>;

/** `GET /payments/pending`: open requests (pending, and on hold — which can still be stopped), oldest first. */
export const superPaymentListSchema = z
  .object({ requests: z.array(superPaymentRowSchema) })
  .meta({ id: 'SuperPaymentList' });
export type SuperPaymentList = z.infer<typeof superPaymentListSchema>;

/** `POST /payments/:id/approve` (★): when the details go live. */
export const paymentApprovedSchema = z.object({ effectiveAt: z.string() }).meta({ id: 'PaymentApproved' });

// --- Moderation (07 C5, 03 §5, PHASE_08 T8.2) -------------------------------------------------------------------
/** ★ Remove: the category the masjid sees and the Super Admin's private note. */
export const removeItemRequestSchema = z.strictObject({
  category: z.enum(MODERATION_CATEGORIES),
  note: safeText(MODERATION_NOTE_MAX, { multiline: true }).optional(),
  /** The legal order this takedown answers (T8.5) — logged on the order, which is then `actioned`. */
  legalOrderId: z.string().max(64).optional(),
});
export type RemoveItemRequest = z.input<typeof removeItemRequestSchema>;

/** Dismiss a report: an optional private note. */
export const dismissReportRequestSchema = z.strictObject({
  note: safeText(MODERATION_NOTE_MAX, { multiline: true }).optional(),
});

/** `POST /retention/dry-run` ★ (PHASE_08 T8.7): whether the worker's dry run was queued. */
export const retentionQueuedSchema = z.object({ queued: z.boolean() });
