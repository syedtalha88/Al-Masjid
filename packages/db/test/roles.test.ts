import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { COLLECTIONS, type Namespace, NAMESPACES, PUBLIC_VIEWS } from '../src/collections.ts';
import { CRUD, type CrudAction, DB_USERS, type DbUser, isAllowed, roleName, rolePrivileges } from '../src/roles.ts';
import { ATLAS_ACTION, atlasRole, atlasRolesFile } from '../src/roles-atlas.ts';
import { mongoPrivileges } from '../src/roles-local.ts';

// 02 §4.3, transcribed independently of src/roles.ts: one string per user per namespace (f=find i=insert u=update
// r=remove; '' = no access). Every (user × namespace × CRUD action) cell is checked against this table.
const FIU = 'fiu';
const SPEC: Readonly<Record<Exclude<DbUser, 'mc_migrator'>, Readonly<Partial<Record<Namespace, string>>>>> = {
  mc_public: {
    ...Object.fromEntries(PUBLIC_VIEWS.map((view) => [view, 'f'])),
    audit_log: 'i',
    reports: 'i',
    grievances: 'i',
    grievance_seq: FIU,
    devices: 'fiur',
    device_follows: 'fiur',
    ameens: 'ir',
    ameen_counters: FIU,
    masjid_stats: 'iu',
  },
  mc_admin: {
    ...Object.fromEntries(PUBLIC_VIEWS.map((view) => [view, 'f'])),
    v_admin_follow_audience: 'f',
    masjids: FIU,
    masjid_timings: FIU,
    special_timings: FIU,
    items: FIU,
    chanda_weeks: FIU,
    content_library: FIU,
    notice_templates: FIU,
    payment_profiles: FIU,
    admin_users: FIU,
    masjid_admins: 'fiur',
    webauthn_credentials: FIU,
    admin_invites: FIU,
    admin_sessions: FIU,
    admin_push_subscriptions: 'fiur',
    notification_jobs: FIU,
    push_quota_usage: FIU,
    legal_orders: FIU,
    app_settings: FIU,
    campaign_amount_history: 'fi',
    audit_log: 'fi',
    reports: 'fu',
    grievances: 'fu',
    ameen_counters: 'f',
    masjid_stats: 'f',
    stats_snapshots: 'f',
  },
  mc_system: {
    ...Object.fromEntries(PUBLIC_VIEWS.map((view) => [view, 'f'])),
    v_admin_follow_audience: 'f',
    ...Object.fromEntries(
      COLLECTIONS.filter((c) => !['campaign_amount_history', 'audit_log', '_migrations'].includes(c)).map((c) => [
        c,
        'fiur',
      ]),
    ),
    campaign_amount_history: 'fir',
    audit_log: 'fir',
  },
};
const LETTER: Readonly<Record<CrudAction, string>> = { find: 'f', insert: 'i', update: 'u', remove: 'r' };

describe('02 §4.3 database privileges', () => {
  for (const user of ['mc_public', 'mc_admin', 'mc_system'] as const) {
    it(`${user}: every namespace × CRUD action matches the spec table`, () => {
      const mismatches = NAMESPACES.flatMap((namespace) =>
        CRUD.filter(
          (action) => isAllowed(user, namespace, action) !== (SPEC[user][namespace] ?? '').includes(LETTER[action]),
        ).map((action) => `${namespace}.${action}`),
      );
      expect(mismatches).toEqual([]);
    });
  }

  it('the examples 02 §4.3 names explicitly are denied', () => {
    expect(isAllowed('mc_public', 'items', 'find')).toBe(false);
    expect(isAllowed('mc_admin', 'audit_log', 'update')).toBe(false);
    expect(isAllowed('mc_admin', 'audit_log', 'remove')).toBe(false);
    expect(isAllowed('mc_admin', 'campaign_amount_history', 'update')).toBe(false);
    expect(isAllowed('mc_admin', 'devices', 'find')).toBe(false);
    expect(isAllowed('mc_public', 'masjids', 'find')).toBe(false); // only through v_pub_masjids
  });

  it('mc_migrator changes schema but reads no application data', () => {
    for (const namespace of NAMESPACES) {
      expect(isAllowed('mc_migrator', namespace, 'createIndex')).toBe(true);
      if (namespace !== '_migrations' && namespace !== 'app_settings') {
        expect(isAllowed('mc_migrator', namespace, 'find')).toBe(false);
      }
    }
    expect(isAllowed('mc_migrator', '_migrations', 'remove')).toBe(true);
    expect(isAllowed('mc_migrator', 'app_settings', 'insert')).toBe(true); // seeds the global settings document
    expect(isAllowed('mc_migrator', 'app_settings', 'remove')).toBe(false);
  });

  it('no application user can change schema or touch _migrations', () => {
    for (const user of ['mc_public', 'mc_admin', 'mc_system'] as const) {
      for (const p of rolePrivileges(user)) {
        expect(p.namespace).not.toBe('_migrations');
        expect(p.namespace).not.toBeNull();
        expect(p.actions.every((a) => (CRUD as readonly string[]).includes(a))).toBe(true);
      }
    }
  });

  it('mongoPrivileges targets only the given database; database-level actions use the empty collection', () => {
    for (const user of DB_USERS) {
      for (const p of mongoPrivileges(user, 'masjid_connect_dev')) expect(p.resource.db).toBe('masjid_connect_dev');
    }
    expect(mongoPrivileges('mc_migrator', 'x')).toContainEqual({
      resource: { db: 'x', collection: '' },
      actions: ['listCollections'],
    });
  });

  it('role names are per login and database', () => {
    expect(roleName('mc_public', 'masjid_connect_dev')).toBe('mc_public__masjid_connect_dev');
  });
});

describe('Atlas custom roles (T1.1)', () => {
  it('infra/mongo/atlas-roles.json is up to date (run `pnpm db:roles:atlas`)', () => {
    const committed: unknown = JSON.parse(
      readFileSync(new URL('../../../infra/mongo/atlas-roles.json', import.meta.url), 'utf8'),
    );
    expect(committed).toEqual(atlasRolesFile('masjid_connect'));
  });

  it('every action has an Atlas name in UPPER_SNAKE_CASE', () => {
    for (const name of Object.values(ATLAS_ACTION)) expect(name).toMatch(/^[A-Z]+(_[A-Z]+)*$/);
  });

  it('an Atlas role grants exactly the same (namespace, action) pairs as the local role', () => {
    for (const user of DB_USERS) {
      const atlas = atlasRole(user, 'db')
        .actions.flatMap((a) => a.resources.map((r) => `${r.collection}:${a.action}`))
        .sort();
      const local = mongoPrivileges(user, 'db')
        .flatMap((p) =>
          p.actions.map((action) => `${p.resource.collection}:${ATLAS_ACTION[action as keyof typeof ATLAS_ACTION]}`),
        )
        .sort();
      expect(atlas).toEqual(local);
    }
  });
});
