// PHASE_01 T1.2 acceptance against a real MongoDB: migrations run AS mc_migrator (its 02 §4.3 privileges suffice),
// create every collection/validator/index/view of 02, are idempotent and lock-protected; validators reject what 02
// forbids (India bounding box, VPA, lengths, money as anything but int64, unknown fields, null for absent, mode rules);
// views hide what they must; the drift check notices hand edits.
import { randomBytes } from 'node:crypto';

import { Double, Int32, Long, MongoClient, MongoServerError, UUID } from 'mongodb';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { MIGRATIONS } from '../migrations/index.ts';
import { MigrationError, runMigrations, schemaDrift } from '../src/migrate/index.ts';
import { applyLocalRoles, dropLocalRoles } from '../src/roles-local.ts';
import { createTestDatabase, type TestDatabase, testMongoUri } from '../src/testing/index.ts';

const VALIDATION_FAILED = 121;
const login = `mc_migrator_m${randomBytes(3).toString('hex')}`;
const password = randomBytes(24).toString('base64url');
let test: TestDatabase | undefined;
let migrator: MongoClient | undefined;
const t = (): TestDatabase => {
  if (!test) throw new Error('no test database');
  return test;
};
const asMigrator = () => {
  if (!migrator) throw new Error('no migrator client');
  return migrator.db(t().name);
};

/** Inserts as root (validation still applies) and returns 'ok' or the server error code. */
async function insert(collection: string, doc: Record<string, unknown>): Promise<'ok' | number> {
  try {
    await t().db.collection(collection).insertOne(doc);
    return 'ok';
  } catch (error) {
    if (error instanceof MongoServerError && typeof error.code === 'number') return error.code;
    throw error;
  }
}

const now = new Date('2026-10-16T05:00:00Z');
const masjid = (overrides: Record<string, unknown> = {}) => ({
  _id: new UUID(),
  follow_code: 'K7M2Q9XA',
  name: 'Test Masjid Alpha',
  name_i18n: {},
  area: 'Test Area',
  city: 'Hyderabad',
  state: 'Telangana',
  address: 'Test address',
  lat: 17.385,
  lng: 78.4867,
  status: 'pending',
  calc_method: 'karachi',
  asr_madhab: 'hanafi',
  show_chanda: false,
  chanda_week_start: 5,
  sehri_precaution_min: 0,
  iftar_precaution_min: 0,
  push_daily_quota: 8,
  content_version: Long.fromNumber(1),
  admin_count: 0,
  created_at: now,
  updated_at: now,
  ...overrides,
});
const campaignItem = (target: unknown, extra: Record<string, unknown> = {}) => ({
  _id: new UUID(),
  public_id: 'Ab3dEf6hIj9K',
  masjid_id: new UUID(),
  type: 'campaign',
  status: 'draft',
  audience: 'everyone',
  is_important: false,
  notify: false,
  masjid_visible: false,
  created_by: new UUID(),
  campaign: {
    purpose: 'repair',
    target_paise: target,
    received_paise: Long.fromNumber(0),
    starts_on: '2026-10-16',
    status: 'active',
    payment_profile_id: new UUID(),
  },
  created_at: now,
  updated_at: now,
  ...extra,
});
const prayer = (overrides: Record<string, unknown> = {}) => ({
  adhan_mode: 'auto',
  adhan_adjust_min: 0,
  jamaat_mode: 'fixed',
  jamaat_time: '13:30',
  ...overrides,
});
const timings = (fajr: Record<string, unknown>) => ({
  _id: new UUID(),
  prayers: { fajr, dhuhr: prayer(), asr: prayer(), maghrib: prayer(), isha: prayer() },
  jumuah: [{ seq: 1, jamaat_time: '13:30' }],
  masjid_visible: true,
  rev: 0,
  updated_by: new UUID(),
  updated_at: now,
});

beforeAll(async () => {
  test = await createTestDatabase('migrations');
  await applyLocalRoles(t().client, t().name, [{ user: 'mc_migrator', login, password }]);
  const url = new URL(testMongoUri());
  url.username = login;
  url.password = password;
  migrator = new MongoClient(url.toString(), { serverSelectionTimeoutMS: 5000 });
  await migrator.connect();
  const first = await runMigrations(asMigrator(), MIGRATIONS);
  expect(first.applied).toEqual(MIGRATIONS.map((m) => m.id));
});

afterAll(async () => {
  await migrator?.close();
  if (test) {
    await dropLocalRoles(test.client, test.name, [login]);
    await test.dispose();
  }
});

