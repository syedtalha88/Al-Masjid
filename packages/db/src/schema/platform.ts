// 02 §2 "Library & templates", "Payments", "Devices & push", "Moderation, grievance, legal, audit", runner.
import { TEMPLATE_KEY_PATTERN } from './content.ts';
import { documentSchema, f, opt } from './dsl.ts';
import {
  ACTOR_TYPE,
  ANNOUNCEMENT_CATEGORY,
  AUDIENCE,
  AUDIENCE_PREF,
  DUA_CATEGORY,
  GRIEVANCE_CATEGORY,
  GRIEVANCE_STATUS,
  JOB_STATUS,
  LEGAL_ORDER_STATUS,
  LIBRARY_KIND,
  LIBRARY_STATUS,
  LOCALE,
  PAYMENT_STATUS,
  PLATFORM,
  PUSH_STATUS,
  REPORT_REASON,
  REPORT_STATUS,
  REPORT_TARGET,
  TEMPLATE_PARAM_TYPE,
  TEMPLATE_STATUS,
} from './enums.ts';
import { ENCRYPTED_PATTERN } from './masjids.ts';
import type { CollectionSpec } from './types.ts';

/** UPI VPA (02 §2 payment_profiles). */
export const VPA_PATTERN = '^[a-zA-Z0-9.\\-_]{2,256}@[a-zA-Z][a-zA-Z0-9.\\-]{1,64}$';
export const HTTPS_PATTERN = '^https://';
export const AUDIT_ACTION_PATTERN = '^[a-z_]+(\\.[a-z_]+)+$';
const MAX_SAFE = Number.MAX_SAFE_INTEGER;
const timestamps = { created_at: f.instant(), updated_at: f.instant() };
const all4 = (max: number) => f.i18n(max, ['en', 'hi', 'ur', 'te']);

const contentLibrary = documentSchema({
  _id: f.uuid(),
  kind: f.enum(LIBRARY_KIND),
  arabic: f.string(4000),
  transliteration: f.i18n(4000),
  translation: f.i18n(4000, ['en']),
  reference: f.string(200, { minLength: 1 }),
  source_name: f.string(120),
  source_license: f.string(200),
  tags: f.array(f.string(40), { max: 20 }),
  dua_category: opt(f.enum(DUA_CATEGORY)),
  verified_by: opt(f.string(120)),
  verified_at: opt(f.instant()),
  status: f.enum(LIBRARY_STATUS),
  import_batch_id: f.uuid(),
  search_text: f.string(20_000),
  ...timestamps,
});

const noticeTemplates = documentSchema({
  _id: f.string(64, { pattern: TEMPLATE_KEY_PATTERN }),
  category: f.enum(ANNOUNCEMENT_CATEGORY),
  icon: f.string(40),
  is_important_default: f.bool(),
  title: all4(120),
  body: all4(1500),
  params: f.array(
    f.object({
      name: f.string(40, { pattern: '^[a-z][a-zA-Z0-9_]*$' }),
      type: f.enum(TEMPLATE_PARAM_TYPE),
      required: f.bool(),
    }),
    { max: 10 },
  ),
  status: f.enum(TEMPLATE_STATUS),
  translation_reviewed: f.bool(),
  system: f.bool(),
  ...timestamps,
});

const paymentProfiles = documentSchema({
  _id: f.uuid(),
  masjid_id: f.uuid(),
  vpa: f.string(100, { pattern: VPA_PATTERN }),
  payee_name: f.string(100, { minLength: 1 }),
  status: f.enum(PAYMENT_STATUS),
  open: f.bool(),
  requested_by: f.uuid(),
  request_note: opt(f.string(300)),
  reviewed_by: opt(f.uuid()),
  reviewed_at: opt(f.instant()),
  effective_at: opt(f.instant()),
  reject_reason: opt(f.string(300)),
  masjid_visible: f.bool(),
  ...timestamps,
});

const devices = documentSchema({
  _id: f.uuid(),
  secret_hash: f.bytes(32),
  locale: f.enum(LOCALE),
  audience_pref: f.enum(AUDIENCE_PREF),
  platform: f.enum(PLATFORM),
  push_endpoint: opt(f.string(1000, { pattern: HTTPS_PATTERN })),
  push_p256dh: opt(f.string(200)),
  push_auth: opt(f.string(100)),
  push_status: f.enum(PUSH_STATUS),
  push_updated_at: opt(f.instant()),
  privacy_version: f.string(20),
  follow_count: f.int(0, 20),
  created_at: f.instant(),
  last_seen_at: f.instant(),
});

const deviceFollows = documentSchema({
  _id: f.uuid(),
  device_id: f.uuid(),
  masjid_id: f.uuid(),
  muted: f.bool(),
  audience_pref: f.enum(AUDIENCE_PREF),
  locale: f.enum(LOCALE),
  push_active: f.bool(),
  created_at: f.instant(),
});

