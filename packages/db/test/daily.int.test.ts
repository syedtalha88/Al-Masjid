// PHASE_03 T3.7 — publishing today's hadith / ayah as the real `mc_admin` user: a verified library entry with the
// masjid's note (kind taken from the entry), the version bump and audit entry, musallis reading it with its library
// content, "Notify followers" (quota count + pending outbox job), entries an admin may not publish (dua, draft, retired,
// unknown), the "already one today" check behind the B6 warning, and the tenant fence. Placeholder library entries
// only (10 §Fixtures).
import type { Long, UUID } from 'mongodb';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { MIGRATIONS } from '../migrations/index.ts';
import type { DbHandle } from '../src/client.ts';
import { StateError } from '../src/effects.ts';
import { runMigrations } from '../src/migrate/index.ts';
import { dailyPublishedToday, getPublicItem } from '../src/repos/index.ts';
import { adminScope, systemScope } from '../src/scope.ts';
import { buildDevSeed, seedId, writeDevSeed } from '../src/seed/index.ts';
import { type DailyContentInput, publishDailyContent } from '../src/state/index.ts';
import { createTestDatabase, processUserHandle, type TestDatabase } from '../src/testing/index.ts';
import { idText, newId, parseId } from '../src/values.ts';

const NOW = new Date('2026-11-04T06:30:00Z'); // 12:00 IST
const TODAY = '2026-11-04';
const ALPHA = seedId('masjid-alpha');
const BETA = seedId('masjid-beta');
// The dev seed's placeholder library: 0–3 hadith, 4–6 ayah, 7–9 dua.
const HADITH = seedId('library-0');
const AYAH = seedId('library-4');
const DUA = seedId('library-7');

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

const publish = (daily: DailyContentInput, masjidId = ALPHA, now = NOW) =>
  publishDailyContent(adm(), adminOf(ALPHA), { masjidId, daily, now });

