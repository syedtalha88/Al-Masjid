// The Zod half of the schema (what the data layer accepts) and the snapshot helpers (PHASE_01 T1.2). The database
// half (validators) is proven by migrations.int.test.ts.
import { Binary, Long, UUID } from 'mongodb';
import { describe, expect, it } from 'vitest';

import { SCHEMA_AREAS } from '../migrations/areas.ts';
import { MIGRATIONS } from '../migrations/index.ts';
import { COLLECTIONS } from '../src/collections.ts';
import { currentSnapshot, parseSnapshot, snapshotChecksum, snapshotText } from '../src/migrate/index.ts';
import { f, SCHEMAS, VIEWS } from '../src/schema/index.ts';

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

  it('every collection and view belongs to exactly one schema migration area', () => {
    const covered = Object.values(SCHEMA_AREAS).flatMap((area) => [...area.collections, ...(area.views ?? [])]);
    expect([...covered].sort()).toEqual([...COLLECTIONS, ...VIEWS.map((view) => view.name)].sort());
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
