// The Zod half of the schema (what the data layer accepts) and the snapshot helpers (PHASE_01 T1.2). The database
// half (validators) is proven by migrations.int.test.ts.
import { isValidVpa } from '@mc/domain/upi';
import { Binary, Long, UUID } from 'mongodb';
import { describe, expect, it } from 'vitest';

import { SCHEMA_AREAS } from '../migrations/areas.ts';
import { MIGRATIONS } from '../migrations/index.ts';
import { COLLECTIONS } from '../src/collections.ts';
import { currentSnapshot, parseSnapshot, snapshotChecksum, snapshotText } from '../src/migrate/index.ts';
import { f, SCHEMAS, VIEWS } from '../src/schema/index.ts';
import { VPA_PATTERN } from '../src/schema/platform.ts';

const now = new Date('2026-10-16T05:00:00Z');
const prayer = (overrides: Record<string, unknown> = {}) => ({
  adhan_mode: 'auto',
  adhan_adjust_min: 0,
  jamaat_mode: 'fixed',
  jamaat_time: '13:30',
  ...overrides,
});
const timings = (fajr: Record<string, unknown>, jumuah: unknown[] = [{ seq: 1, jamaat_time: '13:30' }]) => ({
  _id: new UUID(),
  prayers: { fajr, dhuhr: prayer(), asr: prayer(), maghrib: prayer(), isha: prayer() },
  jumuah,
  masjid_visible: true,
  rev: 0,
  updated_by: new UUID(),
  updated_at: now,
});
const ok = (name: keyof typeof SCHEMAS, doc: unknown) => SCHEMAS[name].zod.safeParse(doc).success;

describe('schema completeness', () => {
  it('every collection has a spec with a strict object validator', () => {
    for (const name of COLLECTIONS) {
      expect(SCHEMAS[name].jsonSchema).toMatchObject({ bsonType: 'object', additionalProperties: false });
    }
  });

  it('index names are unique per collection and every view starts with $match or $project', () => {
    for (const spec of Object.values(SCHEMAS)) {
      const names = spec.indexes.map((index) => index.name);
      expect(new Set(names).size).toBe(names.length);
    }
    for (const view of VIEWS) expect(Object.keys(view.pipeline[0] ?? {})[0]).toMatch(/^\$(match|project)$/);
  });

  it('every collection and view is created by exactly one schema migration area; later areas only redefine', () => {
    const areas = Object.entries(SCHEMA_AREAS);
    const firstSeen = new Map<string, string>();
    for (const [id, area] of areas) {
      for (const name of [...area.collections, ...(area.views ?? [])])
        if (!firstSeen.has(name)) firstSeen.set(name, id);
    }
    expect([...firstSeen.keys()].sort()).toEqual([...COLLECTIONS, ...VIEWS.map((view) => view.name)].sort());
    // A redefinition comes from a newer migration than the one that created the namespace (0008: view order).
    for (const [id, area] of areas) {
      for (const name of [...area.collections, ...(area.views ?? [])]) {
        expect((firstSeen.get(name) ?? '') <= id, `${name} in ${id}`).toBe(true);
      }
    }
    expect(SCHEMA_AREAS['0008_view_order']?.views).toEqual(['v_pub_items', 'v_pub_special_timings']);
  });
});

