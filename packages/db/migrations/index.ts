// All migrations, in order (PHASE_01 T1.2). Schema migrations apply a frozen snapshot (canonical Extended JSON next to
// this file, written once by `pnpm db:migration:snapshot <id>`); a schema change is a NEW migration id, never an edit.
// Data seeds are separate migrations ("no data in schema migrations").
import { createHash } from 'node:crypto';

import { BSON, type Db, type Document } from 'mongodb';

import type { Migration } from '../src/migrate/runner.ts';
import { applySnapshot, type SchemaSnapshot, snapshotChecksum } from '../src/migrate/snapshot.ts';
import s0001 from './0001_masjids_admins.snapshot.json' with { type: 'json' };
import s0002 from './0002_timings_content.snapshot.json' with { type: 'json' };
import s0003 from './0003_library_payments.snapshot.json' with { type: 'json' };
import s0004 from './0004_devices_push.snapshot.json' with { type: 'json' };
import s0005 from './0005_moderation_audit.snapshot.json' with { type: 'json' };
import s0006 from './0006_views.snapshot.json' with { type: 'json' };
import s0008 from './0008_view_order.snapshot.json' with { type: 'json' };
import s0009 from './0009_library_dhikr.snapshot.json' with { type: 'json' };

/** A schema migration from its snapshot file (canonical EJSON → exact BSON types). */
function schema(id: string, file: unknown): Migration {
  const snapshot = BSON.EJSON.deserialize(file as Document, { relaxed: false }) as SchemaSnapshot; // written by snapshotText()
  return { id, checksum: snapshotChecksum(snapshot), up: (db: Db) => applySnapshot(db, snapshot) };
}

/**
 * The global settings document (02 §2 app_settings). Legal/contact values are placeholders the Super Admin replaces
 * in Settings (C10, T1.11) — they are not facts, and the grievance officer must be set before launch (05 §2).
 */
export const SEED_APP_SETTINGS = {
  _id: 'global',
  global_hijri_offset: 0,
  default_push_quota: 8,
  undertaking_version: 'draft-1',
  privacy_version: 'draft-1',
  terms_version: 'draft-1',
  push_paused: false,
  admin_read_only: false,
  report_autohide_threshold: 10,
  grievance_officer: { name: 'NOT SET', email: 'NOT SET', address: 'NOT SET', city: 'NOT SET' },
  min_client_version: '0.0.0',
} as const;

const seedAppSettings: Migration = {
  id: '0007_seed_app_settings',
  checksum: createHash('sha256').update(JSON.stringify(SEED_APP_SETTINGS)).digest('hex'),
  // Insert once; never overwrite values an admin already changed.
  up: async (db) => {
    await db
      .collection<{ _id: string }>('app_settings')
      .updateOne(
        { _id: SEED_APP_SETTINGS._id },
        { $setOnInsert: { ...SEED_APP_SETTINGS, updated_at: new Date() } },
        { upsert: true },
      );
  },
};

export const MIGRATIONS: readonly Migration[] = [
  schema('0001_masjids_admins', s0001),
  schema('0002_timings_content', s0002),
  schema('0003_library_payments', s0003),
  schema('0004_devices_push', s0004),
  schema('0005_moderation_audit', s0005),
  schema('0006_views', s0006),
  seedAppSettings,
  schema('0008_view_order', s0008),
  schema('0009_library_dhikr', s0009),
];
