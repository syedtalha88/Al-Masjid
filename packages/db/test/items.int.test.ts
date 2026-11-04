// PHASE_03 T3.9 — My Posts as the real `mc_admin` user: editing within 24 h (content checked as at publish, `edited_at`
// shown to musallis, optional fields unset when the content changes shape, If-Match on `updated_at`, version bump,
// audit), **an edit after 24 h refused with EDIT_WINDOW_CLOSED** (acceptance), types that are not edited, soft delete
// with the 180-day purge marker (musallis stop seeing it — acceptance; the e2e covers the poll), removed posts left
// alone, and the list (statuses, type filter, edit window, private name for the masjid only, moderation reason, pages,
// tenant fence). Placeholder library entries and fake texts only (10 §Fixtures).
import type { Long, UUID } from 'mongodb';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { MIGRATIONS } from '../migrations/index.ts';
import type { DbHandle } from '../src/client.ts';
import { StateError } from '../src/effects.ts';
import { runMigrations } from '../src/migrate/index.ts';
import { getPublicItem, listItemsForAdmin } from '../src/repos/index.ts';
import { adminScope, systemScope } from '../src/scope.ts';
import { buildDevSeed, seedId, writeDevSeed } from '../src/seed/index.ts';
import {
  type AnnouncementInput,
  deleteItem,
  editItem,
  publishAnnouncement,
  publishDailyContent,
  publishDuaRequest,
} from '../src/state/index.ts';
import { createTestDatabase, processUserHandle, type TestDatabase } from '../src/testing/index.ts';
import { idText, newId, parseId } from '../src/values.ts';

const NOW = new Date('2026-11-04T06:30:00Z'); // 12:00 IST
const TODAY = '2026-11-04';
const HOUR = 60 * 60 * 1000;
const ALPHA = seedId('masjid-alpha');
const BETA = seedId('masjid-beta');
const HADITH = seedId('library-0');
const HADITH_2 = seedId('library-1');
const SHIFA = seedId('library-7');

let test: TestDatabase | undefined;
let asAdmin: Awaited<ReturnType<typeof processUserHandle>> | undefined;
let asSystem: Awaited<ReturnType<typeof processUserHandle>> | undefined;
let asPublic: Awaited<ReturnType<typeof processUserHandle>> | undefined;
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
const raw = (name: string) => t().db.collection<{ _id: UUID | string } & Record<string, unknown>>(name);
const code = async (promise: Promise<unknown>) => {
  try {
    await promise;
    return 'ok';
  } catch (error) {
    if (error instanceof StateError) return error.code;
    throw error;
  }
};
const ADMIN_ID = newId();
const own = adminScope({ adminId: ADMIN_ID, masjids: [{ id: ALPHA, role: 'owner' }] });
const version = async (id: UUID) => {
  const masjid = await raw('masjids').findOne({ _id: id }, { promoteLongs: false });
  return (masjid?.['content_version'] as Long).toNumber(); // int64 by schema
};
const idOf = (text: string): UUID => {
  const id = parseId(text);
  if (!id) throw new Error(`not an id: ${text}`);
  return id;
};
const updatedAtOf = async (id: string) => {
  const item = await raw('items').findOne({ _id: idOf(id) });
  return (item?.['updated_at'] as Date).toISOString();
};

const OWN_TEXT: AnnouncementInput = {
  content: { kind: 'text', title: 'Test notice title', body: 'Test notice body.', locale: 'en' },
  category: 'general',
  isImportant: false,
  notify: false,
};
const { notify: _n, ...OWN_TEXT_EDIT } = OWN_TEXT;
const notice = async (at = NOW) =>
  (await publishAnnouncement(adm(), own, { masjidId: ALPHA, announcement: OWN_TEXT, now: at })).item;
const edit = (id: string, ifMatch: string, announcement = OWN_TEXT_EDIT, at = new Date(NOW.getTime() + HOUR)) =>
  editItem(adm(), own, {
    masjidId: ALPHA,
    itemId: idOf(id),
    ifMatch,
    edit: { type: 'announcement', announcement },
    now: at,
  });