const adminPushSubscriptions = documentSchema({
  _id: f.uuid(),
  admin_id: f.uuid(),
  endpoint: f.string(1000, { pattern: HTTPS_PATTERN }),
  p256dh: f.string(200),
  auth: f.string(100),
  created_at: f.instant(),
  last_ok_at: opt(f.instant()),
});

const count = () => f.int(0, 2_000_000_000);
const notificationJobs = documentSchema({
  _id: f.uuid(),
  item_id: f.uuid(),
  masjid_id: f.uuid(),
  status: f.enum(JOB_STATUS),
  audience: f.enum(AUDIENCE),
  audience_targets: f.array(f.enum(AUDIENCE_PREF), { max: 2, unique: true }),
  targeted: count(),
  sent: count(),
  failed: count(),
  pruned: count(),
  pending_batches: count(),
  bypass_quota: f.bool(),
  created_at: f.instant(),
  started_at: opt(f.instant()),
  last_progress_at: opt(f.instant()),
  completed_at: opt(f.instant()),
  last_error: opt(f.string(500)),
});

const pushQuotaUsage = documentSchema({
  _id: f.string(64, { pattern: '^[0-9a-f-]{36}:\\d{4}-\\d{2}-\\d{2}$' }),
  masjid_id: f.uuid(),
  day: f.date(),
  count: f.int(0, 1000),
});

const reports = documentSchema({
  _id: f.uuid(),
  target_type: f.enum(REPORT_TARGET),
  target_id: f.uuid(),
  masjid_id: f.uuid(),
  reason: f.enum(REPORT_REASON),
  details: opt(f.string(500)),
  device_id: opt(f.uuid()),
  urgent: f.bool(),
  status: f.enum(REPORT_STATUS),
  sla_due_at: f.instant(),
  actioned_by: opt(f.uuid()),
  actioned_at: opt(f.instant()),
  resolution_note: opt(f.string(500)),
  created_at: f.instant(),
  closed_at: opt(f.instant()),
});

const grievances = documentSchema({
  _id: f.uuid(),
  public_ref: f.string(16, { pattern: '^GR-\\d{4}-\\d{6}$' }),
  category: f.enum(GRIEVANCE_CATEGORY),
  description: f.string(2000, { minLength: 1 }),
  contact_enc: opt(f.string(1200, { pattern: ENCRYPTED_PATTERN })),
  status: f.enum(GRIEVANCE_STATUS),
  ack_due_at: f.instant(),
  resolve_due_at: f.instant(),
  acknowledged_at: opt(f.instant()),
  resolved_at: opt(f.instant()),
  resolution: opt(f.string(2000)),
  handled_by: opt(f.uuid()),
  created_at: f.instant(),
});

const grievanceSeq = documentSchema({ _id: f.string(4, { pattern: '^\\d{4}$' }), seq: f.long(0, MAX_SAFE) });

const legalOrders = documentSchema({
  _id: f.uuid(),
  authority: f.string(200),
  reference_no: f.string(120),
  received_at: f.instant(),
  due_at: f.instant(),
  target_type: f.string(40),
  target_id: f.string(64),
  summary: f.string(2000),
  action_taken: opt(f.string(2000)),
  action_log: f.array(f.object({ at: f.instant(), by: f.uuid(), note: f.string(500) }), { max: 200 }),
  status: f.enum(LEGAL_ORDER_STATUS),
  document_key: opt(f.string(200)),
  handled_by: opt(f.uuid()),
  ...timestamps,
});

const auditLog = documentSchema({
  _id: f.objectId(),
  at: f.instant(),
  actor_type: f.enum(ACTOR_TYPE),
  actor_id: opt(f.uuid()),
  action: f.string(80, { pattern: AUDIT_ACTION_PATTERN }),
  masjid_id: opt(f.uuid()),
  target_type: opt(f.string(40)),
  target_id: opt(f.string(64)),
  meta: opt(f.anyObject()),
  request_id: opt(f.string(64)),
});

const appSettings = documentSchema({
  _id: f.enum(['global']),
  global_hijri_offset: f.int(-2, 2),
  maintenance_banner: opt(all4(300)),
  incident_banner: opt(all4(300)),
  default_push_quota: f.int(0, 50),
  undertaking_version: f.string(20),
  privacy_version: f.string(20),
  terms_version: f.string(20),
  push_paused: f.bool(),
  admin_read_only: f.bool(),
  report_autohide_threshold: f.int(1, 1000),
  grievance_officer: f.object({
    name: f.string(120),
    email: f.string(200),
    address: f.string(300),
    city: f.string(80),
  }),
  support_whatsapp: opt(f.string(16, { pattern: '^\\+?[0-9]{8,15}$' })),
  min_client_version: f.string(32),
  updated_by: opt(f.uuid()),
  updated_at: f.instant(),
});