beforeAll(async () => {
  test = await createTestDatabase('daily-state');
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

describe('publishDailyContent', () => {
  it('a hadith with a note: stored shape, version bump, audit entry; musallis read it with its library content', async () => {
    const before = await version(ALPHA);
    const result = await publish({ libraryId: HADITH, note: 'Test note from the masjid.', notify: false });
    expect(result).toMatchObject({ kind: 'hadith', quotaLeft: null });
    const item = await raw('items').findOne({ _id: idOf(result.item.id) }, { promoteLongs: false });
    expect(item).toMatchObject({
      public_id: result.item.publicId,
      masjid_id: ALPHA,
      type: 'daily_content',
      status: 'published',
      audience: 'everyone',
      is_important: false,
      notify: false,
      daily: { library_id: HADITH, kind: 'hadith', note: 'Test note from the masjid.' },
      created_by: ADMIN_ID,
      published_at: NOW,
    });
    expect(item).not.toHaveProperty('title');
    expect(item).not.toHaveProperty('template_key');
    expect((item?.['published_version'] as Long).toNumber()).toBe(before + 1);
    expect(await version(ALPHA)).toBe(before + 1);
    expect(await raw('audit_log').findOne({ action: 'item.publish', target_id: result.item.id })).toMatchObject({
      masjid_id: ALPHA,
      meta: { type: 'daily_content', template: null, notify: false, image: false },
    });
    const read = await getPublicItem(pub(), result.item.publicId, ['everyone']);
    expect(read?.item.daily).toMatchObject({
      kind: 'hadith',
      note: 'Test note from the masjid.',
      library: { id: idText(HADITH), reference: 'DEV-SAMPLE-001' },
    });
  });

  it('the kind is the entry’s own; the note is optional', async () => {
    const result = await publish({ libraryId: AYAH, notify: false });
    expect(result.kind).toBe('ayah');
    const item = await raw('items').findOne({ _id: idOf(result.item.id) });
    expect(item?.['daily']).toEqual({ library_id: AYAH, kind: 'ayah' });
  });

  it('notify: a pending outbox job, the quota counted, notifications left returned', async () => {
    const quotaId = `${idText(ALPHA)}:${TODAY}`;
    const usedBefore = Number((await raw('push_quota_usage').findOne({ _id: quotaId }))?.['count'] ?? 0);
    const result = await publish({ libraryId: HADITH, notify: true });
    expect(result.quotaLeft).toBe(8 - (usedBefore + 1));
    expect(await raw('notification_jobs').findOne({ item_id: idOf(result.item.id) })).toMatchObject({
      masjid_id: ALPHA,
      status: 'pending',
      audience: 'everyone',
    });
  });

  it('refuses a dua, a draft, a retired and an unknown entry (LIBRARY_ENTRY_NOT_FOUND) — nothing written', async () => {
    const count = await raw('items').countDocuments({ masjid_id: ALPHA });
    const before = await version(ALPHA);
    const entry = (libraryId: UUID) => publish({ libraryId, notify: false });
    expect(await code(entry(DUA))).toBe('LIBRARY_ENTRY_NOT_FOUND');
    expect(await code(entry(newId()))).toBe('LIBRARY_ENTRY_NOT_FOUND');
    for (const status of ['draft', 'retired']) {
      await raw('content_library').updateOne({ _id: seedId('library-1') }, { $set: { status } });
      try {
        expect(await code(entry(seedId('library-1')))).toBe('LIBRARY_ENTRY_NOT_FOUND');
      } finally {
        await raw('content_library').updateOne({ _id: seedId('library-1') }, { $set: { status: 'verified' } });
      }
    }
    expect(await raw('items').countDocuments({ masjid_id: ALPHA })).toBe(count);
    expect(await version(ALPHA)).toBe(before);
  });

  it('no notifications left: NOTIFY_QUOTA_EXCEEDED and nothing is published', async () => {
    const count = await raw('items').countDocuments({ masjid_id: ALPHA });
    await raw('masjids').updateOne({ _id: ALPHA }, { $set: { push_daily_quota: 0 } });
    try {
      expect(await code(publish({ libraryId: HADITH, notify: true }))).toBe('NOTIFY_QUOTA_EXCEEDED');
      expect(await raw('items').countDocuments({ masjid_id: ALPHA })).toBe(count);
    } finally {
      await raw('masjids').updateOne({ _id: ALPHA }, { $set: { push_daily_quota: 8 } });
    }
  });

  it('another masjid reads as unknown', async () => {
    expect(await code(publish({ libraryId: HADITH, notify: false }, BETA))).toBe('MASJID_NOT_FOUND');
    expect(await code(dailyPublishedToday(adm(), adminOf(ALPHA), BETA, { kind: 'ayah', now: NOW }))).toBe(
      'MASJID_NOT_FOUND',
    );
  });
});

describe('dailyPublishedToday', () => {
  it('is true once the masjid published one of the kind today (IST), false for the other kind and tomorrow', async () => {
    const own = adminOf(BETA);
    const today = (kind: 'hadith' | 'ayah', now = NOW) => dailyPublishedToday(adm(), own, BETA, { kind, now });
    // Start from a Beta without daily content today (whatever the seed placed in the last 12 hours).
    await raw('items').deleteMany({
      masjid_id: BETA,
      type: 'daily_content',
      published_at: { $gte: new Date('2026-11-03T18:30:00Z') },
    });
    expect(await today('ayah')).toBe(false);
    const published = await publishDailyContent(adm(), own, {
      masjidId: BETA,
      daily: { libraryId: AYAH, notify: false },
      now: new Date('2026-11-03T19:00:00Z'), // 00:30 IST on the 4th
    });
    expect(await today('ayah')).toBe(true);
    expect(await today('hadith')).toBe(false);
    expect(await today('ayah', new Date('2026-11-04T18:31:00Z'))).toBe(false); // 00:01 IST on the 5th
    // A deleted post no longer counts.
    await raw('items').updateOne({ _id: idOf(published.item.id) }, { $set: { status: 'deleted', deleted_at: NOW } });
    expect(await today('ayah')).toBe(false);
  });
});