beforeAll(async () => {
  test = await createTestDatabase('item-state');
  await runMigrations(t().db, MIGRATIONS);
  asAdmin = await processUserHandle(t(), 'mc_admin');
  asSystem = await processUserHandle(t(), 'mc_system');
  asPublic = await processUserHandle(t(), 'mc_public');
  await writeDevSeed(asSystem.handle, systemScope(), buildDevSeed({ now: NOW, today: TODAY }));
});

afterAll(async () => {
  await asAdmin?.dispose();
  await asSystem?.dispose();
  await asPublic?.dispose();
  await test?.dispose();
});

describe('editItem', () => {
  it('replaces the content within 24 h: edited_at, version bump, audit; musallis see "edited"', async () => {
    const item = await notice();
    const before = await version(ALPHA);
    const at = new Date(NOW.getTime() + 3 * HOUR);
    const result = await edit(
      item.id,
      await updatedAtOf(item.id),
      {
        ...OWN_TEXT_EDIT,
        content: { kind: 'text', title: 'Test edited title', body: 'Test edited body.', locale: 'te' },
      },
      at,
    );
    expect(result.updatedAt).toBe(at.toISOString());
    expect(await raw('items').findOne({ _id: idOf(item.id) })).toMatchObject({
      title: 'Test edited title',
      body: 'Test edited body.',
      content_locale: 'te',
      edited_at: at,
      updated_at: at,
      published_at: NOW, // the publish time stays
    });
    expect(await version(ALPHA)).toBe(before + 1);
    expect(await raw('audit_log').findOne({ action: 'item.edit', target_id: item.id })).toMatchObject({
      meta: { type: 'announcement' },
    });
    const read = await getPublicItem(pub(), item.publicId, ['everyone']);
    expect(read?.item).toMatchObject({ title: 'Test edited title', editedAt: at.toISOString() });
    // Edits never notify.
    expect(await raw('notification_jobs').countDocuments({ item_id: idOf(item.id) })).toBe(0);
  });

  it('own text → a template: title, body and language are unset; the template is checked as at publish', async () => {
    const item = await notice();
    const template = (params: Record<string, { start: string; end: string }>) => ({
      ...OWN_TEXT_EDIT,
      content: { kind: 'template' as const, key: 'no_water_time_range', params },
      category: 'facilities' as const,
    });
    expect(await code(edit(item.id, await updatedAtOf(item.id), template({})))).toBe('ANNOUNCEMENT_INVALID');
    await edit(item.id, await updatedAtOf(item.id), template({ hours: { start: '10:00', end: '14:00' } }));
    const stored = await raw('items').findOne({ _id: idOf(item.id) });
    expect(stored).toMatchObject({ template_key: 'no_water_time_range', announcement: { category: 'facilities' } });
    expect(stored).not.toHaveProperty('title');
    expect(stored).not.toHaveProperty('body');
    expect(stored).not.toHaveProperty('content_locale');
  });

  it('If-Match: an edit on a stale updated_at is PRECONDITION_FAILED — nothing written', async () => {
    const item = await notice();
    const first = await updatedAtOf(item.id);
    await edit(item.id, first);
    const changed = { ...OWN_TEXT_EDIT, content: { ...OWN_TEXT.content, title: 'Test stale title' } } as const;
    expect(await code(edit(item.id, first, changed, new Date(NOW.getTime() + 2 * HOUR)))).toBe('PRECONDITION_FAILED');
    expect((await raw('items').findOne({ _id: idOf(item.id) }))?.['title']).toBe('Test notice title');
  });

  it('after 24 h: EDIT_WINDOW_CLOSED (T3.9 acceptance)', async () => {
    const item = await notice();
    const late = new Date(NOW.getTime() + 24 * HOUR + 60_000);
    expect(await code(edit(item.id, await updatedAtOf(item.id), OWN_TEXT_EDIT, late))).toBe('EDIT_WINDOW_CLOSED');
    expect(
      await code(edit(item.id, await updatedAtOf(item.id), OWN_TEXT_EDIT, new Date(NOW.getTime() + 24 * HOUR))),
    ).toBe('ok');
  });

  it('daily content: the note (and the entry) change; dua: message, name, privacy', async () => {
    const daily = await publishDailyContent(adm(), own, {
      masjidId: ALPHA,
      daily: { libraryId: HADITH, note: 'Test note', notify: false },
      now: NOW,
    });
    await editItem(adm(), own, {
      masjidId: ALPHA,
      itemId: idOf(daily.item.id),
      ifMatch: await updatedAtOf(daily.item.id),
      edit: { type: 'daily_content', daily: { libraryId: HADITH_2 } },
      now: NOW,
    });
    expect((await raw('items').findOne({ _id: idOf(daily.item.id) }))?.['daily']).toEqual({
      library_id: HADITH_2,
      kind: 'hadith',
    });
    const dua = await publishDuaRequest(adm(), own, {
      masjidId: ALPHA,
      dua: {
        category: 'illness',
        message: 'Test message',
        locale: 'en',
        namePrivate: true,
        libraryId: SHIFA,
        notify: false,
      },
      now: NOW,
    });
    await editItem(adm(), own, {
      masjidId: ALPHA,
      itemId: idOf(dua.item.id),
      ifMatch: await updatedAtOf(dua.item.id),
      edit: {
        type: 'dua_request',
        dua: {
          category: 'illness',
          message: 'Test edited message',
          locale: 'hi',
          personName: 'Testperson Private',
          namePrivate: true,
          libraryId: SHIFA,
        },
      },
      now: NOW,
    });
    expect(await raw('items').findOne({ _id: idOf(dua.item.id) })).toMatchObject({
      body: 'Test edited message',
      content_locale: 'hi',
      dua: { person_name: 'Testperson Private', name_private: true },
    });
    const read = await getPublicItem(pub(), dua.item.publicId, ['everyone']);
    expect(JSON.stringify(read)).not.toContain('Testperson Private');
  });

  it('refuses another type, a timing update, a deleted or removed post, another masjid', async () => {
    const item = await notice();
    const ifMatch = await updatedAtOf(item.id);
    expect(
      await code(
        editItem(adm(), own, {
          masjidId: ALPHA,
          itemId: idOf(item.id),
          ifMatch,
          edit: { type: 'daily_content', daily: { libraryId: HADITH } },
          now: NOW,
        }),
      ),
    ).toBe('ITEM_NOT_EDITABLE');
    const timing = await raw('items').findOne({ masjid_id: ALPHA, type: 'timing_update', status: 'published' });
    if (timing) {
      expect(
        await code(
          editItem(adm(), own, {
            masjidId: ALPHA,
            itemId: timing._id as UUID,
            ifMatch: (timing['updated_at'] as Date).toISOString(),
            edit: { type: 'announcement', announcement: OWN_TEXT_EDIT },
            now: NOW,
          }),
        ),
      ).toBe('ITEM_NOT_EDITABLE');
    }
    await raw('items').updateOne(
      { _id: idOf(item.id) },
      { $set: { status: 'removed', removed_at: NOW, removed_reason: 'Test reason' } },
    );
    expect(await code(edit(item.id, ifMatch))).toBe('ITEM_NOT_FOUND');
    expect(await code(deleteItem(adm(), own, { masjidId: ALPHA, itemId: idOf(item.id), now: NOW }))).toBe(
      'ITEM_NOT_FOUND',
    );
    expect(await raw('items').findOne({ _id: idOf(item.id) })).toMatchObject({ status: 'removed' });
    expect(await code(edit(idText(newId()), ifMatch))).toBe('ITEM_NOT_FOUND');
    expect(
      await code(
        editItem(adm(), own, {
          masjidId: BETA,
          itemId: idOf(item.id),
          ifMatch,
          edit: { type: 'announcement', announcement: OWN_TEXT_EDIT },
          now: NOW,
        }),
      ),
    ).toBe('MASJID_NOT_FOUND');
  });
});

