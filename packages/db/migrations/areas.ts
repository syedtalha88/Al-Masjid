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
};