describe('migrations (run as mc_migrator)', () => {
  it('create exactly the 02 schema: every collection, validator (strict/error), index and view — no drift', async () => {
    expect(await schemaDrift(t().db)).toEqual([]);
  });

  it('running them again changes nothing', async () => {
    const second = await runMigrations(asMigrator(), MIGRATIONS);
    expect(second.applied).toEqual([]);
    expect(second.skipped).toHaveLength(MIGRATIONS.length);
    expect(await schemaDrift(t().db)).toEqual([]);
  });

  it('a live lock blocks a second runner; an expired lock does not', async () => {
    const runs = t().db.collection<{ _id: string; locked_until: Date }>('_migrations');
    await runs.insertOne({ _id: '__lock', locked_until: new Date(Date.now() + 60_000) });
    await expect(runMigrations(asMigrator(), MIGRATIONS)).rejects.toBeInstanceOf(MigrationError);
    await runs.updateOne({ _id: '__lock' }, { $set: { locked_until: new Date(Date.now() - 1000) } });
    await expect(runMigrations(asMigrator(), MIGRATIONS)).resolves.toMatchObject({ applied: [] });
    expect(await runs.countDocuments({ _id: '__lock' })).toBe(0);
  });

  it('an applied migration whose content changed is refused', async () => {
    const changed = MIGRATIONS.map((m, i) => (i === 0 ? { ...m, checksum: 'f'.repeat(64) } : m));
    await expect(runMigrations(asMigrator(), changed)).rejects.toThrow(/checksum of applied migration 0001/);
  });

  it('seeds app_settings once; v_pub_settings exposes only public fields', async () => {
    const settings = await t().db.collection('v_pub_settings').findOne({});
    expect(settings).toMatchObject({ _id: 'global', global_hijri_offset: 0, min_client_version: '0.0.0' });
    expect(settings).not.toHaveProperty('push_paused');
    expect(settings).not.toHaveProperty('admin_read_only');
  });
});

describe('validators reject what 02 forbids', () => {
  it('a complete masjid document is accepted', async () => {
    expect(await insert('masjids', masjid())).toBe('ok');
  });

  it.each([
    ['latitude outside India', { lat: 40.1 }],
    ['longitude outside India', { lng: 60 }],
    ['name longer than 120', { name: 'x'.repeat(121) }],
    ['unknown field', { owner_phone: '9999999999' }],
    ['null instead of absent', { photo_key: null }],
    ['content_version as int, not long', { content_version: new Int32(1) }],
    ['malformed follow code (O is not Crockford)', { follow_code: 'K7M2Q9XO' }],
    ['unknown status', { status: 'archived' }],
  ])('masjid: %s', async (_label, overrides) => {
    expect(await insert('masjids', masjid(overrides))).toBe(VALIDATION_FAILED);
  });

  it('money is int64 paise only: a double amount is rejected, a long accepted', async () => {
    expect(await insert('items', campaignItem(new Double(150000.5)))).toBe(VALIDATION_FAILED);
    expect(await insert('items', campaignItem(new Double(150000)))).toBe(VALIDATION_FAILED);
    expect(await insert('items', campaignItem(new Int32(150000)))).toBe(VALIDATION_FAILED);
    expect(await insert('items', campaignItem(Long.fromNumber(50_000)))).toBe(VALIDATION_FAILED); // < ₹1,000
    expect(await insert('items', campaignItem(Long.fromNumber(150_000)))).toBe('ok');
  });

  it('items carry exactly the detail object of their type', async () => {
    const video = { youtube_id: 'dQw4w9WgXcQ', thumb_key: 'k', thumb_thumbhash: 'h' };
    expect(await insert('items', campaignItem(Long.fromNumber(150_000), { public_id: 'Bb3dEf6hIj9K', video }))).toBe(
      VALIDATION_FAILED,
    );
    expect(
      await insert('items', campaignItem(Long.fromNumber(150_000), { public_id: 'Cb3dEf6hIj9K', type: 'video' })),
    ).toBe(VALIDATION_FAILED);
  });

  it('payment profiles: invalid VPA rejected, valid accepted', async () => {
    const profile = (vpa: string) => ({
      _id: new UUID(),
      masjid_id: new UUID(),
      vpa,
      payee_name: 'Test Masjid Trust',
      status: 'pending',
      open: true,
      requested_by: new UUID(),
      masjid_visible: false,
      created_at: now,
      updated_at: now,
    });
    expect(await insert('payment_profiles', profile('not a vpa'))).toBe(VALIDATION_FAILED);
    expect(await insert('payment_profiles', profile('a@1bank'))).toBe(VALIDATION_FAILED);
    expect(await insert('payment_profiles', profile('testmasjid@okbank'))).toBe('ok');
  });

  it('prayer modes: manual needs adhan_time, offset needs an offset and no fixed time', async () => {
    expect(await insert('masjid_timings', timings(prayer()))).toBe('ok');
    expect(await insert('masjid_timings', timings(prayer({ adhan_mode: 'manual' })))).toBe(VALIDATION_FAILED);
    expect(await insert('masjid_timings', timings(prayer({ adhan_mode: 'auto', adhan_time: '05:10' })))).toBe(
      VALIDATION_FAILED,
    );
    expect(await insert('masjid_timings', timings(prayer({ jamaat_mode: 'offset', jamaat_offset_min: 10 })))).toBe(
      VALIDATION_FAILED,
    );
    const offset = { adhan_mode: 'auto', adhan_adjust_min: 0, jamaat_mode: 'offset', jamaat_offset_min: 10 };
    expect(await insert('masjid_timings', timings(offset))).toBe('ok');
    expect(await insert('masjid_timings', timings({ ...offset, jamaat_mode: 'none' }))).toBe(VALIDATION_FAILED);
  });
});

