// MongoDB users & privileges (02 §4.3, DECISIONS #7, #20 layer 3) — the single source for the local applier
// (`createRole`/`createUser`, `pnpm db:reset`) and the Atlas applier (Admin API; generated JSON for the VPS). Each
// process connects as its own user; the database itself refuses everything a user's row in 02 §4.3 does not grant.
import { ADMIN_VIEWS, type CollectionName, type Namespace, PUBLIC_VIEWS } from './collections.ts';

export const DB_USERS = ['mc_public', 'mc_admin', 'mc_system', 'mc_migrator'] as const;
export type DbUser = (typeof DB_USERS)[number];

/** CRUD actions on a collection or view. */
export const CRUD = ['find', 'insert', 'update', 'remove'] as const;
export type CrudAction = (typeof CRUD)[number];

/** Schema actions — only the migrator has them. */
export const SCHEMA_ACTIONS = [
  'createCollection',
  'dropCollection',
  'collMod',
  'createIndex',
  'dropIndex',
  'listIndexes',
] as const;
export type SchemaAction = (typeof SCHEMA_ACTIONS)[number];
export type Action = CrudAction | SchemaAction | 'listCollections';

export interface Privilege {
  /** A collection or view; `null` = the whole database (database-level actions such as `listCollections`). */
  readonly namespace: Namespace | null;
  readonly actions: readonly Action[];
}

const ALL_CRUD: readonly CrudAction[] = CRUD;
const FIU: readonly CrudAction[] = ['find', 'insert', 'update'];

/** Content and admin collections the admin API writes (02 §4.3 row 3). */
const ADMIN_WRITABLE: readonly CollectionName[] = [
  'masjids',
  'masjid_timings',
  'special_timings',
  'items',
  'chanda_weeks',
  'content_library',
  'notice_templates',
  'payment_profiles',
  'admin_users',
  'masjid_admins',
  'webauthn_credentials',
  'admin_invites',
  'admin_sessions',
  'admin_push_subscriptions',
  'notification_jobs',
  'push_quota_usage',
  'legal_orders',
  'app_settings',
];

/** Collections only the worker/system user touches beyond the rows above (02 §4.3 "all"). */
const SYSTEM_ALL: readonly CollectionName[] = [
  'reports',
  'grievances',
  'grievance_seq',
  'devices',
  'device_follows',
  'ameens',
  'ameen_counters',
  'masjid_stats',
  'stats_snapshots',
];

const grant = (namespaces: readonly Namespace[], actions: readonly Action[]): Privilege[] =>
  namespaces.map((namespace) => ({ namespace, actions }));

const ROLES: Readonly<Record<DbUser, readonly Privilege[]>> = {
  // api-public: public views only, device-owned collections, and insert-only reports/grievances/audit (02 §4.3).
  mc_public: [
    ...grant(PUBLIC_VIEWS, ['find']),
    { namespace: 'audit_log', actions: ['insert'] },
    { namespace: 'reports', actions: ['insert'] },
    { namespace: 'grievances', actions: ['insert'] },
    { namespace: 'grievance_seq', actions: FIU },
    { namespace: 'devices', actions: ALL_CRUD },
    { namespace: 'device_follows', actions: ALL_CRUD },
    { namespace: 'ameens', actions: ['insert', 'remove'] },
    { namespace: 'ameen_counters', actions: FIU },
    { namespace: 'masjid_stats', actions: ['insert', 'update'] },
  ],
  // api-admin: content/admin collections; append-only history/audit; never devices, follows or ameens.
  mc_admin: [
    ...grant(PUBLIC_VIEWS, ['find']),
    ...grant(ADMIN_VIEWS, ['find']),
    ...ADMIN_WRITABLE.map((namespace) => ({
      namespace,
      actions: namespace === 'masjid_admins' || namespace === 'admin_push_subscriptions' ? ALL_CRUD : FIU,
    })),
    { namespace: 'campaign_amount_history', actions: ['find', 'insert'] },
    { namespace: 'audit_log', actions: ['find', 'insert'] },
    { namespace: 'reports', actions: ['find', 'update'] },
    { namespace: 'grievances', actions: ['find', 'update'] },
    { namespace: 'ameen_counters', actions: ['find'] },
    { namespace: 'masjid_stats', actions: ['find'] },
    { namespace: 'stats_snapshots', actions: ['find'] },
  ],
  // worker + one-off scripts: everything incl. purge; still no schema changes and no _migrations.
  mc_system: [
    ...grant(PUBLIC_VIEWS, ['find']),
    ...grant(ADMIN_VIEWS, ['find']),
    ...grant(ADMIN_WRITABLE, ALL_CRUD),
    ...grant(SYSTEM_ALL, ALL_CRUD),
    { namespace: 'campaign_amount_history', actions: ['find', 'insert', 'remove'] },
    { namespace: 'audit_log', actions: ['find', 'insert', 'remove'] },
  ],
  // migrations only: schema on every namespace + the runner's own collection; seeds app_settings (02 §2).
  mc_migrator: [
    { namespace: null, actions: ['listCollections'] },
    ...grant(
      [...ADMIN_WRITABLE, ...SYSTEM_ALL, 'campaign_amount_history', 'audit_log', ...PUBLIC_VIEWS, ...ADMIN_VIEWS],
      SCHEMA_ACTIONS,
    ),
    { namespace: '_migrations', actions: [...ALL_CRUD, ...SCHEMA_ACTIONS] },
    { namespace: 'app_settings', actions: [...FIU, ...SCHEMA_ACTIONS] },
  ],
};

/**
 * The privileges of one database user (02 §4.3), merged so each namespace appears once.
 *
 * @param user - one of {@link DB_USERS}.
 * @returns privileges in a stable order; a namespace not listed is denied entirely.
 */
export function rolePrivileges(user: DbUser): readonly Privilege[] {
  const merged = new Map<Namespace | null, Set<Action>>();
  for (const { namespace, actions } of ROLES[user]) {
    const set = merged.get(namespace) ?? new Set<Action>();
    for (const action of actions) set.add(action);
    merged.set(namespace, set);
  }
  return [...merged].map(([namespace, actions]) => ({ namespace, actions: [...actions].sort() }));
}

/**
 * Whether `user` may perform `action` on `namespace` according to 02 §4.3.
 *
 * @returns true only when a privilege grants exactly that action on that namespace.
 */
export function isAllowed(user: DbUser, namespace: Namespace, action: Action): boolean {
  return rolePrivileges(user).some((p) => p.namespace === namespace && p.actions.includes(action));
}

/** The custom role name for a login in one database (users/roles live in `admin`; privileges target `database`). */
export function roleName(login: string, database: string): string {
  return `${login}__${database}`;
}
