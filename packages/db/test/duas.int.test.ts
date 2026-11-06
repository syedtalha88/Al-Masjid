// PHASE_03 T3.8 — publishing a dua request as the real `mc_admin` user: the stored shape (message + language, the
// category's detail, the attached dua), **a private name never reaching musallis** (the `v_pub_items` view as
// `mc_public`, the item and the feed — acceptance), a shared name shown, the janaza of an inteqal (window, inteqal
// only), library entries that are not verified duas, "Notify followers", the audit entry without the name, and the tenant
// fence. Placeholder library entries and fake names only (10 §Fixtures).
import type { Long, UUID } from 'mongodb';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { MIGRATIONS } from '../migrations/index.ts';
import type { DbHandle } from '../src/client.ts';
import { StateError } from '../src/effects.ts';
import { runMigrations } from '../src/migrate/index.ts';
import { getPublicItem, listFeed } from '../src/repos/index.ts';
import { adminScope, systemScope } from '../src/scope.ts';
import { buildDevSeed, seedId, writeDevSeed } from '../src/seed/index.ts';
import { type DuaRequestInput, publishDuaRequest } from '../src/state/index.ts';
import { createTestDatabase, processUserHandle, type TestDatabase } from '../src/testing/index.ts';
import { idText, newId, parseId } from '../src/values.ts';

const NOW = new Date('2026-11-04T06:30:00Z'); // 12:00 IST
const TODAY = '2026-11-04';
const ALPHA = seedId('masjid-alpha');
const BETA = seedId('masjid-beta');
// The dev seed's placeholder library: 0–3 hadith, 4–6 ayah, 7 dua (illness), 8 dua (inteqal), 9 dua (other).
const SHIFA = seedId('library-7');
const MAGHFIRAH = seedId('library-8');
const HADITH = seedId('library-0');
/** A fake name (10 §Fixtures) — searched for in everything musallis can read. */
const NAME = 'Testperson Private';

let test: TestDatabase | undefined;
let asAdmin: Awaited<ReturnType<typeof processUserHandle>> | undefined;
let asSystem: Awaited<ReturnType<typeof processUserHandle>> | undefined;
let asPublic: Awaited<ReturnType<typeof processUserHandle>> | undefined;
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
const raw = (name: string) => t().db.collection<{ _id: UUID | string } & Record<string, unknown>>(name);
const code = async (promise: Promise<unknown>) => {
  try {
    await promise;
    return 'ok';
  } catch (error) {
    if (error instanceof StateError) return error.code;
    throw error;
  }
};
const ADMIN_ID = newId();
const adminOf = (...masjids: UUID[]) =>
  adminScope({ adminId: ADMIN_ID, masjids: masjids.map((id) => ({ id, role: 'owner' as const })) });
const version = async (id: UUID) => {
  const masjid = await raw('masjids').findOne({ _id: id }, { promoteLongs: false });
  return (masjid?.['content_version'] as Long).toNumber(); // int64 by schema
};
const idOf = (text: string): UUID => {
  const id = parseId(text);
  if (!id) throw new Error(`not an id: ${text}`);
  return id;
};

const ILLNESS: DuaRequestInput = {
  category: 'illness',
  message: 'Test dua request message.\nSecond line.',
  locale: 'ur',
  personName: NAME,
  namePrivate: true,
  libraryId: SHIFA,
  notify: false,
};
const publish = (dua: DuaRequestInput, masjidId = ALPHA) =>
  publishDuaRequest(adm(), adminOf(ALPHA), { masjidId, dua, now: NOW });

beforeAll(async () => {
  test = await createTestDatabase('dua-state');
  await runMigrations(t().db, MIGRATIONS);
  asAdmin = await processUserHandle(t(), 'mc_admin');
  asSystem = await processUserHandle(t(), 'mc_system');
  asPublic = await processUserHandle(t(), 'mc_public');
  await writeDevSeed(asSystem.handle, systemScope(), buildDevSeed({ now: NOW, today: TODAY }));
});

afterAll(async () => {
  await asAdmin?.dispose();
  await asSystem?.dispose();
  await asPublic?.dispose();
  await test?.dispose();
});

