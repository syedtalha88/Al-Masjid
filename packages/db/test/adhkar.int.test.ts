// PHASE_03 T3.14 — "Adhkar after salah" as the real `mc_admin` / `mc_public` users: the admin saves an ordered set of
// verified `dhikr` entries (version bump, audit), another kind / draft / unknown id / a repeat / over 30 is refused and
// nothing is written; the bundle carries the set in order while it is on, without entries retired since. Fake texts only
// (10 §Fixtures).
import type { Long, UUID } from 'mongodb';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { MIGRATIONS } from '../migrations/index.ts';
import type { DbHandle } from '../src/client.ts';
import { StateError } from '../src/effects.ts';
import { runMigrations } from '../src/migrate/index.ts';
import { getAdhkarForAdmin, getMasjidBundle } from '../src/repos/index.ts';
import { adminScope, systemScope } from '../src/scope.ts';
import { buildDevSeed, seedId, writeDevSeed } from '../src/seed/index.ts';
import { setAdhkar } from '../src/state/index.ts';
import { createTestDatabase, processUserHandle, type TestDatabase } from '../src/testing/index.ts';
import { idText, newId } from '../src/values.ts';

const NOW = new Date('2026-11-05T06:30:00Z');
const TODAY = '2026-11-05';
const ALPHA = seedId('masjid-alpha');
const BETA = seedId('masjid-beta');
const DHIKR = [10, 11, 12].map((index) => seedId(`library-${String(index)}`));
const HADITH = seedId('library-0');

let test: TestDatabase | undefined;
let asAdmin: Awaited<ReturnType<typeof processUserHandle>> | undefined;
let asPublic: Awaited<ReturnType<typeof processUserHandle>> | undefined;
let asSystem: Awaited<ReturnType<typeof processUserHandle>> | undefined;
const t = () => {
  if (!test) throw new Error('no test database');
  return test;
};
const adm = (): DbHandle => {
  if (!asAdmin) throw new Error('no mc_admin handle');
  return asAdmin.handle;
};
const pub = (): DbHandle => {
  if (!asPublic) throw new Error('no mc_public handle');
  return asPublic.handle;
};
const raw = (name: string) => t().db.collection<{ _id: UUID } & Record<string, unknown>>(name);
const code = async (promise: Promise<unknown>) => {
  try {
    await promise;
    return 'ok';
  } catch (error) {
    if (error instanceof StateError) return error.code;
    throw error;
  }
};
const own = adminScope({ adminId: newId(), masjids: [{ id: ALPHA, role: 'owner' }] });
const version = async (id: UUID) => {
  const masjid = await raw('masjids').findOne({ _id: id }, { promoteLongs: false });
  return (masjid?.['content_version'] as Long).toNumber(); // int64 by schema
};
const bundleAdhkar = async () => {
  const bundle = await getMasjidBundle(pub(), ALPHA, TODAY);
  if (bundle?.status !== 'active') throw new Error('alpha is not active');
  return bundle.adhkar;
};

beforeAll(async () => {
  test = await createTestDatabase('adhkar-state');
  await runMigrations(t().db, MIGRATIONS);
  asAdmin = await processUserHandle(t(), 'mc_admin');
  asPublic = await processUserHandle(t(), 'mc_public');
  asSystem = await processUserHandle(t(), 'mc_system');
  await writeDevSeed(asSystem.handle, systemScope(), buildDevSeed({ now: NOW, today: TODAY }));
});

afterAll(async () => {
  await asAdmin?.dispose();
  await asPublic?.dispose();
  await asSystem?.dispose();
  await test?.dispose();
});

