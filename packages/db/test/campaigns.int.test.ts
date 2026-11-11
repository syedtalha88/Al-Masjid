// PHASE_05 T5.3 — donation campaigns as the real `mc_admin` / `mc_system` users: create needs the masjid's active UPI
// details (their id is recorded) and fewer than 3 active campaigns (also when creates race); every rule of the input is
// checked; edits raise the target only; "Update amount" writes an append-only history row; completed; the daily close.
// Fake titles and amounts only.
import { Long, UUID } from 'mongodb';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { MIGRATIONS } from '../migrations/index.ts';
import type { DbHandle } from '../src/client.ts';
import { StateError } from '../src/effects.ts';
import { runMigrations } from '../src/migrate/index.ts';
import { getMasjidBundle, listCampaignsForAdmin, listFeed } from '../src/repos/index.ts';
import { adminScope, systemScope } from '../src/scope.ts';
import { buildDevSeed, seedId, writeDevSeed } from '../src/seed/index.ts';
import {
  type CampaignInput,
  closeEndedCampaigns,
  completeCampaign,
  createCampaign,
  getPushContent,
  setCampaignReceived,
  updateCampaign,
} from '../src/state/index.ts';
import { createTestDatabase, processUserHandle, type TestDatabase } from '../src/testing/index.ts';
import { idText, newId, parseId } from '../src/values.ts';

const NOW = new Date('2026-11-10T06:30:00Z');
const TODAY = '2026-11-10';
const ALPHA = seedId('masjid-alpha');
const BETA = seedId('masjid-beta');
const GAMMA = seedId('masjid-gamma');