describe('deleteItem', () => {
  it('soft delete: status, deleted_at, purge marker in 180 days, version bump, audit; musallis no longer see it', async () => {
    const item = await notice();
    const before = await version(ALPHA);
    const at = new Date(NOW.getTime() + 30 * 24 * HOUR); // any age
    await deleteItem(adm(), own, { masjidId: ALPHA, itemId: idOf(item.id), now: at });
    expect(await raw('items').findOne({ _id: idOf(item.id) })).toMatchObject({
      status: 'deleted',
      deleted_at: at,
      purge_after: new Date(at.getTime() + 180 * 24 * HOUR),
    });
    expect(await version(ALPHA)).toBe(before + 1);
    expect(await raw('audit_log').findOne({ action: 'item.delete', target_id: item.id })).toMatchObject({
      meta: { type: 'announcement' },
    });
    expect(await getPublicItem(pub(), item.publicId, ['everyone'])).toBeNull();
    // Again: nothing changes (no second bump, no second audit entry).
    await deleteItem(adm(), own, { masjidId: ALPHA, itemId: idOf(item.id), now: at });
    expect(await version(ALPHA)).toBe(before + 1);
    expect(await raw('audit_log').countDocuments({ action: 'item.delete', target_id: item.id })).toBe(1);
    expect(await code(edit(item.id, await updatedAtOf(item.id)))).toBe('ITEM_NOT_FOUND');
  });
});

