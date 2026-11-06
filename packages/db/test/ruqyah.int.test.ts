// PHASE_03 T3.15 — Ruqyah as the real `mc_admin` / `mc_public` users: the admin adds library, text and audio entries
// (version bump, audit), a recording without the ownership tick / title or from another masjid and a library entry
// that is not verified are refused; the 50-entry limit holds, also for parallel adds; replace, delete and order; the
// validator's `oneOf` by source; the public list grouped by heading without private fields, deleted entries, hidden
// masjids or retired library entries; the bundle's section count. Fake texts only (10 §Fixtures).
import { type Long, UUID } from 'mongodb';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { MIGRATIONS } from '../migrations/index.ts';
import type { DbHandle } from '../src/client.ts';
import { StateError } from '../src/effects.ts';
import { runMigrations } from '../src/migrate/index.ts';
import { getMasjidBundle, getPublicRuqyah, listRuqyahForAdmin } from '../src/repos/index.ts';
import { RUQYAH_MAX } from '../src/schema/index.ts';
import { adminScope, systemScope } from '../src/scope.ts';
import { buildDevSeed, PLACEHOLDER, seedId, writeDevSeed } from '../src/seed/index.ts';
import {
  addRuqyahEntry,
  deleteRuqyahEntry,
  orderRuqyahEntries,
  type RuqyahEntryInput,
  updateRuqyahEntry,
} from '../src/state/index.ts';
import { createTestDatabase, processUserHandle, type TestDatabase } from '../src/testing/index.ts';
import { idText, newId, parseId } from '../src/values.ts';

const NOW = new Date('2026-11-05T06:30:00Z');
const TODAY = '2026-11-05';
const ALPHA = seedId('masjid-alpha');
const BETA = seedId('masjid-beta');
const GAMMA = seedId('masjid-gamma');
const DUA = seedId('library-7');
const HADITH = seedId('library-0');

let test: TestDatabase | undefined;
let asAdmin: Awaited<ReturnType<typeof processUserHandle>> | undefined;
let asPublic: Awaited<ReturnType<typeof processUserHandle>> | undefined;
let asSystem: Awaited<ReturnType<typeof processUserHandle>> | undefined;
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
const adminOf = (masjid: UUID) => adminScope({ adminId: newId(), masjids: [{ id: masjid, role: 'owner' }] });
const alpha = adminOf(ALPHA);
const version = async (id: UUID) => {
  const masjid = await raw('masjids').findOne({ _id: id }, { promoteLongs: false });
  return (masjid?.['content_version'] as Long).toNumber(); // int64 by schema
};
const recording = (masjid: UUID) => `m/${idText(masjid)}/a/${idText(newId())}`;
const text = (overrides: Partial<Extract<RuqyahEntryInput, { source: 'text' }>> = {}): RuqyahEntryInput => ({
  category: 'nazar',
  source: 'text',
  text: { arabic: PLACEHOLDER.arabic, translation: 'Sample masjid text — test only.', translationLocale: 'en' },
  ...overrides,
});
const audio = (
  masjid: UUID,
  extra: { rightsConfirmed?: boolean; title?: string | undefined } = {},
): RuqyahEntryInput => ({
  category: 'general',
  source: 'audio',
  title: 'title' in extra ? extra.title : 'Sample recording — test only',
  audio: { key: recording(masjid), durationS: 90, peaks: [1, 2, 3], rightsConfirmed: extra.rightsConfirmed ?? true },
});
const idOf = (text: string) => {
  const id = parseId(text);
  if (!id) throw new Error(`not an id: ${text}`);
  return id;
};
const add = (masjid: UUID, entry: RuqyahEntryInput) =>
  addRuqyahEntry(adm(), adminOf(masjid), { masjidId: masjid, entry, now: NOW });

beforeAll(async () => {
  test = await createTestDatabase('ruqyah-state');
  await runMigrations(t().db, MIGRATIONS);
  asAdmin = await processUserHandle(t(), 'mc_admin');
  asPublic = await processUserHandle(t(), 'mc_public');
  asSystem = await processUserHandle(t(), 'mc_system');
  await writeDevSeed(asSystem.handle, systemScope(), buildDevSeed({ now: NOW, today: TODAY }));
});