let test: TestDatabase | undefined;
const handles: Partial<Record<'admin' | 'system' | 'public', Awaited<ReturnType<typeof processUserHandle>>>> = {};
const t = () => {
  if (!test) throw new Error('no test database');
  return test;
};
const as = (user: 'admin' | 'system' | 'public'): DbHandle => {
  const entry = handles[user];
  if (!entry) throw new Error(`no ${user} handle`);
  return entry.handle;
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
const idOf = (text: string) => {
  const id = parseId(text);
  if (!id) throw new Error(`not an id: ${text}`);
  return id;
};
const version = async (id: UUID) =>
  ((await raw('masjids').findOne({ _id: id }, { promoteLongs: false }))?.['content_version'] as Long).toNumber(); // int64
const campaign = (overrides: Partial<CampaignInput> = {}): CampaignInput => ({
  title: 'Test roof repair',
  description: 'Placeholder description',
  purpose: 'repair',
  targetPaise: 10_000_000,
  startsOn: TODAY,
  ...overrides,
});
const create = (masjid: UUID, input = campaign(), scope = adminOf(masjid)) =>
  createCampaign(as('admin'), scope, { masjidId: masjid, campaign: input, notify: false, now: NOW });
const profileId = newId();

beforeAll(async () => {
  test = await createTestDatabase('campaigns-state');
  await runMigrations(t().db, MIGRATIONS);
  handles.admin = await processUserHandle(t(), 'mc_admin');
  handles.system = await processUserHandle(t(), 'mc_system');
  handles.public = await processUserHandle(t(), 'mc_public');
  await writeDevSeed(as('system'), systemScope(), buildDevSeed({ now: NOW, today: TODAY }));
  // Active UPI details for Alpha and Gamma (the change-lock itself is payment.int.test.ts).
  for (const [masjid, id] of [
    [ALPHA, profileId],
    [GAMMA, newId()],
  ] as const) {
    await raw('payment_profiles').insertOne({
      _id: id,
      masjid_id: masjid,
      vpa: 'test.masjid@okbank',
      payee_name: 'Test Masjid Committee',
      status: 'active',
      open: false,
      requested_by: newId(),
      effective_at: NOW,
      masjid_visible: true,
      created_at: NOW,
      updated_at: NOW,
    });
  }
});

afterAll(async () => {
  for (const entry of Object.values(handles)) await entry.dispose();
  await test?.dispose();
});

describe('create', () => {
  it('records the active UPI details, starts at ₹0, bumps the version and is audited', async () => {
    const before = await version(ALPHA);
    const { item, notificationJobId } = await createCampaign(as('admin'), alpha, {
      masjidId: ALPHA,
      campaign: campaign({ endsOn: '2026-12-31' }),
      notify: false,
      requestId: 'req-camp-1',
      now: NOW,
    });
    expect(notificationJobId).toBeNull();
    expect(await version(ALPHA)).toBe(before + 1);
    const doc = await raw('items').findOne({ _id: idOf(item.id) }, { promoteLongs: false });
    expect(doc).toMatchObject({
      type: 'campaign',
      status: 'published',
      audience: 'everyone',
      title: 'Test roof repair',
      body: 'Placeholder description',
      campaign: {
        purpose: 'repair',
        target_paise: Long.fromNumber(10_000_000),
        received_paise: Long.fromNumber(0),
        starts_on: TODAY,
        ends_on: '2026-12-31',
        status: 'active',
        payment_profile_id: profileId,
      },
    });
    expect(await raw('audit_log').findOne({ action: 'campaign.create', target_id: item.id })).toMatchObject({
      request_id: 'req-camp-1',
      meta: { purpose: 'repair', notify: false },
    });
  });

  it('needs active UPI details', async () => {
    expect(await code(create(BETA))).toBe('CAMPAIGN_NO_PAYMENT');
  });

  it('refuses invalid input and other masjids', async () => {
    for (const bad of [
      campaign({ title: ' ' }),
      campaign({ title: 'x'.repeat(121) }),
      campaign({ description: 'x'.repeat(1501) }),
      campaign({ targetPaise: 99_999 }), // under ₹1,000
      campaign({ targetPaise: 1.5 }),
      campaign({ startsOn: '2026-13-01' }),
      campaign({ endsOn: '2026-11-09' }), // before the start
      campaign({ cover: { key: `m/${idText(BETA)}/i/x`, thumbhash: 'AAAA', rightsConfirmed: true } }),
    ]) {
      expect(await code(create(ALPHA, bad)), JSON.stringify(bad)).toBe('CAMPAIGN_INVALID');
    }
    expect(await code(create(ALPHA, campaign(), adminOf(BETA)))).toBe('MASJID_NOT_FOUND');
  });

  it('at most 3 active per masjid — also when creates race', async () => {
    // Gamma has none: one first, then three at once → exactly two more succeed.
    expect(await code(create(GAMMA))).toBe('ok');
    const results = await Promise.all(
      [1, 2, 3].map((n) => code(create(GAMMA, campaign({ title: `Race ${String(n)}` })))),
    );
    expect(results.filter((result) => result === 'ok')).toHaveLength(2);
    expect(results.filter((result) => result === 'CAMPAIGN_LIMIT_REACHED')).toHaveLength(1);
    expect(await raw('items').countDocuments({ masjid_id: GAMMA, type: 'campaign', 'campaign.status': 'active' })).toBe(
      3,
    );
  });
});

describe('update amount, edit, complete, close', () => {
  let itemId = new UUID();
  beforeAll(async () => {
    const { item } = await create(ALPHA, campaign({ title: 'Test water tank', endsOn: '2026-11-20' }));
    itemId = idOf(item.id);
  });
  const received = (receivedPaise: number, at = NOW) =>
    setCampaignReceived(as('admin'), alpha, { masjidId: ALPHA, itemId, receivedPaise, notify: false, now: at });

  it('"Update amount" sets the amount and appends a history row with who and when', async () => {
    await received(7_200_000);
    await received(7_500_050, new Date(NOW.getTime() + 60_000));
    const doc = await raw('items').findOne({ _id: itemId }, { promoteLongs: false });
    expect(doc?.['campaign']).toMatchObject({
      received_paise: Long.fromNumber(7_500_050),
      received_updated_by: alpha.adminId,
      received_updated_at: new Date(NOW.getTime() + 60_000),
    });
    const history = await raw('campaign_amount_history')
      .find({ campaign_item_id: itemId }, { sort: { created_at: 1 }, promoteLongs: false })
      .toArray();
    expect(history.map((row) => (row['received_paise'] as Long).toNumber())).toEqual([7_200_000, 7_500_050]);
    expect(history.every((row) => (row['updated_by'] as UUID).equals(alpha.adminId))).toBe(true);
    expect(await code(received(-1))).toBe('CAMPAIGN_INVALID');
    expect(await code(received(0.5))).toBe('CAMPAIGN_INVALID');
    // Above the target is fine: the text shows the real value (00 §4.3).
    expect(await code(received(12_000_000))).toBe('ok');
  });

  it('the notification content carries the goal and the reported amount (T5.6 push text)', async () => {
    const content = await getPushContent(as('system'), systemScope(), itemId);
    expect(content).toMatchObject({
      type: 'campaign',
      title: 'Test water tank',
      campaign: { targetPaise: campaign().targetPaise, receivedPaise: 12_000_000 },
      chanda: undefined,
    });
  });

  it('edits raise the target only; a lower one is refused', async () => {
    const edit = (patch: Parameters<typeof updateCampaign>[2]['patch']) =>
      code(updateCampaign(as('admin'), alpha, { masjidId: ALPHA, itemId, patch, now: NOW }));
    expect(await edit({ targetPaise: 9_000_000 })).toBe('CAMPAIGN_TARGET_LOWER');
    expect(await edit({ targetPaise: 20_000_000, title: 'Test water tank (bigger)' })).toBe('ok');
    expect(await edit({})).toBe('NOTHING_TO_UPDATE');
    expect(await edit({ endsOn: '2026-01-01' })).toBe('CAMPAIGN_INVALID');
    const doc = await raw('items').findOne({ _id: itemId }, { promoteLongs: false });
    expect(doc).toMatchObject({
      title: 'Test water tank (bigger)',
      campaign: { target_paise: Long.fromNumber(20_000_000) },
    });
    expect(await raw('audit_log').findOne({ action: 'campaign.update', target_id: idText(itemId) })).toMatchObject({
      meta: { target_raised: true },
    });
  });

  it('mark completed: then edits stop, the amount can still be updated', async () => {
    await completeCampaign(as('admin'), alpha, { masjidId: ALPHA, itemId, now: NOW });
    expect(await code(completeCampaign(as('admin'), alpha, { masjidId: ALPHA, itemId, now: NOW }))).toBe(
      'CAMPAIGN_NOT_ACTIVE',
    );
    expect(
      await code(updateCampaign(as('admin'), alpha, { masjidId: ALPHA, itemId, patch: { title: 'x' }, now: NOW })),
    ).toBe('CAMPAIGN_NOT_ACTIVE');
    expect(await code(received(13_000_000))).toBe('ok');
  });

  it('the daily job closes campaigns whose end date has passed; closed ones take no more amounts', async () => {
    expect(await code(closeEndedCampaigns(as('admin'), alpha, { today: '2026-11-21' }))).toBe('FORBIDDEN');
    expect(await closeEndedCampaigns(as('system'), systemScope(), { today: '2026-11-20' })).toBe(0); // ends today: open
    const before = await version(ALPHA);
    // This one and the dev seed's completed Delta campaign (it ends 10 days after the seed's today).
    expect(await closeEndedCampaigns(as('system'), systemScope(), { today: '2026-11-21' })).toBe(2);
    expect(await version(ALPHA)).toBe(before + 1);
    expect((await raw('items').findOne({ _id: itemId }))?.['campaign']).toMatchObject({ status: 'closed' });
    expect(await code(received(14_000_000))).toBe('CAMPAIGN_CLOSED');
    expect(await closeEndedCampaigns(as('system'), systemScope(), { today: '2026-11-21' })).toBe(0); // idempotent
  });
});

describe('admin list (B8)', () => {
  it('active first, then completed, then closed; amounts as numbers; other masjids refused', async () => {
    const { campaigns } = await listCampaignsForAdmin(as('admin'), alpha, ALPHA);
    const statuses = campaigns.map((row) => row.status);
    expect(statuses).toEqual(
      [...statuses].sort(
        (a, b) => ['active', 'completed', 'closed'].indexOf(a) - ['active', 'completed', 'closed'].indexOf(b),
      ),
    );
    expect(campaigns.find((row) => row.title === 'Test water tank (bigger)')).toMatchObject({
      status: 'closed',
      targetPaise: 20_000_000,
      receivedPaise: 13_000_000,
      endsOn: '2026-11-20',
    });
    expect(await code(listCampaignsForAdmin(as('admin'), adminOf(BETA), ALPHA))).toBe('MASJID_NOT_FOUND');
  });
});

describe('public reads (A10, T5.4)', () => {
  it('the bundle lists the active campaigns only, newest first, with the live UPI details; the feed has them all', async () => {
    const later = await createCampaign(as('admin'), alpha, {
      masjidId: ALPHA,
      campaign: campaign({ title: 'Test fans' }),
      notify: false,
      now: new Date(NOW.getTime() + 3_600_000),
    });
    const bundle = await getMasjidBundle(as('public'), ALPHA, TODAY);
    if (bundle?.status !== 'active') throw new Error('expected an active bundle');
    const { items } = await listFeed(as('public'), ALPHA, { type: 'campaign', audiences: ['everyone', 'brothers'] });
    const byTitle = new Map(items.map((item) => [item.title, item]));
    const roof = byTitle.get('Test roof repair');
    // Active, newest first; the closed "water tank" is not in the summary.
    expect(bundle.campaigns).toEqual([{ publicId: later.item.publicId }, { publicId: roof?.publicId }]);
    expect(bundle.payment).toEqual({
      vpa: 'test.masjid@okbank',
      payeeName: 'Test Masjid Committee',
      effectiveAt: NOW.toISOString(),
    });
    expect(byTitle.get('Test water tank (bigger)')?.campaign).toMatchObject({
      status: 'closed',
      purpose: 'repair',
      targetPaise: 20_000_000,
      receivedPaise: 13_000_000,
      startsOn: TODAY,
      endsOn: '2026-11-20',
    });
    // The admin who updated the amount and the UPI snapshot id stay inside.
    const json = JSON.stringify(items);
    expect(json).not.toContain('received_updated_by');
    expect(json).not.toContain('payment_profile_id');
  });
});
