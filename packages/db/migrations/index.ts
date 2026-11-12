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
import s0010 from './0010_template_draft.snapshot.json' with { type: 'json' };
import s0011 from './0011_item_voice.snapshot.json' with { type: 'json' };
import s0012 from './0012_masjid_adhkar.snapshot.json' with { type: 'json' };
import s0013 from './0013_ruqyah.snapshot.json' with { type: 'json' };
import s0014 from './0014_contacts.snapshot.json' with { type: 'json' };
import s0015 from './0015_ruqyah_view.snapshot.json' with { type: 'json' };
import s0016 from './0016_push_fanout.snapshot.json' with { type: 'json' };
import s0017 from './0017_push_batch_balance.snapshot.json' with { type: 'json' };
import s0018 from './0018_chanda_items.snapshot.json' with { type: 'json' };
import s0019 from './0019_beneficiaries.snapshot.json' with { type: 'json' };
import s0020 from './0020_admin_push_session.snapshot.json' with { type: 'json' };
import s0021 from './0021_beneficiary_upi_history.snapshot.json' with { type: 'json' };
import s0022 from './0022_payment_reject_code.snapshot.json' with { type: 'json' };

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
  schema('0010_template_draft', s0010),
  schema('0011_item_voice', s0011),
  schema('0012_masjid_adhkar', s0012),
  schema('0013_ruqyah', s0013),
  schema('0014_contacts', s0014),
  schema('0015_ruqyah_view', s0015),
  schema('0016_push_fanout', s0016),
  schema('0017_push_batch_balance', s0017),
  schema('0018_chanda_items', s0018),
  schema('0019_beneficiaries', s0019),
  schema('0020_admin_push_session', s0020),
  schema('0021_beneficiary_upi_history', s0021),
  schema('0022_payment_reject_code', s0022),
];
