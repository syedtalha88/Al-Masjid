// Migration runner (02 §2 `_migrations`, PHASE_01 T1.2): ordered, checksum-verified, idempotent, one runner at a time
// (lock document `_id: "__lock"` with an expiry, so a crashed runner never blocks forever). Runs as `mc_migrator`
// (02 §4.3) — locally via `pnpm db:migrate`, on servers via the image's `migrate` entry.
import { randomBytes } from 'node:crypto';

import type { Db } from 'mongodb';

export interface Migration {
  /** `NNNN_snake_name`, applied in ascending order. */
  readonly id: string;
  /** sha256 of what the migration applies (its frozen snapshot / seed content). */
  readonly checksum: string;
  up(db: Db): Promise<void>;
}

export interface MigrationResult {
  readonly applied: readonly string[];
  readonly skipped: readonly string[];
}

interface MigrationDoc {
  _id: string;
  checksum?: string;
  applied_at?: Date;
  duration_ms?: number;
  locked_until?: Date;
  owner?: string;
}

export class MigrationError extends Error {}

const LOCK_ID = '__lock';
const LOCK_MS = 10 * 60 * 1000;
const isCode = (error: unknown, code: number) =>
  typeof error === 'object' && error !== null && 'code' in error && error.code === code;

/**
 * Applies every migration not yet recorded in `_migrations`, in id order.
 *
 * @param db - the environment's database, connected as `mc_migrator`.
 * @param migrations - all migrations (order of the array is ignored; ids are sorted).
 * @param now - injectable clock (tests).
 * @returns the ids applied now and those already applied.
 * @throws MigrationError when another runner holds the lock, ids are malformed/duplicated, or an applied migration's
 *   checksum differs from its file (an applied migration must never change — add a new one instead).
 */
export async function runMigrations(
  db: Db,
  migrations: readonly Migration[],
  now: () => Date = () => new Date(),
): Promise<MigrationResult> {
  const ids = migrations.map((m) => m.id);
  if (ids.some((id) => !/^\d{4}_[a-z0-9_]+$/.test(id))) throw new MigrationError('malformed migration id');
  if (new Set(ids).size !== ids.length) throw new MigrationError('duplicate migration id');
  const ordered = [...migrations].sort((a, b) => a.id.localeCompare(b.id));
  const runs = db.collection<MigrationDoc>('_migrations');
  const owner = randomBytes(8).toString('hex');

  // Acquire: take the lock if absent or expired; a live lock makes the upsert hit the duplicate _id.
  try {
    await runs.updateOne(
      { _id: LOCK_ID, $or: [{ locked_until: { $exists: false } }, { locked_until: { $lt: now() } }] },
      { $set: { locked_until: new Date(now().getTime() + LOCK_MS), owner } },
      { upsert: true },
    );
  } catch (error) {
    if (isCode(error, 11000)) throw new MigrationError('another migration run holds the lock');
    throw error;
  }

  const applied: string[] = [];
  const skipped: string[] = [];
  try {
    const done = new Map((await runs.find({ _id: { $ne: LOCK_ID } }).toArray()).map((doc) => [doc._id, doc]));
    for (const migration of ordered) {
      const record = done.get(migration.id);
      if (record) {
        if (record.checksum !== migration.checksum) {
          throw new MigrationError(
            `checksum of applied migration ${migration.id} changed — add a new migration instead`,
          );
        }
        skipped.push(migration.id);
        continue;
      }
      const started = now().getTime();
      await migration.up(db);
      await runs.insertOne({
        _id: migration.id,
        checksum: migration.checksum,
        applied_at: now(),
        duration_ms: Math.max(0, now().getTime() - started),
      });
      applied.push(migration.id);
    }
  } finally {
    await runs.deleteOne({ _id: LOCK_ID, owner });
  }
  return { applied, skipped };
}