describe('publishDuaRequest', () => {
  it('stores message, language and the dua detail; version bump; audit entry without the name', async () => {
    const before = await version(ALPHA);
    const result = await publish(ILLNESS);
    expect(result.quotaLeft).toBeNull();
    const item = await raw('items').findOne({ _id: idOf(result.item.id) }, { promoteLongs: false });
    expect(item).toMatchObject({
      masjid_id: ALPHA,
      type: 'dua_request',
      status: 'published',
      audience: 'everyone',
      body: 'Test dua request message.\nSecond line.',
      content_locale: 'ur',
      is_important: false,
      dua: { category: 'illness', person_name: NAME, name_private: true, library_id: SHIFA },
      created_by: ADMIN_ID,
      published_at: NOW,
    });
    expect(item).not.toHaveProperty('title');
    expect((item?.['published_version'] as Long).toNumber()).toBe(before + 1);
    const audit = await raw('audit_log').findOne({ action: 'item.publish', target_id: result.item.id });
    expect(audit).toMatchObject({ meta: { type: 'dua_request', template: null, notify: false, image: false } });
    expect(JSON.stringify(audit)).not.toContain(NAME);
  });

  it('a private name never reaches musallis: not in the view, the item or the feed (T3.8 acceptance)', async () => {
    const result = await publish(ILLNESS);
    const viewDoc = await (await pub().db()).collection('v_pub_items').findOne({ public_id: result.item.publicId });
    expect(viewDoc?.['dua']).toMatchObject({ category: 'illness', name_private: true });
    expect(viewDoc?.['dua']).not.toHaveProperty('person_name');
    const read = await getPublicItem(pub(), result.item.publicId, ['everyone']);
    expect(read?.item.dua).toMatchObject({ category: 'illness', namePrivate: true, library: { id: idText(SHIFA) } });
    expect(read?.item.dua).not.toHaveProperty('personName');
    const feed = await listFeed(pub(), ALPHA, { type: 'dua_request', audiences: ['everyone'] });
    expect(feed.items.some((entry) => entry.publicId === result.item.publicId)).toBe(true);
    expect(JSON.stringify([viewDoc, read, feed])).not.toContain(NAME);
  });

  it('a name the family allowed is shown', async () => {
    const result = await publish({ ...ILLNESS, personName: 'Testperson Shared', namePrivate: false });
    const read = await getPublicItem(pub(), result.item.publicId, ['everyone']);
    expect(read?.item.dua).toMatchObject({ personName: 'Testperson Shared', namePrivate: false });
  });

  it('inteqal: janaza time and place stored; a janaza is refused on another category or out of range', async () => {
    const janazaAt = new Date('2026-11-04T11:30:00Z'); // 5 PM IST
    const inteqal = (at: Date) =>
      publish({
        ...ILLNESS,
        category: 'inteqal',
        libraryId: MAGHFIRAH,
        janazaAt: at,
        janazaPlace: 'Test place',
      });
    const result = await inteqal(janazaAt);
    expect(await raw('items').findOne({ _id: idOf(result.item.id) })).toMatchObject({
      dua: { category: 'inteqal', janaza_at: janazaAt, janaza_place: 'Test place' },
    });
    expect(await code(inteqal(new Date('2026-11-02T06:00:00Z')))).toBe('DUA_INVALID'); // more than a day ago
    expect(await code(inteqal(new Date('2026-12-10T06:00:00Z')))).toBe('DUA_INVALID'); // over 30 days ahead
    expect(await code(publish({ ...ILLNESS, janazaAt }))).toBe('DUA_INVALID'); // not an inteqal
    expect(await code(publish({ ...ILLNESS, janazaPlace: 'Test place' }))).toBe('DUA_INVALID');
  });

  it('refuses a hadith, a draft dua and an unknown entry (LIBRARY_ENTRY_NOT_FOUND) — nothing written', async () => {
    const count = await raw('items').countDocuments({ masjid_id: ALPHA });
    expect(await code(publish({ ...ILLNESS, libraryId: HADITH }))).toBe('LIBRARY_ENTRY_NOT_FOUND');
    expect(await code(publish({ ...ILLNESS, libraryId: newId() }))).toBe('LIBRARY_ENTRY_NOT_FOUND');
    await raw('content_library').updateOne({ _id: SHIFA }, { $set: { status: 'draft' } });
    try {
      expect(await code(publish(ILLNESS))).toBe('LIBRARY_ENTRY_NOT_FOUND');
    } finally {
      await raw('content_library').updateOne({ _id: SHIFA }, { $set: { status: 'verified' } });
    }
    expect(await raw('items').countDocuments({ masjid_id: ALPHA })).toBe(count);
  });

  it('notify: a pending outbox job and notifications left; none left → NOTIFY_QUOTA_EXCEEDED, nothing published', async () => {
    const result = await publish({ ...ILLNESS, notify: true });
    expect(result.quotaLeft).toEqual(expect.any(Number));
    expect(await raw('notification_jobs').findOne({ item_id: idOf(result.item.id) })).toMatchObject({
      status: 'pending',
      audience: 'everyone',
    });
    const count = await raw('items').countDocuments({ masjid_id: ALPHA });
    await raw('masjids').updateOne({ _id: ALPHA }, { $set: { push_daily_quota: 0 } });
    try {
      expect(await code(publish({ ...ILLNESS, notify: true }))).toBe('NOTIFY_QUOTA_EXCEEDED');
      expect(await raw('items').countDocuments({ masjid_id: ALPHA })).toBe(count);
    } finally {
      await raw('masjids').updateOne({ _id: ALPHA }, { $set: { push_daily_quota: 8 } });
    }
  });

  it('another masjid reads as unknown', async () => {
    expect(await code(publish(ILLNESS, BETA))).toBe('MASJID_NOT_FOUND');
  });
});
