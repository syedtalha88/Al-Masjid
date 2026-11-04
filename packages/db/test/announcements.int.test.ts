// PHASE_03 T3.6 — publishing a notice as the real `mc_admin` user: a template notice (params checked against the
// template), the free-text path (limits are the contract's; `content_locale` stored), a photo of the admin's own masjid
// only, the version bump and audit entry, "Notify followers" (quota count + pending outbox job, quota left), templates
// an admin may not pick (system, draft), the follower count through `v_admin_follow_audience`, and the tenant fence.
import type { Long, UUID } from 'mongodb';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { MIGRATIONS } from '../migrations/index.ts';
import type { DbHandle } from '../src/client.ts';
import { StateError } from '../src/effects.ts';
import { runMigrations } from '../src/migrate/index.ts';
import { countNotifyAudience, getPublicItem, listTemplatesForAdmin } from '../src/repos/index.ts';
import { adminScope, systemScope } from '../src/scope.ts';
import { buildDevSeed, seedId, writeDevSeed } from '../src/seed/index.ts';
import { type AnnouncementInput, publishAnnouncement } from '../src/state/index.ts';
import { createTestDatabase, processUserHandle, type TestDatabase } from '../src/testing/index.ts';
import { idText, newId, parseId } from '../src/values.ts';

const NOW = new Date('2026-11-04T06:30:00Z'); // 12:00 IST
const TODAY = '2026-11-04';
const ALPHA = seedId('masjid-alpha');
const BETA = seedId('masjid-beta');

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
const adminOf = (...masjids: UUID[]) =>
  adminScope({ adminId: ADMIN_ID, masjids: masjids.map((id) => ({ id, role: 'owner' as const })) });
const version = async (id: UUID) => {
  const masjid = await raw('masjids').findOne({ _id: id }, { promoteLongs: false });
  return (masjid?.['content_version'] as Long).toNumber(); // int64 by schema
};
const idOf = (text: string): UUID => {
  const id = parseId(text);
  if (!id) throw new Error(`not an id: ${text}`);
  return id;
};

const NO_WATER: AnnouncementInput = {
  content: { kind: 'template', key: 'no_water_time_range', params: { hours: { start: '10:00', end: '14:00' } } },
  category: 'facilities',
  isImportant: true,
  notify: false,
};
const OWN_TEXT: AnnouncementInput = {
  content: { kind: 'text', title: 'Test notice title', body: 'Test notice body.\nSecond line.', locale: 'te' },
  category: 'general',
  isImportant: false,
  notify: false,
};
const photoKey = (masjid: UUID) => `m/${idText(masjid)}/0b7f6c2e-1d4a-4f3b-9c8e-2a1b3c4d5e6f`;

const publish = (announcement: AnnouncementInput, masjidId = ALPHA) =>
  publishAnnouncement(adm(), adminOf(ALPHA), { masjidId, announcement, now: NOW });