describe('Zod rules mirror the validators', () => {
  it('prayer modes: manual ⇔ adhan_time; fixed ⇔ jamaat_time; offset ⇔ jamaat_offset_min; none ⇒ neither', () => {
    expect(ok('masjid_timings', timings(prayer()))).toBe(true);
    expect(ok('masjid_timings', timings(prayer({ adhan_mode: 'manual', adhan_time: '05:10' })))).toBe(true);
    expect(ok('masjid_timings', timings(prayer({ adhan_mode: 'manual' })))).toBe(false);
    expect(ok('masjid_timings', timings(prayer({ adhan_time: '05:10' })))).toBe(false);
    const offset = { adhan_mode: 'auto', adhan_adjust_min: 0, jamaat_mode: 'offset', jamaat_offset_min: 10 };
    expect(ok('masjid_timings', timings(offset))).toBe(true);
    expect(ok('masjid_timings', timings({ ...offset, jamaat_mode: 'none' }))).toBe(false);
    expect(ok('masjid_timings', timings(prayer({ jamaat_mode: 'none' })))).toBe(false);
  });

  it('jumuah slots: unique seq in ascending order', () => {
    const slot = (seq: number) => ({ seq, jamaat_time: '13:30' });
    expect(ok('masjid_timings', timings(prayer(), [slot(1), slot(2)]))).toBe(true);
    expect(ok('masjid_timings', timings(prayer(), [slot(2), slot(1)]))).toBe(false);
    expect(ok('masjid_timings', timings(prayer(), [slot(1), slot(1)]))).toBe(false);
    expect(ok('masjid_timings', timings(prayer(), []))).toBe(false);
  });

  it('items carry exactly the detail of their type', () => {
    const base = {
      _id: new UUID(),
      public_id: 'Ab3dEf6hIj9K',
      masjid_id: new UUID(),
      status: 'draft',
      audience: 'everyone',
      is_important: false,
      notify: false,
      masjid_visible: false,
      created_by: new UUID(),
      created_at: now,
      updated_at: now,
    };
    const announcement = { category: 'general' };
    expect(ok('items', { ...base, type: 'announcement', announcement })).toBe(true);
    expect(ok('items', { ...base, type: 'timing_update', announcement })).toBe(true);
    expect(ok('items', { ...base, type: 'announcement' })).toBe(false);
    expect(ok('items', { ...base, type: 'video', announcement })).toBe(false);
    expect(ok('items', { ...base, type: 'announcement', announcement, chanda: { chanda_week_id: new UUID() } })).toBe(
      false,
    );
  });

  it('uuid and fixed-length bytes', () => {
    expect(f.uuid().zod.safeParse(new UUID()).success).toBe(true);
    expect(f.uuid().zod.safeParse(new Binary(Buffer.alloc(16), 0)).success).toBe(false);
    expect(f.bytes(32).zod.safeParse(new Binary(Buffer.alloc(32))).success).toBe(true);
    expect(f.bytes(32).zod.safeParse(new Binary(Buffer.alloc(31))).success).toBe(false);
    expect(f.long().zod.safeParse(1.5).success).toBe(false);
  });

  it('the VPA validator and @mc/domain isValidVpa agree (T5.1: the app never offers a VPA the database refuses)', () => {
    const pattern = new RegExp(VPA_PATTERN);
    const samples = [
      'ab@ybl',
      'a@ybl',
      'ab@1bank',
      'ab@y',
      'MASJID-01_x@paytm',
      'a.b-c_d@oksbi.in',
      'ab@ybl&am=1',
      'ab@@ybl',
      ' ab@ybl',
      'ab-@x-y',
      `${'a'.repeat(96)}@ybl`,
      `${'a'.repeat(97)}@ybl`,
    ];
    for (const value of samples) {
      expect(isValidVpa(value), value).toBe(pattern.test(value) && value.length <= 100);
    }
  });
});

describe('snapshots', () => {
  it('round-trip through canonical Extended JSON with exact BSON types', () => {
    const snapshot = currentSnapshot(['masjids', 'items'], ['v_pub_items']);
    const back = parseSnapshot(snapshotText(snapshot));
    expect(snapshotText(back)).toBe(snapshotText(snapshot));
    const contentVersion = (back.collections[0]?.jsonSchema['properties'] as Record<string, { minimum: unknown }>)[
      'content_version'
    ];
    expect(contentVersion?.minimum).toBeInstanceOf(Long);
    expect(back.views.map((view) => view.name)).toEqual(['v_pub_items']);
  });

  it('migration checksums are stable sha256 values and ids are ordered and unique', () => {
    for (const migration of MIGRATIONS) expect(migration.checksum).toMatch(/^[0-9a-f]{64}$/);
    const ids = MIGRATIONS.map((m) => m.id);
    expect([...ids].sort()).toEqual(ids);
    expect(new Set(ids).size).toBe(ids.length);
    expect(snapshotChecksum(currentSnapshot(['masjids']))).toBe(snapshotChecksum(currentSnapshot(['masjids'])));
  });
});

// 05 §1 (data minimization, DPDP): every field the server keeps about a musalli's phone. A new field fails this test
// until it is reviewed and recorded in DECISIONS — no name, phone, email, location, IP or user agent, ever.
// Baseline reviewed in DECISIONS #170 (Phase 08 T8.1).
const MUSALLI_FIELDS: Readonly<Record<string, readonly string[]>> = {
  devices: [
    '_id',
    'audience_pref',
    'created_at',
    'follow_count',
    'last_seen_at',
    'locale',
    'platform',
    'privacy_version',
    'push_auth',
    'push_endpoint',
    'push_p256dh',
    'push_status',
    'push_updated_at',
    'secret_hash',
  ],
  device_follows: ['_id', 'audience_pref', 'created_at', 'device_id', 'locale', 'masjid_id', 'muted', 'push_active'],
  ameens: ['_id', 'created_at', 'device_id', 'dua_item_id', 'masjid_id'],
  reports: [
    '_id',
    'actioned_at',
    'actioned_by',
    'closed_at',
    'created_at',
    'details',
    'device_id',
    'masjid_id',
    'reason',
    'resolution_note',
    'sla_due_at',
    'status',
    'target_id',
    'target_type',
    'triaged_at',
    'urgent',
  ],
};

describe('05 §1 data minimization', () => {
  for (const [name, allowed] of Object.entries(MUSALLI_FIELDS)) {
    it(`${name}: the validator and the Zod schema hold only the reviewed fields`, () => {
      const spec = SCHEMAS[name as keyof typeof SCHEMAS];
      const properties = (spec.jsonSchema as { properties?: Record<string, unknown> }).properties ?? {};
      expect(Object.keys(properties).sort()).toEqual([...allowed].sort());
      const shape = (spec.zod as unknown as { shape?: Record<string, unknown> }).shape ?? {};
      expect(Object.keys(shape).sort()).toEqual([...allowed].sort());
    });
  }
});
