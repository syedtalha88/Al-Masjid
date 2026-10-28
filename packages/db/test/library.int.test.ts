// PHASE_03 T3.4 data layer against a migrated MongoDB (DECISIONS #106, #108): Content Library import (★, all or
// nothing, draft), edits (content edits send a verified entry back to draft), verify, retire, duplicates, audit, and
// what admins may see (verified only). Religious text: the 10 §5 placeholders only.
import type { UUID } from 'mongodb';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { MIGRATIONS } from '../migrations/index.ts';
import { createDbHandle, type DbHandle } from '../src/client.ts';
import { StateError } from '../src/effects.ts';
import { runMigrations } from '../src/migrate/index.ts';
import { getLibraryEntry } from '../src/repos/index.ts';
import { adminScope, superScope } from '../src/scope.ts';
import { scoped } from '../src/scoped.ts';
import {
  findLibraryDuplicates,
  importLibraryEntries,
  type LibraryEntryInput,
  libraryKey,
  retireLibraryEntry,
  updateLibraryEntry,
  verifyLibraryEntry,
} from '../src/state/index.ts';
import { createTestDatabase, type TestDatabase, testMongoUri } from '../src/testing/index.ts';
import { newId } from '../src/values.ts';

let test: TestDatabase | undefined;
let handle: DbHandle | undefined;
const t = () => {
  if (!test) throw new Error('no test database');
  return test;
};
const h = () => {
  if (!handle) throw new Error('no handle');
  return handle;
};
type Raw = { _id: UUID } & Record<string, unknown>;
const raw = (name: string) => t().db.collection<Raw>(name);
const SUPER_ID = newId();
const fresh = () => superScope(SUPER_ID, new Date());
const anAdmin = () => adminScope({ adminId: newId(), masjids: [{ id: newId(), role: 'owner' }] });
const stale = () => superScope(SUPER_ID);
const code = async (promise: Promise<unknown>) => {
  try {
    await promise;
    return 'ok';
  } catch (error) {
    if (error instanceof StateError) return error.code;
    throw error;
  }
};

let counter = 0;
const entry = (over: Partial<LibraryEntryInput> = {}): LibraryEntryInput => {
  counter += 1;
  return {
    kind: 'hadith',
    arabic: 'نَصٌّ تجريبي للعرض فقط',
    transliteration: { en: 'Sample transliteration — DEV ONLY' },
    translation: {
      en: 'Sample translation text for development. Not a real hadith.',
      hi: 'विकास के लिए नमूना अनुवाद। यह वास्तविक हदीस नहीं है।',
    },
    reference: `DEV-SAMPLE-${String(counter).padStart(3, '0')}`,
    sourceName: 'Development fixture',
    sourceLicense: 'N/A — not for production',
    tags: ['patience'],
    ...over,
  };
};
const byReference = (reference: string) => raw('content_library').findOne({ reference });
const audits = (action: string) => raw('audit_log').find({ action }).toArray();

beforeAll(async () => {
  test = await createTestDatabase('library');
  await runMigrations(t().db, MIGRATIONS);
  handle = createDbHandle({ uri: testMongoUri(), database: t().name, process: 'script', local: true });
});
afterAll(async () => {
  await handle?.close();
  await test?.dispose();
});