beforeAll(async () => {
  test = await createTestDatabase('announcement-state');
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

describe('publishAnnouncement', () => {
  it('a template notice: stored shape, version bump, audit entry; musallis can read it', async () => {
    const before = await version(ALPHA);
    const result = await publish(NO_WATER);
    expect(result.quotaLeft).toBeNull();
    const item = await raw('items').findOne({ _id: idOf(result.item.id) }, { promoteLongs: false });
    expect(item).toMatchObject({
      public_id: result.item.publicId,
      masjid_id: ALPHA,
      type: 'announcement',
      status: 'published',
      audience: 'everyone',
      template_key: 'no_water_time_range',
      template_params: { hours: { start: '10:00', end: '14:00' } },
      is_important: true,
      notify: false,
      masjid_visible: true,
      announcement: { category: 'facilities' },
      created_by: ADMIN_ID,
      published_at: NOW,
    });
    expect(item).not.toHaveProperty('title');
    expect(item).not.toHaveProperty('image_key');
    expect((item?.['published_version'] as Long).toNumber()).toBe(before + 1);
    expect(await version(ALPHA)).toBe(before + 1);
    expect(await raw('audit_log').findOne({ action: 'item.publish', target_id: result.item.id })).toMatchObject({
      masjid_id: ALPHA,
      meta: { type: 'announcement', template: 'no_water_time_range', notify: false, image: false },
    });
    expect(await raw('notification_jobs').countDocuments({ item_id: item?._id })).toBe(0);
    const read = await getPublicItem(pub(), result.item.publicId, ['everyone']);
    expect(read?.item).toMatchObject({ templateKey: 'no_water_time_range', isImportant: true });
  });

  it('own text: title, body and content_locale stored; an event time and a photo of the own masjid', async () => {
    const eventAt = new Date('2026-11-10T13:30:00Z');
    const result = await publish({
      ...OWN_TEXT,
      category: 'event',
      eventAt,
      image: { key: photoKey(ALPHA), thumbhash: 'AAAA', rightsConfirmed: true },
    });
    expect(await raw('items').findOne({ _id: idOf(result.item.id) })).toMatchObject({
      title: 'Test notice title',
      body: 'Test notice body.\nSecond line.',
      content_locale: 'te',
      announcement: { category: 'event', event_at: eventAt },
      image_key: photoKey(ALPHA),
      image_thumbhash: 'AAAA',
      rights_confirmed: true,
    });
    expect(await raw('audit_log').findOne({ action: 'item.publish', target_id: result.item.id })).toMatchObject({
      meta: { template: null, image: true },
    });
  });

  it('notify: a pending outbox job, the quota counted, notifications left returned', async () => {
    const quotaId = `${idText(ALPHA)}:${TODAY}`;
    const usedBefore = (await raw('push_quota_usage').findOne({ _id: quotaId }))?.['count'] ?? 0;
    const result = await publish({ ...NO_WATER, notify: true });
    expect(result.quotaLeft).toBe(8 - (Number(usedBefore) + 1));
    expect(await raw('push_quota_usage').findOne({ _id: quotaId })).toMatchObject({ count: Number(usedBefore) + 1 });
    expect(await raw('notification_jobs').findOne({ item_id: idOf(result.item.id) })).toMatchObject({
      masjid_id: ALPHA,
      status: 'pending',
      audience: 'everyone',
      audience_targets: ['brothers', 'sisters'],
    });
  });

  it('no notifications left: NOTIFY_QUOTA_EXCEEDED and nothing is published', async () => {
    const count = await raw('items').countDocuments({ masjid_id: ALPHA });
    const before = await version(ALPHA);
    await raw('masjids').updateOne({ _id: ALPHA }, { $set: { push_daily_quota: 0 } });
    try {
      expect(await code(publish({ ...NO_WATER, notify: true }))).toBe('NOTIFY_QUOTA_EXCEEDED');
      expect(await raw('items').countDocuments({ masjid_id: ALPHA })).toBe(count);
      expect(await version(ALPHA)).toBe(before);
      // The admin can still publish without notifying (00 §4.3).
      expect(await code(publish(NO_WATER))).toBe('ok');
    } finally {
      await raw('masjids').updateOne({ _id: ALPHA }, { $set: { push_daily_quota: 8 } });
    }
  });

  it('refuses params that do not fit the template — nothing written', async () => {
    const count = await raw('items').countDocuments({ masjid_id: ALPHA });
    const template = (params: Record<string, string | number | { start: string; end: string }>) =>
      publish({ ...NO_WATER, content: { kind: 'template', key: 'no_water_time_range', params } });
    expect(await code(template({}))).toBe('ANNOUNCEMENT_INVALID'); // required param missing
    expect(await code(template({ hours: '10:00' }))).toBe('ANNOUNCEMENT_INVALID'); // not a range
    expect(await code(template({ hours: { start: '10:00', end: '25:00' } }))).toBe('ANNOUNCEMENT_INVALID');
    expect(await code(template({ hours: { start: '10:00', end: '14:00' }, extra: 'x' }))).toBe('ANNOUNCEMENT_INVALID');
    expect(await raw('items').countDocuments({ masjid_id: ALPHA })).toBe(count);
  });

  it('refuses system, draft and unknown templates (TEMPLATE_NOT_FOUND)', async () => {
    const key = (name: string) => publish({ ...NO_WATER, content: { kind: 'template', key: name, params: {} } });
    expect(await code(key('timings_updated'))).toBe('TEMPLATE_NOT_FOUND'); // system
    expect(await code(key('no_such_template'))).toBe('TEMPLATE_NOT_FOUND');
    await raw('notice_templates').updateOne({ _id: 'general_thanks' }, { $set: { status: 'draft' } });
    try {
      expect(await code(key('general_thanks'))).toBe('TEMPLATE_NOT_FOUND');
    } finally {
      await raw('notice_templates').updateOne({ _id: 'general_thanks' }, { $set: { status: 'active' } });
    }
    expect(await code(key('general_thanks'))).toBe('ok');
  });

  it("refuses another masjid's photo and an event time out of range", async () => {
    const image = { key: photoKey(BETA), thumbhash: 'AAAA', rightsConfirmed: true as const };
    expect(await code(publish({ ...OWN_TEXT, image }))).toBe('ANNOUNCEMENT_INVALID');
    const event = (at: string) => publish({ ...OWN_TEXT, category: 'event', eventAt: new Date(at) });
    expect(await code(event('2026-11-02T06:00:00Z'))).toBe('ANNOUNCEMENT_INVALID'); // more than a day ago
    expect(await code(event('2027-12-10T06:00:00Z'))).toBe('ANNOUNCEMENT_INVALID'); // over 400 days ahead
    expect(await code(event('2026-11-03T12:00:00Z'))).toBe('ok');
  });

  it('another masjid reads as unknown', async () => {
    expect(await code(publish(NO_WATER, BETA))).toBe('MASJID_NOT_FOUND');
    expect(await code(listTemplatesForAdmin(adm(), adminOf(ALPHA), BETA))).toBe('MASJID_NOT_FOUND');
    expect(await code(countNotifyAudience(adm(), adminOf(ALPHA), BETA, 'everyone'))).toBe('MASJID_NOT_FOUND');
  });
});

describe('listTemplatesForAdmin', () => {
  it('lists active, pickable templates only — no system or draft ones', async () => {
    await raw('notice_templates').updateOne({ _id: 'lost_and_found' }, { $set: { status: 'draft' } });
    try {
      const keys = (await listTemplatesForAdmin(adm(), adminOf(ALPHA), ALPHA)).map((entry) => entry.key);
      expect(keys).toContain('no_water_time_range');
      expect(keys).not.toContain('timings_updated');
      expect(keys).not.toContain('special_timings');
      expect(keys).not.toContain('lost_and_found');
    } finally {
      await raw('notice_templates').updateOne({ _id: 'lost_and_found' }, { $set: { status: 'active' } });
    }
  });
});

describe('countNotifyAudience', () => {
  it('counts follows with notifications on and not muted, by Brother/Sister choice', async () => {
    const follow = (prefs: { muted?: boolean; push?: boolean; pref: 'brothers' | 'sisters' }) => ({
      _id: newId(),
      device_id: newId(),
      masjid_id: BETA,
      muted: prefs.muted ?? false,
      audience_pref: prefs.pref,
      locale: 'en',
      push_active: prefs.push ?? true,
      created_at: NOW,
    });
    const betaAdmin = adminOf(BETA);
    const base = {
      everyone: await countNotifyAudience(adm(), betaAdmin, BETA, 'everyone'),
      sisters: await countNotifyAudience(adm(), betaAdmin, BETA, 'sisters'),
    };
    await raw('device_follows').insertMany([
      follow({ pref: 'brothers' }),
      follow({ pref: 'sisters' }),
      follow({ pref: 'sisters' }),
      follow({ pref: 'brothers', muted: true }),
      follow({ pref: 'sisters', push: false }),
    ]);
    expect(await countNotifyAudience(adm(), betaAdmin, BETA, 'everyone')).toBe(base.everyone + 3);
    expect(await countNotifyAudience(adm(), betaAdmin, BETA, 'sisters')).toBe(base.sisters + 2);
  });
});
