// PHASE_03 T3.13 part 2 — voice notes on posts as the real `mc_admin` user: a recording from `POST /audio` on a notice,
// a hadith / ayah and a dua request, always with a title (the notice's own, or `title`); the masjid's own recordings
// only; musallis read `voice` (key, length, peaks); an edit can remove it; and the MongoDB validator itself refuses a
// voice note without a title or on another type (migration 0011). Placeholder library entries, fake texts only.
import type { UUID } from 'mongodb';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { MIGRATIONS } from '../migrations/index.ts';
import type { DbHandle } from '../src/client.ts';
import { StateError } from '../src/effects.ts';
import { runMigrations } from '../src/migrate/index.ts';
import { getPublicItem } from '../src/repos/index.ts';
import { adminScope, systemScope } from '../src/scope.ts';
import { buildDevSeed, seedId, writeDevSeed } from '../src/seed/index.ts';
import {
  type AnnouncementInput,
  editItem,
  publishAnnouncement,
  publishDailyContent,
  publishDuaRequest,
} from '../src/state/index.ts';
import { createTestDatabase, processUserHandle, type TestDatabase } from '../src/testing/index.ts';
import { idText, newId, newPublicId, parseId } from '../src/values.ts';

const NOW = new Date('2026-11-04T06:30:00Z');
const TODAY = '2026-11-04';
const ALPHA = seedId('masjid-alpha');
const BETA = seedId('masjid-beta');
const HADITH = seedId('library-0');
const SHIFA = seedId('library-7');
const PEAKS = Array.from({ length: 48 }, (_, index) => (index * 5) % 256);
const voiceOf = (masjid: UUID) => ({
  key: `m/${idText(masjid)}/a/0b7f6c2e-1d4a-4f3b-9c8e-2a1b3c4d5e6f`,
  durationS: 95,
  peaks: PEAKS,
});

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
const own = adminScope({ adminId: newId(), masjids: [{ id: ALPHA, role: 'owner' }] });
const idOf = (text: string): UUID => {
  const id = parseId(text);
  if (!id) throw new Error(`not an id: ${text}`);
  return id;
};
const OWN_TEXT: AnnouncementInput = {
  content: { kind: 'text', title: 'Test notice title', body: 'Test notice body.', locale: 'en' },
  category: 'general',
  isImportant: false,
  notify: false,
};
const TEMPLATE: AnnouncementInput = {
  content: { kind: 'template', key: 'no_water_time_range', params: { hours: { start: '10:00', end: '14:00' } } },
  category: 'facilities',
  isImportant: true,
  notify: false,
};
const notice = (announcement: AnnouncementInput) =>
  publishAnnouncement(adm(), own, { masjidId: ALPHA, announcement, now: NOW });

beforeAll(async () => {
  test = await createTestDatabase('voice-state');
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

describe('voice notes on posts', () => {
  it('a free-text notice uses its own title; musallis read the voice note', async () => {
    const result = await notice({ ...OWN_TEXT, voice: voiceOf(ALPHA) });
    expect(await raw('items').findOne({ _id: idOf(result.item.id) })).toMatchObject({
      title: 'Test notice title',
      voice: { key: voiceOf(ALPHA).key, duration_s: 95, peaks: PEAKS },
    });
    const read = await getPublicItem(pub(), result.item.publicId, ['everyone']);
    expect(read?.item.voice).toEqual({ key: voiceOf(ALPHA).key, durationS: 95, peaks: PEAKS });
  });

  it('a template notice, a hadith and a dua request carry it with `title`; without one → VOICE_INVALID', async () => {
    const templated = await notice({ ...TEMPLATE, voice: voiceOf(ALPHA), title: 'Test voice title' });
    expect(await raw('items').findOne({ _id: idOf(templated.item.id) })).toMatchObject({
      template_key: 'no_water_time_range',
      title: 'Test voice title',
      voice: { duration_s: 95 },
    });
    expect(await code(notice({ ...TEMPLATE, voice: voiceOf(ALPHA) }))).toBe('VOICE_INVALID');
    const daily = await publishDailyContent(adm(), own, {
      masjidId: ALPHA,
      daily: { libraryId: HADITH, voice: voiceOf(ALPHA), title: 'Test voice title', notify: false },
      now: NOW,
    });
    expect(await raw('items').findOne({ _id: idOf(daily.item.id) })).toMatchObject({ title: 'Test voice title' });
    const dua = await publishDuaRequest(adm(), own, {
      masjidId: ALPHA,
      dua: {
        category: 'illness',
        message: 'Test message',
        locale: 'en',
        namePrivate: true,
        libraryId: SHIFA,
        voice: voiceOf(ALPHA),
        title: 'Test voice title',
        notify: false,
      },
      now: NOW,
    });
    expect(await raw('items').findOne({ _id: idOf(dua.item.id) })).toMatchObject({ voice: { duration_s: 95 } });
    expect(
      await code(
        publishDailyContent(adm(), own, {
          masjidId: ALPHA,
          daily: { libraryId: HADITH, voice: voiceOf(ALPHA), notify: false },
          now: NOW,
        }),
      ),
    ).toBe('VOICE_INVALID');
  });

  it("refuses another masjid's recording", async () => {
    expect(await code(notice({ ...OWN_TEXT, voice: voiceOf(BETA) }))).toBe('VOICE_INVALID');
  });

  it('an edit can remove the voice note (unset)', async () => {
    const result = await notice({ ...OWN_TEXT, voice: voiceOf(ALPHA) });
    const stored = await raw('items').findOne({ _id: idOf(result.item.id) });
    const { notify: _notify, ...edit } = OWN_TEXT;
    await editItem(adm(), own, {
      masjidId: ALPHA,
      itemId: idOf(result.item.id),
      ifMatch: (stored?.['updated_at'] as Date).toISOString(), // a Date (validator)
      edit: { type: 'announcement', announcement: edit },
      now: NOW,
    });
    expect(await raw('items').findOne({ _id: idOf(result.item.id) })).not.toHaveProperty('voice');
  });

  it('the MongoDB validator refuses a voice note without a title, or on another type (migration 0011)', async () => {
    const base = {
      public_id: newPublicId(),
      masjid_id: ALPHA,
      status: 'published',
      audience: 'everyone',
      is_important: false,
      notify: false,
      masjid_visible: true,
      published_at: NOW,
      created_by: newId(),
      created_at: NOW,
      updated_at: NOW,
      voice: { key: voiceOf(ALPHA).key, duration_s: 95 },
    };
    const insert = async (doc: Record<string, unknown>) => {
      try {
        await raw('items').insertOne({ _id: newId(), ...doc });
        return 'ok';
      } catch (error) {
        return error instanceof Error && /validation/i.test(error.message) ? 'refused' : String(error);
      }
    };
    expect(await insert({ ...base, type: 'announcement', announcement: { category: 'general' } })).toBe('refused');
    expect(
      await insert({ ...base, type: 'timing_update', title: 'Test title', announcement: { category: 'timing' } }),
    ).toBe('refused');
    expect(
      await insert({ ...base, type: 'announcement', title: 'Test title', announcement: { category: 'general' } }),
    ).toBe('ok');
  });
});
