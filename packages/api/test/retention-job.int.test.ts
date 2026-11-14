// PHASE_08 T8.7 — the `retention` job (mc_system): a dry run counts and changes nothing (summary audited as a dry
// run); a real run deletes a deleted Ruqyah entry's recording and a closed legal order's document *before* their
// records, audits counts only, and when a file cannot be deleted the record waits, the job fails and the Super Admin
// gets one `retention_failed` alert. Placeholder data only.
import { idText, newId } from '@mc/db';
import { runMigrations } from '@mc/db/migrate';
import { MIGRATIONS } from '@mc/db/migrations';
import { createTestDatabase, processUserHandle, type TestDatabase } from '@mc/db/testing';
import { ManualClock } from '@mc/shared/clock';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { processRetention } from '../src/jobs/retention/run.ts';
import type { PrivateFileStore } from '../src/media/private-store.ts';
import type { MediaStore } from '../src/media/store.ts';
import type { AlertService } from '../src/queue/alerts.ts';
import { silentLogger } from './helpers.ts';

const NOW = new Date('2026-11-13T06:30:00Z');
const DAY = 24 * 60 * 60 * 1000;
const MASJID = newId();
const AUDIO = `m/${idText(MASJID)}/a/${idText(newId())}`;
const DOCUMENT = `legal/${idText(newId())}/${idText(newId())}.bin`;

let test: TestDatabase | undefined;
let asSystem: Awaited<ReturnType<typeof processUserHandle>> | undefined;
const t = () => {
  if (!test) throw new Error('no test database');
  return test;
};
const raw = (name: string) => t().db.collection<{ _id: unknown } & Record<string, unknown>>(name);

const deleted: string[] = [];
let failing = false;
const media = {
  deleteAudio: (key: string) => {
    if (failing) return Promise.reject(new Error('storage down'));
    deleted.push(key);
    return Promise.resolve();
  },
} as unknown as MediaStore; // only deleteAudio is used for Ruqyah recordings
const privateFiles: PrivateFileStore = {
  put: () => Promise.resolve(),
  get: () => Promise.resolve(Buffer.alloc(0)),
  delete: (key) => {
    if (failing) return Promise.reject(new Error('storage down'));
    deleted.push(key);
    return Promise.resolve();
  },
};
const raised: string[] = [];
const alerts: AlertService = {
  raise: (input) => {
    raised.push(`${input.type}.${input.key}`);
    return Promise.resolve(true);
  },
};
const run = (dryRun: boolean) => {
  if (!asSystem) throw new Error('no mc_system handle');
  return processRetention(
    { db: asSystem.handle, clock: new ManualClock(NOW), logger: silentLogger(), media, privateFiles, alerts },
    { dryRun },
  );
};
const plant = async () => {
  await raw('ruqyah_entries').insertOne(
    {
      _id: newId(),
      masjid_id: MASJID,
      status: 'deleted',
      deleted_at: new Date(NOW.getTime() - 31 * DAY),
      audio: { key: AUDIO },
    },
    { bypassDocumentValidation: true },
  );
  await raw('legal_orders').insertOne(
    { _id: newId(), status: 'closed', updated_at: new Date(NOW.getTime() - 3 * 366 * DAY), document_key: DOCUMENT },
    { bypassDocumentValidation: true },
  );
};

beforeAll(async () => {
  test = await createTestDatabase('retention-job');
  await runMigrations(t().db, MIGRATIONS);
  asSystem = await processUserHandle(t(), 'mc_system');
  await plant();
});
afterAll(async () => {
  await asSystem?.dispose();
  await test?.dispose();
});

describe('retention job (T8.7)', () => {
  it('dry run: counts, deletes nothing, audits the summary as a dry run', async () => {
    const result = await run(true);
    expect(result).toMatchObject({ dryRun: true, files: 0, counts: { ruqyah: 1, legalOrders: 1 } });
    expect(deleted).toEqual([]);
    expect(await raw('ruqyah_entries').countDocuments()).toBe(1);
    expect(await raw('legal_orders').countDocuments()).toBe(1);
    const summary = await raw('audit_log').findOne({ action: 'retention.run' });
    expect(summary).toMatchObject({ actor_type: 'system', meta: { dry_run: true, files: 0, partial: false } });
    expect(JSON.stringify(summary)).not.toContain(AUDIO); // counts only
  });

  it('a file that cannot be deleted keeps its record; the job fails and alerts the Super Admin once', async () => {
    failing = true;
    await expect(run(false)).rejects.toThrow(/could not be deleted/u);
    expect(await raw('ruqyah_entries').countDocuments()).toBe(1);
    expect(await raw('legal_orders').countDocuments()).toBe(1);
    expect(raised).toEqual(['retention_failed.2026-11-13']);
    failing = false;
  });

  it('a real run deletes the files first, then the records; audits counts only', async () => {
    const result = await run(false);
    expect(result).toMatchObject({ dryRun: false, files: 2, counts: { ruqyah: 1, legalOrders: 1 } });
    expect(deleted.sort()).toEqual([AUDIO, DOCUMENT].sort());
    expect(await raw('ruqyah_entries').countDocuments()).toBe(0);
    expect(await raw('legal_orders').countDocuments()).toBe(0);
    expect(
      await raw('audit_log').countDocuments({ action: 'retention.run', 'meta.dry_run': false, 'meta.files': 2 }),
    ).toBe(1);
    expect((await run(false)).counts).toMatchObject({ ruqyah: 0, legalOrders: 0 });
  });
});
