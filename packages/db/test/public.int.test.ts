// PHASE_02 T2.2 data layer: the public read repository (views only) and the device state functions, run as the REAL
// mc_public database user (DECISIONS #78) against the dev seed — so a missing privilege fails here, not on staging.
import { createHash, randomBytes } from 'node:crypto';

import { UUID } from 'mongodb';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { MIGRATIONS } from '../migrations/index.ts';
import type { DbHandle } from '../src/client.ts';
import { StateError } from '../src/effects.ts';
import { runMigrations } from '../src/migrate/index.ts';
import {
  findDuaItemId,
  getAmeenCounts,
  getLibraryEntry,
  getMasjidBundle,
  getMasjidSummary,
  getMasjidVersions,
  getPublicConfig,
  getPublicItem,
  listFeed,
  listTemplates,
  resolveMasjidByCode,
} from '../src/repos/public.ts';
import { deviceScope, publicScope, systemScope } from '../src/scope.ts';
import {
  buildDevSeed,
  PLACEHOLDER,
  SEED_FOLLOW_CODES,
  SEED_TEMPLATES,
  seedGradientRgba,
  seedId,
  seedPhoto,
  seedPublicId,
  writeDevSeed,
} from '../src/seed/index.ts';
import {
  deleteDevice,
  findDeviceCredential,
  getDeviceRecord,
  listFollows,
  recordAmeen,
  registerDevice,
  setDevicePrefs,
  setFollowMuted,
  touchDevice,
} from '../src/state/devices.ts';
import { followMasjid } from '../src/state/follows.ts';
import { createTestDatabase, processUserHandle, type TestDatabase } from '../src/testing/index.ts';
import { idText } from '../src/values.ts';

const NOW = new Date('2026-10-22T06:30:00Z'); // 12:00 IST
const TODAY = '2026-10-22';
const ALPHA = seedId('masjid-alpha');
const BETA = seedId('masjid-beta');
const GAMMA = seedId('masjid-gamma');

