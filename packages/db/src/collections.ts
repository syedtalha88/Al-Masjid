// Every collection and view of the database (02 §2, §4.2). The single list that roles, migrations, policy cells and
// tests enumerate — a name missing here cannot get privileges, validators or policy cells.

/** Collections (02 §2), including those first used by later phases, so roles and the policy matrix are complete. */
export const COLLECTIONS = [
  // masjids & admins
  'masjids',
  'masjid_stats',
  'admin_users',
  'masjid_admins',
  'webauthn_credentials',
  'admin_invites',
  'admin_sessions',
  // timings
  'masjid_timings',
  'special_timings',
  // content
  'items',
  'ameens',
  'ameen_counters',
  'campaign_amount_history',
  'chanda_weeks',
  // library & templates
  'content_library',
  'notice_templates',
  // payments
  'payment_profiles',
  // devices & push
  'devices',
  'device_follows',
  'admin_push_subscriptions',
  'notification_jobs',
  'push_quota_usage',
  // moderation, grievance, legal, audit
  'reports',
  'grievances',
  'grievance_seq',
  'legal_orders',
  'audit_log',
  'app_settings',
  'stats_snapshots',
  // migration runner
  '_migrations',
] as const;

/** Read-only views for the public API (02 §4.2): pre-filtered, private fields removed. */
export const PUBLIC_VIEWS = [
  'v_pub_masjids',
  'v_pub_masjid_status',
  'v_pub_timings',
  'v_pub_special_timings',
  'v_pub_items',
  'v_pub_chanda_weeks',
  'v_pub_payment_profiles',
  'v_pub_library',
  'v_pub_templates',
  'v_pub_settings',
] as const;

/** Views for admin reads that must never expose device ids (02 §4.2). */
export const ADMIN_VIEWS = ['v_admin_follow_audience'] as const;

export type CollectionName = (typeof COLLECTIONS)[number];
export type ViewName = (typeof PUBLIC_VIEWS)[number] | (typeof ADMIN_VIEWS)[number];
export type Namespace = CollectionName | ViewName;

/**
 * Collections whose writes change what musallis see (02 §5 "Version bump"): every non-system write goes through
 * `contentWrite()`, which bumps the masjid's `content_version` in the same transaction (enforced by the gateway).
 * `masjids` counts for updates of its own fields; its insert is `createMasjid` (version 1).
 */
export const CONTENT_COLLECTIONS: readonly CollectionName[] = [
  'masjids',
  'items',
  'masjid_timings',
  'special_timings',
  'chanda_weeks',
  'payment_profiles',
];

/** Every namespace (collections + views), in a stable order. */
export const NAMESPACES: readonly Namespace[] = [...COLLECTIONS, ...PUBLIC_VIEWS, ...ADMIN_VIEWS];

/** The collection each view reads (02 §4.2) — migrations build the pipelines; tests use the mapping as is. */
export const VIEW_SOURCES: Readonly<Record<ViewName, CollectionName>> = {
  v_pub_masjids: 'masjids',
  v_pub_masjid_status: 'masjids',
  v_pub_timings: 'masjid_timings',
  v_pub_special_timings: 'special_timings',
  v_pub_items: 'items',
  v_pub_chanda_weeks: 'chanda_weeks',
  v_pub_payment_profiles: 'payment_profiles',
  v_pub_library: 'content_library',
  v_pub_templates: 'notice_templates',
  v_pub_settings: 'app_settings',
  v_admin_follow_audience: 'device_follows',
};