describe('setAdhkar / getAdhkarForAdmin', () => {
  it('the seeded set reads in order; another masjid reads as unknown', async () => {
    const set = await getAdhkarForAdmin(adm(), own, ALPHA);
    expect(set.enabled).toBe(true);
    expect(set.entries.map((entry) => entry.id)).toEqual(DHIKR.map(idText));
    expect(set.entries[0]).toMatchObject({ kind: 'dhikr', repeat: 33, occasions: ['after_salah'] });
    expect(await code(getAdhkarForAdmin(adm(), own, BETA))).toBe('MASJID_NOT_FOUND');
  });

  it('saves a new order: version bump, audit; off keeps the list', async () => {
    const before = await version(ALPHA);
    const order = [DHIKR[2], DHIKR[0]].filter((id) => id !== undefined);
    await setAdhkar(adm(), own, { masjidId: ALPHA, enabled: false, libraryIds: order });
    expect(await version(ALPHA)).toBe(before + 1);
    const set = await getAdhkarForAdmin(adm(), own, ALPHA);
    expect(set).toMatchObject({ enabled: false });
    expect(set.entries.map((entry) => entry.id)).toEqual(order.map(idText));
    const audit = await raw('audit_log').findOne({ action: 'adhkar.update' }, { sort: { at: -1 } });
    expect(audit?.['meta']).toEqual({ enabled: false, count: 2 });
  });

  it('refuses another kind, a repeat, over 30, another masjid — nothing written', async () => {
    const before = await version(ALPHA);
    const dhikr = DHIKR[0] ?? newId();
    const save = (libraryIds: UUID[], masjidId = ALPHA) =>
      setAdhkar(adm(), own, { masjidId, enabled: true, libraryIds });
    expect(await code(save([dhikr, HADITH]))).toBe('LIBRARY_ENTRY_NOT_FOUND');
    expect(await code(save([newId()]))).toBe('LIBRARY_ENTRY_NOT_FOUND');
    expect(await code(save([dhikr, dhikr]))).toBe('ADHKAR_INVALID');
    expect(await code(save(Array.from({ length: 31 }, () => newId())))).toBe('ADHKAR_INVALID');
    expect(await code(save([dhikr], BETA))).toBe('MASJID_NOT_FOUND');
    expect(await version(ALPHA)).toBe(before);
  });

  it('a draft entry cannot be chosen', async () => {
    const draft = DHIKR[1] ?? newId();
    await raw('content_library').updateOne({ _id: draft }, { $set: { status: 'draft' } });
    try {
      expect(await code(setAdhkar(adm(), own, { masjidId: ALPHA, enabled: true, libraryIds: [draft] }))).toBe(
        'LIBRARY_ENTRY_NOT_FOUND',
      );
    } finally {
      await raw('content_library').updateOne({ _id: draft }, { $set: { status: 'verified' } });
    }
  });
});

describe('bundle adhkar', () => {
  it('in order while on; an entry retired since is left out; off or empty is null', async () => {
    await setAdhkar(adm(), own, { masjidId: ALPHA, enabled: true, libraryIds: DHIKR });
    expect((await bundleAdhkar())?.entries.map((entry) => entry.id)).toEqual(DHIKR.map(idText));
    const retired = DHIKR[0] ?? newId();
    await raw('content_library').updateOne({ _id: retired }, { $set: { status: 'retired' } });
    try {
      expect((await bundleAdhkar())?.entries.map((entry) => entry.id)).toEqual(DHIKR.slice(1).map(idText));
      expect((await getAdhkarForAdmin(adm(), own, ALPHA)).entries).toHaveLength(2);
    } finally {
      await raw('content_library').updateOne({ _id: retired }, { $set: { status: 'verified' } });
    }
    await setAdhkar(adm(), own, { masjidId: ALPHA, enabled: false, libraryIds: DHIKR });
    expect(await bundleAdhkar()).toBeNull();
    await setAdhkar(adm(), own, { masjidId: ALPHA, enabled: true, libraryIds: [] });
    expect(await bundleAdhkar()).toBeNull();
    const beta = await getMasjidBundle(pub(), BETA, TODAY);
    expect(beta?.status === 'active' ? beta.adhkar : 'suspended').toBeNull();
  });
});
