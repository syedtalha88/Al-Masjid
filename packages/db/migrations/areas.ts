// Which collections/views each schema migration covers (02 §2 areas; PHASE_01 T1.2 "one migration per logical area").
// Used once by `pnpm db:migration:snapshot <id>` to freeze a NEW migration's snapshot; never changes for applied ids.
import type { CollectionName, ViewName } from '../src/collections.ts';
import { ADMIN_VIEWS, PUBLIC_VIEWS } from '../src/collections.ts';

export const SCHEMA_AREAS: Readonly<
  Record<string, { collections: readonly CollectionName[]; views?: readonly ViewName[] }>
> = {
  '0001_masjids_admins': {
    collections: [
      'masjids',
      'masjid_stats',
      'admin_users',
      'masjid_admins',
      'webauthn_credentials',
      'admin_invites',
      'admin_sessions',
    ],
  },
  '0002_timings_content': {
    collections: [
      'masjid_timings',
      'special_timings',
      'items',
      'ameens',
      'ameen_counters',
      'campaign_amount_history',
      'chanda_weeks',
    ],
  },
  '0003_library_payments': { collections: ['content_library', 'notice_templates', 'payment_profiles'] },
  '0004_devices_push': {
    collections: ['devices', 'device_follows', 'admin_push_subscriptions', 'notification_jobs', 'push_quota_usage'],
  },
  '0005_moderation_audit': {
    collections: [
      'reports',
      'grievances',
      'grievance_seq',
      'legal_orders',
      'audit_log',
      'app_settings',
      'stats_snapshots',
      '_migrations',
    ],
  },
  '0006_views': { collections: [], views: [...PUBLIC_VIEWS, ...ADMIN_VIEWS] },
  // PHASE_02 T2.2: feed and special-date order inside the views (index-backed pages).
  '0008_view_order': { collections: [], views: ['v_pub_items', 'v_pub_special_timings'] },
  // PHASE_03 T3.4 (DECISIONS #104): library kind `dhikr` (+ repeat, occasions); template param type `phone`.
  '0009_library_dhikr': { collections: ['content_library', 'notice_templates'], views: ['v_pub_library'] },
  // PHASE_03 T3.5 (DECISIONS #111): template status `draft` — unreviewed templates are never active.
  '0010_template_draft': { collections: ['notice_templates'], views: ['v_pub_templates'] },
  // PHASE_03 T3.13 (DECISIONS #104): `voice` on announcement / daily_content / dua_request, always with a title.
  '0011_item_voice': { collections: ['items'] },
  // PHASE_03 T3.14 (DECISIONS #104): the masjid's "Adhkar after salah" set, public through v_pub_masjids.
  '0012_masjid_adhkar': { collections: ['masjids'], views: ['v_pub_masjids'] },
  // PHASE_03 T3.15 (DECISIONS #104): the masjid's Ruqyah section — library, text or audio entries.
  '0013_ruqyah': { collections: ['ruqyah_entries'], views: ['v_pub_ruqyah'] },
  // PHASE_03 T3.16 (DECISIONS #104): Ilm contacts — volunteers listed with their consent, in the bundle.
  '0014_contacts': { collections: ['masjid_contacts'], views: ['v_pub_contacts'] },
  // DECISIONS #135 (security review L4): `v_pub_ruqyah` lists its public fields instead of hiding the private ones.
  '0015_ruqyah_view': { collections: [], views: ['v_pub_ruqyah'] },
  // PHASE_04 T4.4 (DECISIONS #138): resumable fan-out progress on the outbox, the stuck-job index.
  '0016_push_fanout': { collections: ['notification_jobs'] },
  // PHASE_04 T4.9 (DECISIONS #140): `pending_batches` is a balance that may dip below 0 for a moment.
  '0017_push_batch_balance': { collections: ['notification_jobs'] },
  // PHASE_05 T5.5 (DECISIONS #152): a chanda update carries its week's figures and visibility; hidden ones never public.
  '0018_chanda_items': { collections: ['items'], views: ['v_pub_items'] },
  // PHASE_05 T5.8 (DECISIONS #104, #156): needy people, their append-only amount history and the public view.
  '0019_beneficiaries': {
    collections: ['beneficiaries', 'beneficiary_amount_history'],
    views: ['v_pub_beneficiaries'],
  },
  // F65 (DECISIONS #159): an admin alert subscription belongs to the session that saved it (`session_id`, indexed).
  '0020_admin_push_session': { collections: ['admin_push_subscriptions'] },
  // DECISIONS #160 (security review M3, L6): a needy person's UPI old → new record moves into their purged history;
  // the chanda filter of v_pub_items fails closed.
  '0021_beneficiary_upi_history': { collections: ['beneficiary_amount_history'], views: ['v_pub_items'] },
  // DECISIONS #161 (F69): a UPI request records the session that asked (`requested_session`) and, when closed because
  // its admin lost access, says so (`reject_code`).
  '0022_payment_reject_code': { collections: ['payment_profiles'] },
};