afterAll(async () => {
  await asAdmin?.dispose();
  await asPublic?.dispose();
  await asSystem?.dispose();
  await test?.dispose();
});

describe('add', () => {
  it('library, text and audio entries go to the end of the list, bump the version and are audited', async () => {
    const before = await version(ALPHA);
    const { id } = await addRuqyahEntry(adm(), alpha, {
      masjidId: ALPHA,
      entry: {
        category: 'protection',
        source: 'library',
        libraryId: HADITH,
        instructions: { text: 'After Fajr.', locale: 'en' },
      },
      requestId: 'req-ruqyah-1',
      now: NOW,
    });
    expect(await version(ALPHA)).toBe(before + 1);
    const doc = await raw('ruqyah_entries').findOne({ _id: idOf(id) });
    expect(doc).toMatchObject({
      source: 'library',
      category: 'protection',
      sort: 2, // after the two seeded entries
      status: 'active',
      masjid_visible: true,
      instructions: 'After Fajr.',
      instructions_locale: 'en',
    });
    expect(doc?.['created_by']).toEqual(alpha.adminId);
    const audit = await raw('audit_log').findOne({ action: 'ruqyah.create', target_id: id });
    expect(audit).toMatchObject({ request_id: 'req-ruqyah-1', meta: { source: 'library', category: 'protection' } });

    const voice = await add(ALPHA, audio(ALPHA));
    expect(await raw('ruqyah_entries').findOne({ _id: idOf(voice.id) })).toMatchObject({
      audio: { duration_s: 90, peaks: [1, 2, 3], rights_confirmed: true },
      sort: 3,
    });
    expect(await raw('audit_log').findOne({ target_id: voice.id })).toMatchObject({ meta: { rights_confirmed: true } });
  });

  it('a recording needs the ownership tick, a title and the masjid’s own key; nothing is written otherwise', async () => {
    const before = await version(ALPHA);
    expect(await code(add(ALPHA, audio(ALPHA, { rightsConfirmed: false })))).toBe('RUQYAH_INVALID');
    expect(await code(add(ALPHA, audio(ALPHA, { title: undefined })))).toBe('RUQYAH_INVALID');
    expect(await code(add(ALPHA, { ...audio(BETA) }))).toBe('RUQYAH_INVALID');
    expect(await version(ALPHA)).toBe(before);
  });

  it('a library entry must be verified (any kind); another masjid answers as unknown', async () => {
    await raw('content_library').updateOne({ _id: seedId('library-9') }, { $set: { status: 'draft' } });
    for (const libraryId of [seedId('library-9'), newId()]) {
      expect(await code(add(ALPHA, { category: 'general', source: 'library', libraryId }))).toBe(
        'LIBRARY_ENTRY_NOT_FOUND',
      );
    }
    await raw('content_library').updateOne({ _id: seedId('library-9') }, { $set: { status: 'verified' } });
    expect(await code(addRuqyahEntry(adm(), alpha, { masjidId: BETA, entry: text() }))).toBe('MASJID_NOT_FOUND');
  });

  it(`refuses entry ${String(RUQYAH_MAX + 1)}, also when the last places are taken in parallel`, async () => {
    const existing = await raw('ruqyah_entries').countDocuments({ masjid_id: GAMMA, status: 'active' });
    for (let index = existing; index < RUQYAH_MAX - 3; index += 1) await add(GAMMA, text());
    // A deleted entry does not count.
    const { id } = await add(GAMMA, text());
    await deleteRuqyahEntry(adm(), adminOf(GAMMA), { masjidId: GAMMA, id: idOf(id) });
    const results = await Promise.all(Array.from({ length: 6 }, () => code(add(GAMMA, text()))));
    expect(results.filter((result) => result === 'ok')).toHaveLength(3);
    expect(results.filter((result) => result === 'RUQYAH_LIMIT_REACHED')).toHaveLength(3);
    expect(await raw('ruqyah_entries').countDocuments({ masjid_id: GAMMA, status: 'active' })).toBe(RUQYAH_MAX);
    expect(await code(add(GAMMA, text()))).toBe('RUQYAH_LIMIT_REACHED');
  });
});