describe('views hide what they must (02 §4.2)', () => {
  it('v_pub_masjids lists only active, not deleted masjids', async () => {
    const active = masjid({ follow_code: 'ACT1VE00', status: 'active' });
    const deleted = masjid({ follow_code: 'DE1ETED0', status: 'active', deleted_at: now });
    expect(await insert('masjids', active)).toBe('ok');
    expect(await insert('masjids', deleted)).toBe('ok');
    const visible = await t().db.collection<{ follow_code: string }>('v_pub_masjids').find({}).toArray();
    const codes = visible.map((doc) => doc.follow_code);
    expect(codes).toContain('ACT1VE00');
    expect(codes).not.toContain('DE1ETED0');
    expect(codes).not.toContain('K7M2Q9XA'); // pending
    expect(visible[0]).not.toHaveProperty('admin_count');
  });

  it('v_pub_items removes private dua names and internal fields', async () => {
    const dua = (publicId: string, namePrivate: boolean) => ({
      _id: new UUID(),
      public_id: publicId,
      masjid_id: new UUID(),
      type: 'dua_request',
      status: 'published',
      audience: 'everyone',
      is_important: false,
      notify: true,
      masjid_visible: true,
      created_by: new UUID(),
      dua: { category: 'illness', person_name: 'Test Person', name_private: namePrivate, library_id: new UUID() },
      created_at: now,
      updated_at: now,
    });
    expect(await insert('items', dua('PrivateDua01', true))).toBe('ok');
    expect(await insert('items', dua('PublicDua001', false))).toBe('ok');
    const view = t().db.collection('v_pub_items');
    const hidden = await view.findOne({ public_id: 'PrivateDua01' });
    const shown = await view.findOne({ public_id: 'PublicDua001' });
    expect(hidden?.['dua']).not.toHaveProperty('person_name');
    expect(shown?.['dua']).toHaveProperty('person_name', 'Test Person');
    expect(shown).not.toHaveProperty('created_by');
    expect(shown).not.toHaveProperty('notify');
  });
});

describe('db:schema:check notices drift', () => {
  it('a validator changed by hand, an extra index and a changed view are all reported', async () => {
    await t().db.command({ collMod: 'grievance_seq', validator: { $jsonSchema: { bsonType: 'object' } } });
    await t().db.collection('devices').createIndex({ platform: 1 }, { name: 'sneaky' });
    await t().db.command({ collMod: 'v_pub_library', viewOn: 'content_library', pipeline: [{ $match: {} }] });
    const drift = await schemaDrift(t().db);
    expect(drift).toEqual(
      expect.arrayContaining([
        'grievance_seq: validator differs',
        'devices: unexpected index sneaky',
        'v_pub_library: view definition differs',
      ]),
    );
    // Re-applying the migrations' snapshots repairs it (migrations are idempotent collMods).
    for (const migration of MIGRATIONS) await migration.up(asMigrator());
    await t().db.collection('devices').dropIndex('sneaky');
    expect(await schemaDrift(t().db)).toEqual([]);
  });
});
