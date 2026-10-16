// 02 §2 "Masjids & admins": masjids, masjid_stats, admin_users, masjid_admins, webauthn_credentials, admin_invites,
// admin_sessions.
import { documentSchema, f, opt } from './dsl.ts';
import {
  ADMIN_ROLE,
  ADMIN_STATUS,
  ASR_MADHAB,
  CALC_METHOD,
  INVITE_PURPOSE,
  LOCALE,
  MASJID_ADMIN_ROLE,
  MASJID_STATUS,
} from './enums.ts';
import type { CollectionSpec } from './types.ts';

/** Crockford Base32, 8 characters (no I, L, O, U) — 02 §3 `genFollowCode()`. */
export const FOLLOW_CODE_PATTERN = '^[0-9A-HJKMNP-TV-Z]{8}$';
/** `v1:<keyId>:<iv>:<ct+tag>` — app-level AES-256-GCM (02 §2 admin_users, T1.7). */
export const ENCRYPTED_PATTERN = '^v1:[A-Za-z0-9_-]{1,32}:[A-Za-z0-9_-]{16}:[A-Za-z0-9_-]{22,}$';
/** India bounding box (02 §2 masjids). */
export const INDIA = { lat: [6, 37.5], lng: [68, 97.5] } as const;

const MAX_SAFE = Number.MAX_SAFE_INTEGER;
const timestamps = { created_at: f.instant(), updated_at: f.instant() };

const masjids = documentSchema({
  _id: f.uuid(),
  follow_code: f.string(8, { pattern: FOLLOW_CODE_PATTERN }),
  name: f.string(120, { minLength: 1 }),
  name_i18n: f.object({ hi: opt(f.string(120)), ur: opt(f.string(120)), te: opt(f.string(120)) }),
  area: f.string(80),
  city: f.string(80, { minLength: 1 }),
  state: f.string(80, { minLength: 1 }),
  address: f.string(300),
  lat: f.degrees(INDIA.lat[0], INDIA.lat[1]),
  lng: f.degrees(INDIA.lng[0], INDIA.lng[1]),
  photo_key: opt(f.string(200)),
  photo_thumbhash: opt(f.string(64)),
  status: f.enum(MASJID_STATUS),
  verified_at: opt(f.instant()),
  calc_method: f.enum(CALC_METHOD),
  asr_madhab: f.enum(ASR_MADHAB),
  hijri_offset: opt(f.int(-2, 2)),
  show_chanda: f.bool(),
  chanda_week_start: f.int(1, 7),
  ramadan_start: opt(f.date()),
  ramadan_end: opt(f.date()),
  sehri_precaution_min: f.int(0, 15),
  iftar_precaution_min: f.int(0, 10),
  push_daily_quota: f.int(0, 50),
  content_version: f.long(1, MAX_SAFE),
  admin_count: f.int(0, 5),
  removals_90d_cache: opt(f.int(0, 10_000)),
  ...timestamps,
  deleted_at: opt(f.instant()),
});

const masjidStats = documentSchema({
  _id: f.uuid(),
  followers: f.int(0, 2_000_000_000),
  ameens_7d: f.int(0, 2_000_000_000),
  updated_at: f.instant(),
});

const adminUsers = documentSchema({
  _id: f.uuid(),
  display_name: f.string(80, { minLength: 1 }),
  role: f.enum(ADMIN_ROLE),
  status: f.enum(ADMIN_STATUS),
  phone_enc: opt(f.string(400, { pattern: ENCRYPTED_PATTERN })),
  ui_locale: f.enum(LOCALE),
  user_handle: f.bytes(32),
  undertaking_version: opt(f.string(20)),
  undertaking_accepted_at: opt(f.instant()),
  undertaking_history: f.array(f.object({ version: f.string(20), accepted_at: f.instant() }), { max: 50 }),
  last_login_at: opt(f.instant()),
  removed_at: opt(f.instant()),
  ...timestamps,
});

const masjidAdmins = documentSchema({
  _id: f.uuid(),
  masjid_id: f.uuid(),
  admin_id: f.uuid(),
  role: f.enum(MASJID_ADMIN_ROLE),
  added_by: f.uuid(),
  created_at: f.instant(),
});

const webauthnCredentials = documentSchema({
  _id: f.uuid(),
  admin_id: f.uuid(),
  credential_id: f.bytes(),
  public_key: f.bytes(),
  sign_count: f.long(0, 4_294_967_295),
  transports: f.array(f.string(20), { max: 10 }),
  aaguid: opt(f.uuid()),
  backed_up: f.bool(),
  device_type: f.string(32),
  label: f.string(60),
  created_at: f.instant(),
  last_used_at: opt(f.instant()),
  revoked_at: opt(f.instant()),
});

const adminInvites = documentSchema({
  _id: f.uuid(),
  admin_id: f.uuid(),
  purpose: f.enum(INVITE_PURPOSE),
  token_hash: f.bytes(32),
  expires_at: f.instant(),
  used_at: opt(f.instant()),
  open: f.bool(),
  created_by: f.uuid(),
  created_at: f.instant(),
});

const adminSessions = documentSchema({
  _id: f.uuid(),
  admin_id: f.uuid(),
  token_hash: f.bytes(32),
  created_at: f.instant(),
  last_seen_at: f.instant(),
  idle_expires_at: f.instant(),
  absolute_expires_at: f.instant(),
  step_up_at: opt(f.instant()),
  ua_summary: opt(f.string(120)),
  revoked_at: opt(f.instant()),
  revoked_reason: opt(f.string(80)),
});

export const MASJID_COLLECTIONS: readonly CollectionSpec[] = [
  {
    name: 'masjids',
    ...masjids,
    indexes: [
      { name: 'follow_code_unique', key: { follow_code: 1 }, unique: true },
      { name: 'status_created', key: { status: 1, created_at: -1 } },
      { name: 'name', key: { name: 1 } },
      { name: 'city', key: { city: 1 } },
    ],
  },
  { name: 'masjid_stats', ...masjidStats, indexes: [] },
  {
    name: 'admin_users',
    ...adminUsers,
    indexes: [
      { name: 'role_status', key: { role: 1, status: 1 } },
      { name: 'user_handle_unique', key: { user_handle: 1 }, unique: true },
    ],
  },
  {
    name: 'masjid_admins',
    ...masjidAdmins,
    indexes: [
      { name: 'masjid_admin_unique', key: { masjid_id: 1, admin_id: 1 }, unique: true },
      { name: 'admin', key: { admin_id: 1 } },
    ],
  },
  {
    name: 'webauthn_credentials',
    ...webauthnCredentials,
    indexes: [
      { name: 'credential_id_unique', key: { credential_id: 1 }, unique: true },
      { name: 'admin', key: { admin_id: 1 } },
    ],
  },
  {
    name: 'admin_invites',
    ...adminInvites,
    indexes: [
      { name: 'token_hash_unique', key: { token_hash: 1 }, unique: true },
      // One open invite per (admin, purpose): a new invite closes the previous one in the same transaction.
      {
        name: 'open_invite_unique',
        key: { admin_id: 1, purpose: 1 },
        unique: true,
        partialFilterExpression: { open: true },
      },
    ],
  },
  {
    name: 'admin_sessions',
    ...adminSessions,
    indexes: [
      { name: 'token_hash_unique', key: { token_hash: 1 }, unique: true },
      { name: 'admin_revoked', key: { admin_id: 1, revoked_at: 1 } },
      { name: 'absolute_expires', key: { absolute_expires_at: 1 } },
    ],
  },
];
