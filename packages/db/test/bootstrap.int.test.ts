// PHASE_01 T1.9 against a migrated MongoDB: the first Super Admin, refusal while one exists, --force-additional, a
// disabled Super Admin does not block, system scope only.
import { randomBytes } from 'node:crypto';

import type { UUID } from 'mongodb';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { MIGRATIONS } from '../migrations/index.ts';
import { createDbHandle, type DbHandle } from '../src/client.ts';
import { StateError } from '../src/effects.ts';
import { runMigrations } from '../src/migrate/index.ts';
import { publicScope, superScope, systemScope } from '../src/scope.ts';
import { bootstrapSuperAdmin, INVITE_TTL_MS, readInvite } from '../src/state/index.ts';
import { createTestDatabase, type TestDatabase, testMongoUri } from '../src/testing/index.ts';
import { newId } from '../src/values.ts';

let test: TestDatabase | undefined;
let handle: DbHandle | undefined;
const t = () => {
  if (!test) throw new Error('no test database');
  return test;
};
const h = () => {
  if (!handle) throw new Error('no handle');
  return handle;
};
type Raw = { _id: UUID } & Record<string, unknown>;
const raw = (name: string) => t().db.collection<Raw>(name);
const code = async (promise: Promise<unknown>) => {
  try {
    await promise;
    return 'ok';
  } catch (error) {
    if (error instanceof StateError) return error.code;
    throw error;
  }
};
const run = (force = false, tokenHash = randomBytes(32), now = new Date()) =>
  bootstrapSuperAdmin(h(), systemScope(), {
    displayName: 'Test Owner',
    uiLocale: 'en',
    inviteTokenHash: tokenHash,
    force,
    now,
  });

beforeAll(async () => {
  test = await createTestDatabase('bootstrap');
  await runMigrations(t().db, MIGRATIONS);
  handle = createDbHandle({ uri: testMongoUri(), database: t().name, process: 'script', local: true });
});

afterAll(async () => {
  await handle?.close();
  await test?.dispose();
});

describe('bootstrapSuperAdmin (04 §3)', () => {
  it('only the system scope may bootstrap', async () => {
    expect(
      await code(
        bootstrapSuperAdmin(h(), publicScope(), {
          displayName: 'x',
          uiLocale: 'en',
          inviteTokenHash: randomBytes(32),
          force: false,
        }),
      ),
    ).toBe('FORBIDDEN');
    expect(
      await code(
        bootstrapSuperAdmin(h(), superScope(newId(), new Date()), {
          displayName: 'x',
          uiLocale: 'en',
          inviteTokenHash: randomBytes(32),
          force: true,
        }),
      ),
    ).toBe('FORBIDDEN');
    expect(
      await code(
        bootstrapSuperAdmin(h(), systemScope(), {
          displayName: 'x',
          uiLocale: 'en',
          inviteTokenHash: randomBytes(16),
          force: false,
        }),
      ),
    ).toBe('INVALID_TOKEN_HASH');
    expect(await raw('admin_users').countDocuments({})).toBe(0);
  });

  it('creates an invited Super Admin with a 72 h register invite, audited as the system', async () => {
    const tokenHash = randomBytes(32);
    const now = new Date();
    const { adminId, expiresAt } = await run(false, tokenHash, now);
    expect(expiresAt.getTime() - now.getTime()).toBe(INVITE_TTL_MS);
    expect(await raw('admin_users').findOne({ _id: adminId })).toMatchObject({
      role: 'super_admin',
      status: 'invited',
      display_name: 'Test Owner',
    });
    const invite = await readInvite(h(), publicScope(), { tokenHash });
    expect(invite).toMatchObject({ adminId, purpose: 'register', masjidNames: [] });
    const audit = await raw('audit_log').find({ target_id: adminId.toHexString() }).toArray();
    expect(audit.map((a) => a['action']).sort()).toEqual(['admin.create', 'admin.invite']);
    expect(audit.every((a) => a['actor_type'] === 'system' && !('actor_id' in a))).toBe(true);
  });

  it('refuses while a Super Admin exists; --force-additional adds one; a disabled one does not block', async () => {
    expect(await code(run())).toBe('SUPER_ADMIN_EXISTS');
    expect(await raw('admin_users').countDocuments({ role: 'super_admin' })).toBe(1);
    await run(true);
    expect(await raw('admin_users').countDocuments({ role: 'super_admin' })).toBe(2);
    await raw('admin_users').updateMany({ role: 'super_admin' }, { $set: { status: 'disabled' } });
    expect(await code(run())).toBe('ok');
  });
});
