import { z } from 'zod';

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
      nameI18n: nameI18nSchema,
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

export const superSettingsSchema = z
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
export type SuperSettings = z.infer<typeof superSettingsSchema>;

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
});
export type SuperSettingsPatch = z.infer<typeof superSettingsPatchSchema>;

export const auditRowSchema = z
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
  })
  .meta({ id: 'SuperDashboard' });
export type SuperDashboard = z.infer<typeof superDashboardSchema>;

export { inviteLinkSchema as superInviteSchema };