describe('the validator (oneOf by source)', () => {
  const base = () => ({
    _id: new UUID(),
    masjid_id: BETA,
    category: 'general',
    status: 'active',
    sort: 0,
    masjid_visible: true,
    created_by: new UUID(),
    created_at: NOW,
    updated_at: NOW,
  });
  const entryText = { arabic: PLACEHOLDER.arabic, translation: 'Sample — test only.', translation_locale: 'en' };
  const entryAudio = { key: recording(BETA), duration_s: 10, rights_confirmed: true };
  const refused = async (doc: Record<string, unknown>) => {
    await expect(raw('ruqyah_entries').insertOne({ ...base(), ...doc })).rejects.toMatchObject({ code: 121 });
  };

  it('accepts each source with its own field only', async () => {
    await raw('ruqyah_entries').insertOne({ ...base(), source: 'text', text: entryText });
    await raw('ruqyah_entries').insertOne({ ...base(), source: 'library', library_id: DUA });
    await raw('ruqyah_entries').insertOne({ ...base(), source: 'audio', audio: entryAudio, title: 'Sample' });
  });

  it('refuses a mismatched source, two sources, a title-less or unconfirmed recording, a lone instruction', async () => {
    await refused({ source: 'library', text: entryText });
    await refused({ source: 'text', text: entryText, library_id: DUA });
    await refused({ source: 'audio', audio: entryAudio });
    await refused({ source: 'audio', audio: { ...entryAudio, rights_confirmed: false }, title: 'Sample' });
    await refused({ source: 'text', text: entryText, instructions: 'Sample' });
    await refused({ source: 'text', text: entryText, status: 'deleted' });
    await refused({ source: 'text', text: entryText, deleted_at: NOW });
  });
});

describe('replace, delete, order', () => {
  it('a replacement keeps the place, removes what was left out and may change the source', async () => {
    const { id } = await add(BETA, text({ title: 'Sample title', instructions: { text: 'Sample.', locale: 'hi' } }));
    const sort = (await raw('ruqyah_entries').findOne({ _id: idOf(id) }))?.['sort'];
    await updateRuqyahEntry(adm(), adminOf(BETA), { masjidId: BETA, id: idOf(id), entry: audio(BETA) });
    const doc = await raw('ruqyah_entries').findOne({ _id: idOf(id) });
    expect(doc).toMatchObject({ source: 'audio', category: 'general', title: 'Sample recording — test only', sort });
    expect(doc).not.toHaveProperty('text');
    expect(doc).not.toHaveProperty('instructions');
    expect(doc).not.toHaveProperty('instructions_locale');
    expect(await raw('audit_log').countDocuments({ action: 'ruqyah.update', target_id: id })).toBe(1);
    // Another masjid's admin cannot touch it.
    expect(await code(updateRuqyahEntry(adm(), alpha, { masjidId: ALPHA, id: idOf(id), entry: text() }))).toBe(
      'RUQYAH_NOT_FOUND',
    );
  });

  it('a deleted entry is gone for followers, keeps its retention clock and cannot be changed again', async () => {
    const { id } = await add(BETA, text());
    const before = await version(BETA);
    await deleteRuqyahEntry(adm(), adminOf(BETA), { masjidId: BETA, id: idOf(id), now: NOW });
    expect(await version(BETA)).toBe(before + 1);
    expect(await raw('ruqyah_entries').findOne({ _id: idOf(id) })).toMatchObject({
      status: 'deleted',
      deleted_at: NOW,
    });
    expect(await code(deleteRuqyahEntry(adm(), adminOf(BETA), { masjidId: BETA, id: idOf(id) }))).toBe(
      'RUQYAH_NOT_FOUND',
    );
    expect(await code(updateRuqyahEntry(adm(), adminOf(BETA), { masjidId: BETA, id: idOf(id), entry: text() }))).toBe(
      'RUQYAH_NOT_FOUND',
    );
    const list = await listRuqyahForAdmin(adm(), adminOf(BETA), BETA);
    expect(list.entries.map((entry) => entry.id)).not.toContain(id);
  });

  it('orders every active entry exactly once; a stale, partial or repeated list is refused', async () => {
    const scope = adminOf(BETA);
    const ids = (await listRuqyahForAdmin(adm(), scope, BETA)).entries.map((entry) => idOf(entry.id));
    expect(ids.length).toBeGreaterThan(1);
    const reversed = [...ids].reverse();
    await orderRuqyahEntries(adm(), scope, { masjidId: BETA, ids: reversed });
    expect((await listRuqyahForAdmin(adm(), scope, BETA)).entries.map((entry) => entry.id)).toEqual(
      reversed.map(idText),
    );
    for (const bad of [ids.slice(1), [...ids, newId()], [...ids.slice(1), ids[1] ?? newId()]]) {
      expect(await code(orderRuqyahEntries(adm(), scope, { masjidId: BETA, ids: bad }))).toBe('RUQYAH_ORDER_INVALID');
    }
  });
});