describe('listItemsForAdmin', () => {
  it('every status, newest first, with the edit window, the private name, the removal reason; filters; pages', async () => {
    const fresh = await notice(new Date(NOW.getTime() + 5 * HOUR));
    const dua = await publishDuaRequest(adm(), own, {
      masjidId: ALPHA,
      dua: {
        category: 'illness',
        message: 'Test message',
        locale: 'en',
        personName: 'Testperson Private',
        namePrivate: true,
        libraryId: SHIFA,
        notify: false,
      },
      now: new Date(NOW.getTime() + 6 * HOUR),
    });
    const at = new Date(NOW.getTime() + 7 * HOUR);
    const page = await listItemsForAdmin(adm(), own, ALPHA, { now: at });
    expect(page.rows[0]).toMatchObject({
      id: dua.item.id,
      status: 'published',
      privateName: 'Testperson Private',
      editableUntil: new Date(NOW.getTime() + 30 * HOUR).toISOString(),
      libraryId: idText(SHIFA),
      item: { type: 'dua_request', dua: { namePrivate: true, library: { id: idText(SHIFA) } } },
    });
    expect(page.rows[0]?.item.dua).not.toHaveProperty('personName');
    expect(page.rows[1]).toMatchObject({ id: fresh.id, item: { title: 'Test notice title' } });
    expect(page.rows.map((row) => row.status)).toEqual(expect.arrayContaining(['published', 'deleted', 'removed']));
    const removed = page.rows.find((row) => row.status === 'removed');
    expect(removed).toMatchObject({ removedReason: 'Test reason' });
    expect(removed?.item).not.toHaveProperty('title');
    // An old post is no longer editable; a timing update never is.
    const late = await listItemsForAdmin(adm(), own, ALPHA, { now: new Date(NOW.getTime() + 40 * HOUR) });
    expect(late.rows.find((row) => row.id === fresh.id)).not.toHaveProperty('editableUntil');
    const timings = await listItemsForAdmin(adm(), own, ALPHA, { type: 'timing_update', now: at });
    expect(timings.rows.every((row) => row.item.type === 'timing_update' && row.editableUntil === undefined)).toBe(
      true,
    );
    const deleted = await listItemsForAdmin(adm(), own, ALPHA, { status: 'deleted', now: at });
    expect(deleted.rows.length).toBeGreaterThan(0);
    expect(deleted.rows.every((row) => row.status === 'deleted' && row.deletedAt !== undefined)).toBe(true);
    // Pages: the seed and this file give Alpha more than one page.
    if (page.next) {
      const next = await listItemsForAdmin(adm(), own, ALPHA, { cursor: page.next, now: at });
      expect(next.rows.some((row) => page.rows.some((seen) => seen.id === row.id))).toBe(false);
    }
    expect(await code(listItemsForAdmin(adm(), own, BETA, { now: at }))).toBe('MASJID_NOT_FOUND');
    expect(await code(listItemsForAdmin(adm(), own, ALPHA, { cursor: 'nonsense', now: at }))).toBe('INVALID_CURSOR');
  });
});