const statsSnapshots = documentSchema({
  _id: f.string(13, { pattern: '^\\d{4}-\\d{2}-\\d{2}T\\d{2}$' }),
  counts: f.anyObject(),
  created_at: f.instant(),
});

// The runner's own bookkeeping (02 §2 _migrations): applied migrations + the lock document `_id: "__lock"`.
const migrations = documentSchema({
  _id: f.string(120, { pattern: '^(__lock|\\d{4}_[a-z0-9_]+)$' }),
  checksum: opt(f.string(64, { pattern: '^[0-9a-f]{64}$' })),
  applied_at: opt(f.instant()),
  duration_ms: opt(f.int(0, 86_400_000)),
  locked_until: opt(f.instant()),
  owner: opt(f.string(64)),
});

export const PLATFORM_COLLECTIONS: readonly CollectionSpec[] = [
  {
    name: 'content_library',
    ...contentLibrary,
    indexes: [
      { name: 'kind_reference_unique', key: { kind: 1, reference: 1 }, unique: true },
      { name: 'status_kind_category', key: { status: 1, kind: 1, dua_category: 1 } },
      { name: 'search_text', key: { search_text: 'text' }, default_language: 'none' },
    ],
  },
  { name: 'notice_templates', ...noticeTemplates, indexes: [] },
  {
    name: 'payment_profiles',
    ...paymentProfiles,
    indexes: [
      {
        name: 'one_active_per_masjid',
        key: { masjid_id: 1 },
        unique: true,
        partialFilterExpression: { status: 'active' },
      },
      {
        name: 'one_open_per_masjid',
        key: { masjid_id: 1, open: 1 },
        unique: true,
        partialFilterExpression: { open: true },
      },
      { name: 'status_effective', key: { status: 1, effective_at: 1 } },
    ],
  },
  {
    name: 'devices',
    ...devices,
    indexes: [
      {
        name: 'push_endpoint_unique',
        key: { push_endpoint: 1 },
        unique: true,
        partialFilterExpression: { push_endpoint: { $type: 'string' } },
      },
      { name: 'last_seen', key: { last_seen_at: 1 } },
      { name: 'push_status_updated', key: { push_status: 1, push_updated_at: 1 } },
    ],
  },
  {
    name: 'device_follows',
    ...deviceFollows,
    indexes: [
      { name: 'device_masjid_unique', key: { device_id: 1, masjid_id: 1 }, unique: true },
      { name: 'fanout', key: { masjid_id: 1, muted: 1, push_active: 1, audience_pref: 1, device_id: 1 } },
    ],
  },
  {
    name: 'admin_push_subscriptions',
    ...adminPushSubscriptions,
    indexes: [
      { name: 'endpoint_unique', key: { endpoint: 1 }, unique: true },
      { name: 'admin', key: { admin_id: 1 } },
    ],
  },
  {
    name: 'notification_jobs',
    ...notificationJobs,
    indexes: [
      { name: 'status_created', key: { status: 1, created_at: 1 } },
      { name: 'masjid_created', key: { masjid_id: 1, created_at: -1 } },
      { name: 'item', key: { item_id: 1 } },
    ],
  },
  { name: 'push_quota_usage', ...pushQuotaUsage, indexes: [] },
  {
    name: 'reports',
    ...reports,
    indexes: [
      { name: 'status_sla', key: { status: 1, sla_due_at: 1 } },
      { name: 'target_created', key: { target_id: 1, created_at: -1 } },
      { name: 'masjid_created', key: { masjid_id: 1, created_at: -1 } },
      { name: 'device', key: { device_id: 1 }, partialFilterExpression: { device_id: { $exists: true } } },
    ],
  },
  {
    name: 'grievances',
    ...grievances,
    indexes: [
      { name: 'public_ref_unique', key: { public_ref: 1 }, unique: true },
      { name: 'status_ack_due', key: { status: 1, ack_due_at: 1 } },
    ],
  },
  { name: 'grievance_seq', ...grievanceSeq, indexes: [] },
  { name: 'legal_orders', ...legalOrders, indexes: [{ name: 'status_due', key: { status: 1, due_at: 1 } }] },
  {
    name: 'audit_log',
    ...auditLog,
    indexes: [
      { name: 'at', key: { at: -1 } },
      { name: 'masjid_at', key: { masjid_id: 1, at: -1 } },
      { name: 'actor_at', key: { actor_id: 1, at: -1 } },
      { name: 'action_at', key: { action: 1, at: -1 } },
    ],
  },
  { name: 'app_settings', ...appSettings, indexes: [] },
  { name: 'stats_snapshots', ...statsSnapshots, indexes: [] },
  { name: '_migrations', ...migrations, indexes: [] },
];