describe('importLibraryEntries (★, all or nothing)', () => {
  it('imports every entry as draft with one batch id, search_text from the data layer, one audit entry', async () => {
    const rows = [entry(), entry({ kind: 'dhikr', repeat: 33, occasions: ['after_salah'], tags: [] })];
    const result = await importLibraryEntries(h(), fresh(), { entries: rows, requestId: 'req-import' });
    expect(result.imported).toBe(2);
    const first = await byReference(rows[0]?.reference ?? '');
    expect(first).toMatchObject({
      status: 'draft',
      import_batch_id: result.batchId,
      source_name: 'Development fixture',
    });
    expect(String(first?.['search_text'])).toContain('نص'); // harakat removed
    expect(String(first?.['search_text'])).toContain('patience');
    expect(await byReference(rows[1]?.reference ?? '')).toMatchObject({ repeat: 33, occasions: ['after_salah'] });
    const [audit] = (await audits('library.import')).filter((row) => row['request_id'] === 'req-import');
    expect(audit).toMatchObject({ actor_type: 'super_admin', meta: { entries: 2 } });
  });

  it('needs a fresh step-up and the Super Admin', async () => {
    expect(await code(importLibraryEntries(h(), stale(), { entries: [entry()] }))).toBe('STEP_UP_REQUIRED');
    const admin = anAdmin();
    expect(await code(importLibraryEntries(h(), admin, { entries: [entry()] }))).toBe('FORBIDDEN');
  });

  it('a duplicate in the file or in the library (any status) writes nothing', async () => {
    const existing = entry();
    await importLibraryEntries(h(), fresh(), { entries: [existing] });
    const before = await raw('content_library').countDocuments();
    const fresh1 = entry();
    expect(await code(importLibraryEntries(h(), fresh(), { entries: [fresh1, { ...existing }] }))).toBe(
      'LIBRARY_DUPLICATE',
    );
    expect(await code(importLibraryEntries(h(), fresh(), { entries: [fresh1, { ...fresh1 }] }))).toBe(
      'LIBRARY_DUPLICATE',
    );
    expect(await raw('content_library').countDocuments()).toBe(before);
    expect(await byReference(fresh1.reference)).toBeNull();
    // The same reference under another kind is a different entry.
    expect(await code(importLibraryEntries(h(), fresh(), { entries: [{ ...existing, kind: 'ayah' }] }))).toBe('ok');
  });

  it('kind-specific fields on the wrong kind are refused', async () => {
    expect(await code(importLibraryEntries(h(), fresh(), { entries: [entry({ repeat: 3 })] }))).toBe(
      'LIBRARY_FIELD_NOT_FOR_KIND',
    );
    expect(await code(importLibraryEntries(h(), fresh(), { entries: [entry({ duaCategory: 'illness' })] }))).toBe(
      'LIBRARY_FIELD_NOT_FOR_KIND',
    );
  });

  it('findLibraryDuplicates reports existing keys of any status (dry run)', async () => {
    const kept = entry();
    await importLibraryEntries(h(), fresh(), { entries: [kept] });
    const found = await findLibraryDuplicates(h(), stale(), [kept, entry()]);
    expect([...found]).toEqual([libraryKey(kept)]);
    expect(await code(findLibraryDuplicates(h(), anAdmin(), [kept]))).toBe('FORBIDDEN');
  });
});

