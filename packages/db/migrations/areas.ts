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
};