describe('public reads', () => {
  it('groups by heading in A19 order, hides private fields; masjid text never carries a library source', async () => {
    const ruqyah = await getPublicRuqyah(pub(), ALPHA);
    const categories = ruqyah.sections.map((section) => section.category);
    expect(categories).toEqual(['nazar', 'shifa', 'protection', 'general']);
    const entries = ruqyah.sections.flatMap((section) => section.entries);
    const masjidText = entries.find((entry) => entry.source === 'text');
    expect(masjidText).toMatchObject({
      title: 'Sample masjid entry — DEV ONLY',
      text: { reference: 'DEV-MASJID-001' },
    });
    expect(masjidText).not.toHaveProperty('library');
    const fromLibrary = entries.find((entry) => entry.source === 'library' && entry.category === 'shifa');
    expect(fromLibrary?.library).toMatchObject({ id: idText(DUA), sourceName: PLACEHOLDER.sourceName });
    const recordingEntry = entries.find((entry) => entry.source === 'audio');
    expect(recordingEntry?.audio).toMatchObject({ durationS: 90 });
    expect(JSON.stringify(ruqyah)).not.toMatch(/rights_confirmed|rightsConfirmed|created_by|createdBy|libraryId/);
  });

  it('leaves out entries whose library entry was retired; the bundle counts the active entries', async () => {
    const bundle = await getMasjidBundle(pub(), ALPHA, TODAY);
    if (bundle?.status !== 'active') throw new Error('alpha is not active');
    const count = await raw('ruqyah_entries').countDocuments({ masjid_id: ALPHA, status: 'active' });
    expect(bundle.sections).toEqual({ ruqyah: count, needy: 0 });
    await raw('content_library').updateOne({ _id: HADITH }, { $set: { status: 'retired' } });
    const entries = (await getPublicRuqyah(pub(), ALPHA)).sections.flatMap((section) => section.entries);
    expect(entries.some((entry) => entry.library?.id === idText(HADITH))).toBe(false);
    // The admin still sees it, without its content, so it can be replaced.
    const admin = (await listRuqyahForAdmin(adm(), alpha, ALPHA)).entries.find(
      (entry) => entry.libraryId === idText(HADITH),
    );
    expect(admin).toBeDefined();
    expect(admin).not.toHaveProperty('library');
    await raw('content_library').updateOne({ _id: HADITH }, { $set: { status: 'verified' } });
  });

  it('a hidden masjid’s entries are not public (visibility mirror)', async () => {
    await raw('ruqyah_entries').updateMany({ masjid_id: BETA }, { $set: { masjid_visible: false } });
    expect((await getPublicRuqyah(pub(), BETA)).sections).toEqual([]);
    await raw('ruqyah_entries').updateMany({ masjid_id: BETA }, { $set: { masjid_visible: true } });
    expect((await getPublicRuqyah(pub(), BETA)).sections.length).toBeGreaterThan(0);
  });
});