let test: TestDatabase | undefined;
let asPublic: Awaited<ReturnType<typeof processUserHandle>> | undefined;
let asSystem: Awaited<ReturnType<typeof processUserHandle>> | undefined;
const t = () => {
  if (!test) throw new Error('no test database');
  return test;
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

const newDevice = async (overrides: Partial<Parameters<typeof registerDevice>[2]> = {}) =>
  registerDevice(pub(), publicScope(), {
    secretHash: createHash('sha256').update(randomBytes(32)).digest(),
    locale: 'en',
    audiencePref: 'brothers',
    platform: 'android',
    privacyVersion: 'draft-1',
    now: NOW,
    ...overrides,
  });

beforeAll(async () => {
  test = await createTestDatabase('public-repo');
  await runMigrations(t().db, MIGRATIONS);
  asPublic = await processUserHandle(t(), 'mc_public');
  asSystem = await processUserHandle(t(), 'mc_system');
  await writeDevSeed(asSystem.handle, systemScope(), buildDevSeed({ now: NOW, today: TODAY }));
});

afterAll(async () => {
  await asPublic?.dispose();
  await asSystem?.dispose();
  await test?.dispose();
});

describe('dev seed (T2.2)', () => {
  it('writes 3 active masjids, 10 placeholder library entries, 8 templates and 30 items — idempotently', async () => {
    expect(await raw('masjids').countDocuments({ status: 'active' })).toBe(3);
    expect(await raw('content_library').countDocuments({ status: 'verified' })).toBe(10);
    expect(await raw('notice_templates').countDocuments({ status: 'active' })).toBe(SEED_TEMPLATES.length);
    expect(SEED_TEMPLATES).toHaveLength(8);
    expect(await raw('items').countDocuments({ status: 'published' })).toBe(30);
    // Again: same documents, the versions move on so caches refetch.
    const before = (await raw('masjids').findOne({ _id: ALPHA }))?.['content_version'];
    if (!asSystem) throw new Error('no system handle');
    await writeDevSeed(asSystem.handle, systemScope(), buildDevSeed({ now: NOW, today: TODAY }));
    expect(await raw('items').countDocuments({})).toBe(30);
    expect(await raw('masjids').countDocuments({})).toBe(3);
    const after = (await raw('masjids').findOne({ _id: ALPHA }))?.['content_version'];
    expect(Number(after)).toBe(Number(before) + 1);
  });

  it('uses only the 10 §5 religious-content placeholders', async () => {
    const entries = await raw('content_library').find({}).toArray();
    for (const entry of entries) {
      expect(entry['arabic']).toBe(PLACEHOLDER.arabic);
      expect(entry['translation']).toEqual(PLACEHOLDER.translation);
      expect(String(entry['reference'])).toMatch(/^DEV-SAMPLE-\d{3}$/);
      expect(entry['source_name']).toBe(PLACEHOLDER.sourceName);
    }
  });

  it('only the system scope may write it', async () => {
    expect(await code(writeDevSeed(pub(), publicScope(), buildDevSeed({ now: NOW, today: TODAY })))).toBe('FORBIDDEN');
  });

  it('generates gradient photos with matching ThumbHashes', () => {
    const rgba = seedGradientRgba('alpha', 2, 3);
    expect([...rgba.slice(0, 4)]).toEqual([43, 58, 103, 255]);
    expect([...rgba.slice(-4)]).toEqual([244, 162, 89, 255]);
    expect(seedGradientRgba('beta', 1, 1)[3]).toBe(255);
    expect(seedPhoto('gamma').key).toBe('seed/masjid-gamma');
    expect(seedPhoto('gamma').thumbhash).toMatch(/^[A-Za-z0-9+/]+=*$/);
  });
});

describe('public repository (views only, as mc_public)', () => {
  it('config: public settings incl. the grievance officer', async () => {
    const config = await getPublicConfig(pub());
    expect(config).toMatchObject({ globalHijriOffset: 0, legalVersions: { privacy: 'draft-1', terms: 'draft-1' } });
    expect(config.grievanceOfficer.name).toBe('NOT SET');
    expect(config.maintenanceBanner).toBeUndefined();
  });

  it('resolve: active masjids by follow code; everything else is uniformly absent', async () => {
    const found = await resolveMasjidByCode(pub(), SEED_FOLLOW_CODES.alpha);
    expect(found).toMatchObject({
      id: idText(ALPHA),
      followCode: 'TESTA001',
      name: 'Test Masjid Alpha',
      city: 'Hyderabad',
      verified: true,
      photo: { key: 'seed/masjid-alpha' },
    });
    expect(found?.nameI18n.ur).toBe('ٹیسٹ مسجد الفا');
    expect(await resolveMasjidByCode(pub(), 'ZZZZZZZZ')).toBeNull();
    await raw('masjids').updateOne({ _id: GAMMA }, { $set: { status: 'suspended' } });
    try {
      expect(await resolveMasjidByCode(pub(), SEED_FOLLOW_CODES.gamma)).toBeNull();
      expect(await getMasjidSummary(pub(), GAMMA)).toBeNull();
      const versions = await getMasjidVersions(pub(), [ALPHA, GAMMA, new UUID()]);
      expect(versions.get(idText(GAMMA))?.status).toBe('suspended');
      expect(versions.get(idText(ALPHA))?.status).toBe('active');
      expect(versions.size).toBe(2);
      const suspended = await getMasjidBundle(pub(), GAMMA, TODAY);
      expect(suspended?.status).toBe('suspended');
      expect(Object.keys(suspended ?? {}).sort()).toEqual(['status', 'v']);
    } finally {
      await raw('masjids').updateOne({ _id: GAMMA }, { $set: { status: 'active' } });
    }
    expect((await getMasjidVersions(pub(), [])).size).toBe(0);
  });

  it('bundle: profile, raw timings, Jumu‘ah, special dates from a date, Ramadan, empty Phase 5 parts', async () => {
    const bundle = await getMasjidBundle(pub(), BETA, '2026-10-15');
    if (bundle?.status !== 'active') throw new Error('expected an active bundle');
    expect(bundle.masjid).toMatchObject({ name: 'Test Masjid Beta', calcMethod: 'karachi', asrMadhab: 'hanafi' });
    expect(bundle.masjid.hijriOffset).toBeUndefined();
    expect(bundle.timings?.prayers.isha).toEqual({
      adhanMode: 'manual',
      adhanTime: '21:00',
      adhanAdjustMin: 0,
      jamaatMode: 'fixed',
      jamaatTime: '21:15',
    });
    expect(bundle.timings?.prayers.fajr).toEqual({
      adhanMode: 'auto',
      adhanAdjustMin: 0,
      jamaatMode: 'offset',
      jamaatOffsetMin: 30,
    });
    expect(bundle.timings?.jumuah).toEqual([{ seq: 1, khutbahTime: '13:30', jamaatTime: '13:45' }]);
    expect(bundle.ramadan).toEqual({
      start: '2026-10-17',
      end: '2026-11-15',
      sehriPrecautionMin: 5,
      iftarPrecautionMin: 2,
    });
    expect(bundle.specialDates.map((date) => date.type)).toEqual(['taraweeh']);
    expect({ payment: bundle.payment, campaigns: bundle.campaigns, chanda: bundle.chanda }).toEqual({
      payment: null,
      campaigns: [],
      chanda: null,
    });
    const gamma = await getMasjidBundle(pub(), GAMMA, TODAY);
    if (gamma?.status !== 'active') throw new Error('expected an active bundle');
    expect(gamma.masjid.hijriOffset).toBe(-1);
    expect(gamma.ramadan).toBeNull();
    expect(gamma.specialDates[0]).toMatchObject({
      type: 'eid_ul_fitr',
      date: '2026-10-24',
      times: [
        { time: '07:00', label: '1st Jamaat' },
        { time: '08:30', label: '2nd Jamaat' },
      ],
    });
    // Special dates before the window are left out.
    expect((await getMasjidBundle(pub(), BETA, '2026-10-23'))?.status === 'active').toBe(true);
    const later = await getMasjidBundle(pub(), BETA, '2026-10-23');
    expect(later?.status === 'active' ? later.specialDates : null).toEqual([]);
    expect(await getMasjidBundle(pub(), new UUID(), TODAY)).toBeNull();
  });

  it('bundle: a masjid without timings yet has `timings: null`', async () => {
    const saved = await raw('masjid_timings').findOne({ _id: ALPHA });
    await raw('masjid_timings').deleteOne({ _id: ALPHA });
    try {
      const bundle = await getMasjidBundle(pub(), ALPHA, TODAY);
      expect(bundle?.status === 'active' ? bundle.timings : 'x').toBeNull();
    } finally {
      if (saved) await raw('masjid_timings').insertOne(saved);
    }
  });

  it('feed: newest first, keyset pages, type and audience filters, library content joined', async () => {
    const first = await listFeed(pub(), ALPHA, { audiences: ['everyone', 'brothers'], limit: 4 });
    expect(first.items.map((item) => item.publicId)).toEqual([0, 1, 2, 3].map((index) => seedPublicId('alpha', index)));
    expect(first.next).toEqual(expect.any(String));
    const rest = await listFeed(pub(), ALPHA, { audiences: ['everyone', 'brothers'], cursor: first.next ?? '' });
    // 10 items, one of them for sisters only.
    expect(rest.items).toHaveLength(5);
    expect(rest.next).toBeNull();
    const all = [...first.items, ...rest.items].map((item) => item.publicId);
    expect(all).not.toContain(seedPublicId('alpha', 6));
    const sisters = await listFeed(pub(), ALPHA, { audiences: ['everyone', 'sisters'] });
    expect(sisters.items.map((item) => item.publicId)).toContain(seedPublicId('alpha', 6));
    expect(sisters.items).toHaveLength(10);
    const everyoneOnly = await listFeed(pub(), ALPHA, { audiences: ['everyone'] });
    expect(everyoneOnly.items).toHaveLength(9);

    const duas = await listFeed(pub(), ALPHA, { type: 'dua_request', audiences: ['everyone'] });
    expect(duas.items.map((item) => item.type)).toEqual(['dua_request', 'dua_request']);
    const [illness, inteqal] = duas.items;
    expect(illness?.dua).toMatchObject({ category: 'illness', namePrivate: false, personName: 'Test Person A' });
    expect(illness?.dua?.library).toMatchObject({
      kind: 'dua',
      arabic: PLACEHOLDER.arabic,
      reference: 'DEV-SAMPLE-008',
    });
    expect(inteqal?.dua).toMatchObject({ category: 'inteqal', namePrivate: true, janazaPlace: 'Test Masjid Alpha' });
    expect(inteqal?.dua?.personName).toBeUndefined();

    const hadith = (await listFeed(pub(), ALPHA, { type: 'daily_content', audiences: ['everyone'] })).items[0];
    expect(hadith?.daily).toMatchObject({ kind: 'hadith', note: 'Sample note from the masjid — dev only.' });
    expect(hadith?.daily?.library?.translation.en).toBe(PLACEHOLDER.translation.en);

    const template = first.items[0];
    expect(template).toMatchObject({
      type: 'announcement',
      templateKey: 'no_water_time_range',
      templateParams: { hours: { start: '10:00', end: '14:00' } },
      isImportant: true,
      announcement: { category: 'facilities' },
    });
    expect(template?.publishedAt).toBe(new Date(NOW.getTime() - 2 * 3_600_000).toISOString());
  });

  it('feed: a forged cursor is INVALID_CURSOR, the page size is capped at 30', async () => {
    for (const cursor of [
      'nope',
      Buffer.from('[1,"x"]').toString('base64url'),
      Buffer.from('{}').toString('base64url'),
    ]) {
      expect(await code(listFeed(pub(), ALPHA, { audiences: ['everyone'], cursor }))).toBe('INVALID_CURSOR');
    }
    expect((await listFeed(pub(), ALPHA, { audiences: ['everyone'], limit: 500 })).items).toHaveLength(9);
    expect((await listFeed(pub(), ALPHA, { audiences: ['everyone'], limit: 0 })).items).toHaveLength(1);
  });

  it('feed: removed, deleted and hidden-masjid items never appear', async () => {
    const id = seedId('item-alpha-0');
    await raw('items').updateOne({ _id: id }, { $set: { status: 'removed' } });
    try {
      const page = await listFeed(pub(), ALPHA, { audiences: ['everyone'] });
      expect(page.items.map((item) => item.publicId)).not.toContain(seedPublicId('alpha', 0));
      expect(await getPublicItem(pub(), seedPublicId('alpha', 0), ['everyone'])).toBeNull();
    } finally {
      await raw('items').updateOne({ _id: id }, { $set: { status: 'published' } });
    }
  });

  it('item detail: with its masjid; audience mismatch and unknown ids are absent', async () => {
    const found = await getPublicItem(pub(), seedPublicId('alpha', 1), ['everyone']);
    expect(found?.item).toMatchObject({ type: 'dua_request', publicId: seedPublicId('alpha', 1) });
    expect(found?.masjid.name).toBe('Test Masjid Alpha');
    expect(found?.itemId.toHexString()).toBe(seedId('item-alpha-1').toHexString());
    expect(await getPublicItem(pub(), seedPublicId('alpha', 6), ['everyone', 'brothers'])).toBeNull();
    expect(await getPublicItem(pub(), seedPublicId('alpha', 6), ['everyone', 'sisters'])).not.toBeNull();
    expect(await getPublicItem(pub(), 'unknown00000', ['everyone'])).toBeNull();
  });

  it('library and templates: verified entries, all four languages', async () => {
    const entry = await getLibraryEntry(pub(), seedId('library-0'));
    expect(entry).toMatchObject({ kind: 'hadith', sourceLicense: PLACEHOLDER.sourceLicense });
    expect(entry?.transliteration).toEqual({ en: PLACEHOLDER.transliteration });
    expect(await getLibraryEntry(pub(), new UUID())).toBeNull();
    await raw('content_library').updateOne({ _id: seedId('library-1') }, { $set: { status: 'retired' } });
    try {
      expect(await getLibraryEntry(pub(), seedId('library-1'))).toBeNull();
    } finally {
      await raw('content_library').updateOne({ _id: seedId('library-1') }, { $set: { status: 'verified' } });
    }
    const templates = await listTemplates(pub());
    expect(templates).toHaveLength(8);
    const water = templates.find((template) => template.key === 'no_water_time_range');
    expect(water).toMatchObject({ category: 'facilities', isImportantDefault: true, system: false });
    expect(water?.params).toEqual([{ name: 'hours', type: 'time_range', required: true }]);
    expect(water?.body.ur).toContain('{hours_start}');
  });
});

describe('device state functions (as mc_public)', () => {
  it('registers, authenticates by secret hash, and keeps no IP / UA / location', async () => {
    const secretHash = createHash('sha256').update('secret').digest();
    const id = await newDevice({ secretHash });
    const credential = await findDeviceCredential(pub(), publicScope(), id);
    expect(credential?.secretHash.equals(secretHash)).toBe(true);
    expect(await findDeviceCredential(pub(), publicScope(), new UUID())).toBeNull();
    const stored = await raw('devices').findOne({ _id: id });
    expect(Object.keys(stored ?? {}).sort()).toEqual(
      [
        '_id',
        'audience_pref',
        'created_at',
        'follow_count',
        'last_seen_at',
        'locale',
        'platform',
        'privacy_version',
        'push_status',
        'secret_hash',
      ].sort(),
    );
    const input = {
      secretHash,
      locale: 'en',
      audiencePref: 'brothers',
      platform: 'ios',
      privacyVersion: 'x',
      now: NOW,
    } as const;
    expect(await code(registerDevice(pub(), deviceScope(id), input))).toBe('FORBIDDEN');
    expect(await code(newDevice({ secretHash: Buffer.alloc(16) }))).toBe('INVALID_SECRET');
    expect(await code(findDeviceCredential(pub(), deviceScope(id), id))).toBe('FORBIDDEN');
  });

  it('device record view never includes the secret hash; last seen is written at most once a day', async () => {
    const id = await newDevice();
    const record = await getDeviceRecord(pub(), deviceScope(id));
    expect(record).toMatchObject({ locale: 'en', audiencePref: 'brothers', pushEnabled: false, followCount: 0 });
    expect(Object.keys(record)).not.toContain('secretHash');
    expect(await touchDevice(pub(), deviceScope(id), NOW, new Date(NOW.getTime() + 3_600_000))).toBe(false);
    const nextDay = new Date(NOW.getTime() + 25 * 3_600_000);
    expect(await touchDevice(pub(), deviceScope(id), NOW, nextDay)).toBe(true);
    expect((await getDeviceRecord(pub(), deviceScope(id))).lastSeenAt.toISOString()).toBe(nextDay.toISOString());
    expect(await code(getDeviceRecord(pub(), deviceScope(new UUID())))).toBe('DEVICE_NOT_FOUND');
    expect(await code(getDeviceRecord(pub(), publicScope()))).toBe('FORBIDDEN');
    expect(await code(touchDevice(pub(), publicScope(), NOW, nextDay))).toBe('FORBIDDEN');
  });

  it('preferences are mirrored onto the follows in one transaction (02 §5)', async () => {
    const id = await newDevice();
    await followMasjid(pub(), deviceScope(id), ALPHA);
    await followMasjid(pub(), deviceScope(id), BETA);
    await setDevicePrefs(pub(), deviceScope(id), { locale: 'ur', audiencePref: 'sisters', privacyVersion: 'draft-2' });
    const record = await getDeviceRecord(pub(), deviceScope(id));
    expect(record).toMatchObject({ locale: 'ur', audiencePref: 'sisters', privacyVersion: 'draft-2', followCount: 2 });
    const follows = await raw('device_follows').find({ device_id: id }).toArray();
    expect(follows.map((follow) => [follow['locale'], follow['audience_pref']])).toEqual([
      ['ur', 'sisters'],
      ['ur', 'sisters'],
    ]);
    await setDevicePrefs(pub(), deviceScope(id), { privacyVersion: 'draft-3' });
    expect(await code(setDevicePrefs(pub(), deviceScope(id), {}))).toBe('NOTHING_TO_UPDATE');
    expect(await code(setDevicePrefs(pub(), deviceScope(new UUID()), { locale: 'en' }))).toBe('DEVICE_NOT_FOUND');
    expect(await code(setDevicePrefs(pub(), publicScope(), { locale: 'en' }))).toBe('FORBIDDEN');
  });

  it('mute, list follows', async () => {
    const id = await newDevice();
    await followMasjid(pub(), deviceScope(id), GAMMA);
    expect(await setFollowMuted(pub(), deviceScope(id), GAMMA, true)).toBe(true);
    expect(await setFollowMuted(pub(), deviceScope(id), ALPHA, true)).toBe(false);
    const follows = await listFollows(pub(), deviceScope(id));
    expect(follows).toHaveLength(1);
    expect(follows[0]).toMatchObject({ muted: true });
    expect(follows[0]?.masjidId.toHexString()).toBe(GAMMA.toHexString());
    expect(await code(setFollowMuted(pub(), publicScope(), GAMMA, true))).toBe('FORBIDDEN');
    expect(await code(listFollows(pub(), publicScope()))).toBe('FORBIDDEN');
  });

  it('Ameen counts once per device, concurrently too, and only on published dua requests', async () => {
    const dua = await findDuaItemId(pub(), seedPublicId('gamma', 1));
    if (!dua) throw new Error('seed dua missing');
    const [a, b] = [await newDevice(), await newDevice()];
    expect(await recordAmeen(pub(), deviceScope(a), dua)).toBe(1);
    expect(await recordAmeen(pub(), deviceScope(a), dua)).toBe(1);
    const parallel = await Promise.all(Array.from({ length: 5 }, () => recordAmeen(pub(), deviceScope(b), dua)));
    expect(Math.max(...parallel)).toBe(2);
    expect(
      (await getAmeenCounts(pub(), [seedPublicId('gamma', 1), seedPublicId('gamma', 7), 'unknown00000'])).get(
        seedPublicId('gamma', 1),
      ),
    ).toBe(2);
    const counts = await getAmeenCounts(pub(), [seedPublicId('gamma', 1), seedPublicId('gamma', 7), 'unknown00000']);
    expect(Object.fromEntries(counts)).toEqual({ [seedPublicId('gamma', 1)]: 2, [seedPublicId('gamma', 7)]: 0 });
    expect((await getAmeenCounts(pub(), [])).size).toBe(0);
    expect((await getAmeenCounts(pub(), [seedPublicId('gamma', 0)])).size).toBe(0); // not a dua request
    expect(await findDuaItemId(pub(), seedPublicId('gamma', 0))).toBeNull();
    expect(await code(recordAmeen(pub(), deviceScope(a), seedId('item-gamma-0')))).toBe('ITEM_NOT_FOUND');
    expect(await code(recordAmeen(pub(), publicScope(), dua))).toBe('FORBIDDEN');
  });

  it('Clear all data: follows (and follower counts), Ameens and the device go; counters keep their totals', async () => {
    const id = await newDevice();
    await followMasjid(pub(), deviceScope(id), ALPHA);
    await followMasjid(pub(), deviceScope(id), GAMMA);
    const followersBefore = (await raw('masjid_stats').findOne({ _id: ALPHA }))?.['followers'];
    const dua = seedId('item-alpha-1');
    const count = await recordAmeen(pub(), deviceScope(id), dua);
    expect(await deleteDevice(pub(), deviceScope(id))).toBe('deleted');
    expect(await raw('devices').countDocuments({ _id: id })).toBe(0);
    expect(await raw('device_follows').countDocuments({ device_id: id })).toBe(0);
    expect(await raw('ameens').countDocuments({ device_id: id })).toBe(0);
    expect((await raw('masjid_stats').findOne({ _id: ALPHA }))?.['followers']).toBe(Number(followersBefore) - 1);
    expect((await raw('ameen_counters').findOne({ _id: dua }))?.['count']).toBe(count);
    expect(await deleteDevice(pub(), deviceScope(id))).toBe('not_found');
    expect(await code(deleteDevice(pub(), publicScope()))).toBe('FORBIDDEN');
  });
});
