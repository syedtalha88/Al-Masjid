// PHASE_03 T3.10 — Masjid Profile as the real `mc_admin` user: the profile read (names, photo, offsets), changing the
// photo and the Hijri offset (version bump, audit, `null` back to the app's), and — the acceptance — **the admin
// `masjids` cell's field allow-list refuses everything else**: other fields, dotted paths, operator-shaped values and
// keys, other operators. "Request change" notes reach the Super Admin dashboard until the masjid is next edited. Fake
// texts only (10 §Fixtures).
import type { Long, UUID } from 'mongodb';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { MIGRATIONS } from '../migrations/index.ts';
import type { DbHandle } from '../src/client.ts';
import { StateError } from '../src/effects.ts';
import { runMigrations } from '../src/migrate/index.ts';
import { PolicyDeniedError } from '../src/policy.ts';
import { getMasjidProfile, listChangeRequests } from '../src/repos/index.ts';
import { adminScope, superScope, systemScope } from '../src/scope.ts';
import { scoped } from '../src/scoped.ts';
import { buildDevSeed, seedId, writeDevSeed } from '../src/seed/index.ts';
import { requestMasjidChange, updateMasjid, updateMasjidProfile } from '../src/state/index.ts';
import { createTestDatabase, processUserHandle, type TestDatabase } from '../src/testing/index.ts';
import { idText, newId } from '../src/values.ts';

const NOW = new Date('2026-11-04T06:30:00Z');
const TODAY = '2026-11-04';
const ALPHA = seedId('masjid-alpha');
const BETA = seedId('masjid-beta');

let test: TestDatabase | undefined;
let asAdmin: Awaited<ReturnType<typeof processUserHandle>> | undefined;
let asSystem: Awaited<ReturnType<typeof processUserHandle>> | undefined;
const t = () => {
  if (!test) throw new Error('no test database');
  return test;
};
const adm = (): DbHandle => {
  if (!asAdmin) throw new Error('no mc_admin handle');
  return asAdmin.handle;
};
const raw = (name: string) => t().db.collection<{ _id: UUID | string } & Record<string, unknown>>(name);
const code = async (promise: Promise<unknown>) => {
  try {
    await promise;
    return 'ok';
  } catch (error) {
    if (error instanceof StateError) return error.code;
    if (error instanceof PolicyDeniedError) return 'denied';
    throw error;
  }
};
const own = adminScope({ adminId: newId(), masjids: [{ id: ALPHA, role: 'owner' }] });
const SUPER = superScope(newId());
const version = async (id: UUID) => {
  const masjid = await raw('masjids').findOne({ _id: id }, { promoteLongs: false });
  return (masjid?.['content_version'] as Long).toNumber(); // int64 by schema
};
const photoKey = (masjid: UUID) => `m/${idText(masjid)}/0b7f6c2e-1d4a-4f3b-9c8e-2a1b3c4d5e6f`;

beforeAll(async () => {
  test = await createTestDatabase('profile-state');
  await runMigrations(t().db, MIGRATIONS);
  asAdmin = await processUserHandle(t(), 'mc_admin');
  asSystem = await processUserHandle(t(), 'mc_system');
  await writeDevSeed(asSystem.handle, systemScope(), buildDevSeed({ now: NOW, today: TODAY }));
});

afterAll(async () => {
  await asAdmin?.dispose();
  await asSystem?.dispose();
  await test?.dispose();
});

describe('getMasjidProfile', () => {
  it('names in four scripts, place, photo, offsets; another masjid reads as unknown', async () => {
    const profile = await getMasjidProfile(adm(), own, ALPHA);
    expect(profile?.id).toBe(idText(ALPHA));
    expect(typeof profile?.globalHijriOffset).toBe('number');
    expect(profile?.name).not.toBe('');
    expect(await code(getMasjidProfile(adm(), own, BETA))).toBe('MASJID_NOT_FOUND');
  });
});

