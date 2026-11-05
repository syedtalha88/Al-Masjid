// F55 (DECISIONS #133) as the real `mc_admin` user (api-admin runs the Super Admin's library actions): a library entry
// that stops or starts being verified bumps the content version of exactly the masjids that use it — in their adhkar
// set, their Ruqyah list or a published hadith / dua post — so cached bundles, feeds and Ruqyah lists refresh at the
// next poll. Other masjids keep their version. Placeholder library texts only (10 §Fixtures).
import type { Long, UUID } from 'mongodb';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { MIGRATIONS } from '../migrations/index.ts';
import type { DbHandle } from '../src/client.ts';
import { runMigrations } from '../src/migrate/index.ts';
import { superScope, systemScope } from '../src/scope.ts';
import { buildDevSeed, seedId, writeDevSeed } from '../src/seed/index.ts';
import { retireLibraryEntry, updateLibraryEntry, verifyLibraryEntry } from '../src/state/index.ts';
import { createTestDatabase, processUserHandle, type TestDatabase } from '../src/testing/index.ts';
import { idText, newId } from '../src/values.ts';

const NOW = new Date('2026-11-05T06:30:00Z');
const TODAY = '2026-11-05';

let test: TestDatabase | undefined;
let asAdmin: Awaited<ReturnType<typeof processUserHandle>> | undefined;
let asSystem: Awaited<ReturnType<typeof processUserHandle>> | undefined;
const t = () => {
  if (!test) throw new Error('no test database');
  return test;
};
const adm = (): DbHandle => {
  if (!asAdmin) throw new Error('no mc_admin handle');
  return asAdmin.handle;
};
const raw = (name: string) => t().db.collection<{ _id: UUID } & Record<string, unknown>>(name);
const superAdmin = () => superScope(newId(), NOW);

/** Every masjid's content version. */
async function versions(): Promise<Map<string, number>> {
  const masjids = await raw('masjids').find({}, { promoteLongs: false }).toArray();
  return new Map(masjids.map((doc) => [idText(doc._id), (doc['content_version'] as Long).toNumber()])); // int64
}

/** The masjids that use a library entry, found independently of the code under test. */
async function usersOf(libraryId: UUID): Promise<Set<string>> {
  const users = new Set<string>();
  for (const doc of await raw('masjids').find({ 'adhkar.library_ids': libraryId }).toArray())
    users.add(idText(doc._id));
  for (const doc of await raw('ruqyah_entries').find({ library_id: libraryId, status: 'active' }).toArray()) {
    users.add(idText(doc['masjid_id'] as UUID));
  }
  const items = raw('items').find({
    status: 'published',
    $or: [{ 'daily.library_id': libraryId }, { 'dua.library_id': libraryId }],
  });
  for (const doc of await items.toArray()) users.add(idText(doc['masjid_id'] as UUID));
  return users;
}

/** Runs `action` and checks that exactly the users' versions went up by one. */
async function expectBumps(libraryId: UUID, action: () => Promise<unknown>, bumped: boolean) {
  const users = await usersOf(libraryId);
  const before = await versions();
  await action();
  const after = await versions();
  for (const [id, version] of before) {
    expect(after.get(id), id).toBe(bumped && users.has(id) ? version + 1 : version);
  }
  return users;
}

beforeAll(async () => {
  test = await createTestDatabase('library-users');
  await runMigrations(t().db, MIGRATIONS);
  asAdmin = await processUserHandle(t(), 'mc_admin');
  asSystem = await processUserHandle(t(), 'mc_system');
  await writeDevSeed(asSystem.handle, systemScope(), buildDevSeed({ now: NOW, today: TODAY }));
});

afterAll(async () => {
  await asAdmin?.dispose();
  await asSystem?.dispose();
  await test?.dispose();
});

describe('F55: library status changes bump the masjids that use the entry', () => {
  it('retiring a verified entry used in a Ruqyah list bumps exactly those masjids', async () => {
    const dua = seedId('library-7'); // the seed's Ruqyah library dua (Test Masjid Alpha)
    const users = await expectBumps(dua, () => retireLibraryEntry(adm(), superAdmin(), { id: dua }), true);
    expect(users).toContain(idText(seedId('masjid-alpha')));
  });

  it('a content edit (back to draft) and the verify that follows both bump the users of an adhkar entry', async () => {
    const masjid = await raw('masjids').findOne({ 'adhkar.library_ids.0': { $exists: true } });
    const ids = (masjid?.['adhkar'] as { library_ids: UUID[] } | undefined)?.library_ids ?? [];
    const [dhikr] = ids;
    if (!dhikr) throw new Error('the seed has no adhkar set');
    const users = await expectBumps(
      dhikr,
      () => updateLibraryEntry(adm(), superAdmin(), { id: dhikr, patch: { reference: 'DEV-SAMPLE-EDITED' } }),
      true,
    );
    expect(users.size).toBeGreaterThan(0);
    await expectBumps(
      dhikr,
      () => verifyLibraryEntry(adm(), superAdmin(), { id: dhikr, verifiedBy: 'Test Reviewer' }),
      true,
    );
  });

  it('an edit that keeps the status (tags) and retiring a draft nobody uses bump nothing', async () => {
    const hadith = seedId('library-0');
    await expectBumps(
      hadith,
      () => updateLibraryEntry(adm(), superAdmin(), { id: hadith, patch: { tags: ['sample'] } }),
      false,
    );
    const unused = await raw('content_library').findOne({ status: 'verified', _id: { $nin: [hadith] } });
    if (!unused) throw new Error('no verified entry');
    await raw('content_library').updateOne({ _id: unused._id }, { $set: { status: 'draft' } });
    await expectBumps(unused._id, () => retireLibraryEntry(adm(), superAdmin(), { id: unused._id }), false);
  });
});