describe('verify, edit, retire (DECISIONS #108)', () => {
  const imported = async (over: Partial<LibraryEntryInput> = {}) => {
    const row = entry(over);
    await importLibraryEntries(h(), fresh(), { entries: [row] });
    const doc = await byReference(row.reference);
    if (!doc) throw new Error('not imported');
    return doc._id;
  };

  it('verify: draft → verified with the verifier and time; only drafts; admins and musallis see verified only', async () => {
    const id = await imported();
    expect(await getLibraryEntry(h(), id)).toBeNull(); // draft is not public
    const adminSees = async () => scoped({ scope: anAdmin(), db: t().db }, 'content_library').findOne({ _id: id });
    expect(await adminSees()).toBeNull();
    const at = new Date('2026-10-28T10:00:00Z');
    await verifyLibraryEntry(h(), stale(), { id, verifiedBy: 'Test Reviewer', now: at });
    expect(await raw('content_library').findOne({ _id: id })).toMatchObject({
      status: 'verified',
      verified_by: 'Test Reviewer',
      verified_at: at,
    });
    expect((await getLibraryEntry(h(), id))?.reference).toMatch(/^DEV-SAMPLE-/);
    const seen = await adminSees();
    expect(seen?.['status']).toBe('verified');
    expect(seen).not.toHaveProperty('search_text'); // hidden from admins
    expect(await code(verifyLibraryEntry(h(), stale(), { id, verifiedBy: 'Test Reviewer' }))).toBe(
      'INVALID_TRANSITION',
    );
    expect(await audits('library.verify')).toHaveLength(1);
  });

  it('a content edit sends a verified entry back to draft; a tag edit keeps it verified; search_text follows', async () => {
    const id = await imported();
    await verifyLibraryEntry(h(), stale(), { id, verifiedBy: 'Test Reviewer' });
    const tags = await updateLibraryEntry(h(), stale(), { id, patch: { tags: ['sabr', 'patience'] } });
    expect(tags).toEqual({ fields: ['tags'], backToDraft: false });
    const tagged = await raw('content_library').findOne({ _id: id });
    expect(tagged).toMatchObject({ status: 'verified', verified_by: 'Test Reviewer' });
    expect(String(tagged?.['search_text'])).toContain('sabr');

    const text = await updateLibraryEntry(h(), stale(), {
      id,
      patch: { translation: { en: 'Sample corrected translation text for development.' } },
    });
    expect(text.backToDraft).toBe(true);
    const edited = await raw('content_library').findOne({ _id: id });
    expect(edited).toMatchObject({ status: 'draft' });
    expect(edited).not.toHaveProperty('verified_by');
    expect(edited).not.toHaveProperty('verified_at');
    expect(String(edited?.['search_text'])).toContain('corrected');
    expect(await getLibraryEntry(h(), id)).toBeNull();
    const [audit] = (await audits('library.update')).filter((row) => row['target_id'] === id.toHexString(true));
    expect(audit).toBeDefined();
  });

  it('null clears an optional field; wrong-kind fields, empty patches and taken references are refused', async () => {
    const dua = await imported({ kind: 'dua', duaCategory: 'illness' });
    await updateLibraryEntry(h(), stale(), { id: dua, patch: { duaCategory: null } });
    expect(await raw('content_library').findOne({ _id: dua })).not.toHaveProperty('dua_category');
    expect(await code(updateLibraryEntry(h(), stale(), { id: dua, patch: { repeat: 3 } }))).toBe(
      'LIBRARY_FIELD_NOT_FOR_KIND',
    );
    expect(await code(updateLibraryEntry(h(), stale(), { id: dua, patch: {} }))).toBe('NOTHING_TO_UPDATE');
    const other = entry({ kind: 'dua' });
    await importLibraryEntries(h(), fresh(), { entries: [other] });
    expect(await code(updateLibraryEntry(h(), stale(), { id: dua, patch: { reference: other.reference } }))).toBe(
      'LIBRARY_DUPLICATE',
    );
    expect(await code(updateLibraryEntry(h(), stale(), { id: newId(), patch: { tags: [] } }))).toBe(
      'LIBRARY_ENTRY_NOT_FOUND',
    );
  });

  it('retire: draft or verified → retired (final, read-only, not public)', async () => {
    const id = await imported();
    await verifyLibraryEntry(h(), stale(), { id, verifiedBy: 'Test Reviewer' });
    await retireLibraryEntry(h(), stale(), { id });
    expect(await raw('content_library').findOne({ _id: id })).toMatchObject({ status: 'retired' });
    expect(await getLibraryEntry(h(), id)).toBeNull();
    expect(await code(retireLibraryEntry(h(), stale(), { id }))).toBe('INVALID_TRANSITION');
    expect(await code(updateLibraryEntry(h(), stale(), { id, patch: { tags: [] } }))).toBe('INVALID_TRANSITION');
    expect(await code(verifyLibraryEntry(h(), stale(), { id, verifiedBy: 'Test Reviewer' }))).toBe(
      'INVALID_TRANSITION',
    );
    const [audit] = (await audits('library.retire')).filter((row) => row['target_id'] === id.toHexString(true));
    expect(audit).toMatchObject({ meta: { from: 'verified' } });
  });

  it('every function is Super Admin only', async () => {
    const id = await imported();
    const admin = anAdmin();
    expect(await code(verifyLibraryEntry(h(), admin, { id, verifiedBy: 'Test Reviewer' }))).toBe('FORBIDDEN');
    expect(await code(updateLibraryEntry(h(), admin, { id, patch: { tags: [] } }))).toBe('FORBIDDEN');
    expect(await code(retireLibraryEntry(h(), admin, { id }))).toBe('FORBIDDEN');
  });
});