describe('updateMasjidProfile', () => {
  it('photo and Hijri offset: written, version bump, audit; null follows the app again', async () => {
    const before = await version(ALPHA);
    const fields = await updateMasjidProfile(adm(), own, {
      masjidId: ALPHA,
      patch: { photo: { key: photoKey(ALPHA), thumbhash: 'AAAA' }, hijriOffset: -1 },
    });
    expect(fields).toEqual(['photo_key', 'photo_thumbhash', 'hijri_offset']);
    expect(await raw('masjids').findOne({ _id: ALPHA })).toMatchObject({
      photo_key: photoKey(ALPHA),
      photo_thumbhash: 'AAAA',
      hijri_offset: -1,
    });
    expect(await version(ALPHA)).toBe(before + 1);
    expect(await raw('audit_log').findOne({ action: 'masjid.profile', masjid_id: ALPHA })).toMatchObject({
      meta: { fields: ['photo_key', 'photo_thumbhash', 'hijri_offset'] },
    });
    await updateMasjidProfile(adm(), own, { masjidId: ALPHA, patch: { hijriOffset: null } });
    expect(await raw('masjids').findOne({ _id: ALPHA })).not.toHaveProperty('hijri_offset');
    expect((await getMasjidProfile(adm(), own, ALPHA))?.hijriOffset).toBeNull();
  });

  it("refuses another masjid's photo, an offset outside −2…+2, an empty change, another masjid", async () => {
    const patch = (value: Parameters<typeof updateMasjidProfile>[2]['patch'], masjidId = ALPHA) =>
      updateMasjidProfile(adm(), own, { masjidId, patch: value });
    expect(await code(patch({ photo: { key: photoKey(BETA), thumbhash: 'AAAA' } }))).toBe('PROFILE_INVALID');
    expect(await code(patch({ hijriOffset: 3 }))).toBe('PROFILE_INVALID');
    expect(await code(patch({ hijriOffset: 0.5 }))).toBe('PROFILE_INVALID');
    expect(await code(patch({}))).toBe('PROFILE_INVALID');
    expect(await code(patch({ hijriOffset: 1 }, BETA))).toBe('MASJID_NOT_FOUND');
  });
});

describe('the admin masjids cell (T3.10 acceptance): only the allowed fields', () => {
  it('refuses other fields, dotted paths, operator-shaped values and keys, other operators', async () => {
    const before = await raw('masjids').findOne({ _id: ALPHA });
    const write = async (update: Record<string, unknown>) =>
      code(scoped({ scope: own, db: await adm().db() }, 'masjids').updateOne({ _id: ALPHA }, update));
    for (const update of [
      { $set: { name: 'Test renamed masjid' } },
      { $set: { status: 'active' } },
      { $set: { push_daily_quota: 1000 } },
      { $set: { 'name_i18n.ur': 'Test name' } },
      { $set: { name_i18n: { ur: 'Test name' } } },
      { $set: { 'photo_key.$': 'x' } },
      { $set: { photo_key: { $gt: '' } } },
      { $set: { $where: 'true' } },
      { $unset: { follow_code: '' } },
      { $inc: { content_version: 1 } },
      { $rename: { photo_key: 'name' } },
      { $currentDate: { updated_at: true } },
      { name: 'Test replacement document' },
    ]) {
      expect(await write(update), JSON.stringify(update)).toBe('denied');
    }
    expect(await raw('masjids').findOne({ _id: ALPHA })).toEqual(before);
  });
});

describe('Request change', () => {
  it('reaches the Super Admin dashboard and closes when the Super Admin next edits the masjid', async () => {
    await requestMasjidChange(adm(), own, { masjidId: ALPHA, note: 'Test note: the Urdu name needs a fix.' });
    const open = await listChangeRequests(adm(), SUPER, { now: new Date() });
    expect(open[0]).toMatchObject({ masjidId: idText(ALPHA), note: 'Test note: the Urdu name needs a fix.' });
    expect(open[0]?.masjidName).toEqual(expect.any(String));
    await updateMasjid(adm(), SUPER, { masjidId: ALPHA, patch: { area: 'Test Area Edited' } });
    expect(
      (await listChangeRequests(adm(), SUPER, { now: new Date() })).some((row) => row.masjidId === idText(ALPHA)),
    ).toBe(false);
    expect(await code(requestMasjidChange(adm(), own, { masjidId: BETA, note: 'Test note' }))).toBe('MASJID_NOT_FOUND');
    expect(await code(listChangeRequests(adm(), own, { now: new Date() }))).toBe('FORBIDDEN');
  });
});
