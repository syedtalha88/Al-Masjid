// PHASE_05 T5.8 — needy people as the real `mc_admin` / `mc_public` / `mc_system` users: a person is added only with
// consent and valid details (version bump, UPI details audited — 04 R13); the public list is least-funded first, then
// oldest, with public fields only — `private_enc` is in no public read and hidden from every generic admin / Super
// Admin read; "Update received" appends history and fulfils at the cap in one transaction, also under parallel
// requests; closed / deleted are final; the 100-person limit; the private phone / note only for the masjid's own
// admins, audited; the 90-day purge removes the person and their history. Fake people and UPI IDs only (10 §5).
import { type Long, UUID } from 'mongodb';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { MIGRATIONS } from '../migrations/index.ts';
import type { DbHandle } from '../src/client.ts';
import { StateError } from '../src/effects.ts';
import { runMigrations } from '../src/migrate/index.ts';
import { getMasjidBundle, listBeneficiariesForAdmin, listPublicBeneficiaries } from '../src/repos/index.ts';
import { BENEFICIARIES_ACTIVE_MAX, BENEFICIARY_PURGE_DAYS } from '../src/schema/index.ts';
import { adminScope, publicScope, superScope, systemScope } from '../src/scope.ts';
import { scoped } from '../src/scoped.ts';
import { buildDevSeed, seedId, writeDevSeed } from '../src/seed/index.ts';
import {
  type BeneficiaryInput,
  changeMasjidStatus,
  createBeneficiary,
  endBeneficiary,
  fundedPermille,
  purgeBeneficiaries,
  readBeneficiaryPrivate,
  setBeneficiaryReceived,
  updateBeneficiary,
} from '../src/state/index.ts';
import { createTestDatabase, processUserHandle, type TestDatabase } from '../src/testing/index.ts';
import { newId, parseId, toInt64 } from '../src/values.ts';

const NOW = new Date('2026-11-10T06:30:00Z');
const TODAY = '2026-11-10';
const DAY_MS = 24 * 60 * 60 * 1000;
const ALPHA = seedId('masjid-alpha');
const BETA = seedId('masjid-beta');
const GAMMA = seedId('masjid-gamma');
/** A well-formed ciphertext shape (the validator checks the format; the data layer never decrypts). */
const PRIVATE_ENC = `v1:k1:${'A'.repeat(16)}:${'B'.repeat(40)}`;

let test: TestDatabase | undefined;
const handles: Partial<Record<'admin' | 'system' | 'public', Awaited<ReturnType<typeof processUserHandle>>>> = {};
const t = () => {
  if (!test) throw new Error('no test database');
  return test;
};
const as = (user: 'admin' | 'system' | 'public'): DbHandle => {
  const handle = handles[user];
  if (!handle) throw new Error(`no mc_${user} handle`);
  return handle.handle;
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
  ((await raw('masjids').findOne({ _id: id }, { promoteLongs: false }))?.['content_version'] as Long).toNumber();
const person = (overrides: Partial<BeneficiaryInput> = {}): BeneficiaryInput => ({
  displayName: 'Test A.',
  category: 'widow',
  reason: 'Sample reason for development — not a real person.',
  reasonLocale: 'en',
  vpa: 'testperson@okexample',
  payeeName: 'Test Person A',
  capPaise: 300_000,
  zakatEligible: false,
  consentConfirmed: true,
  ...overrides,
});
const add = (masjid: UUID, input = person(), at = NOW, scope = adminOf(masjid)) =>
  createBeneficiary(as('admin'), scope, { masjidId: masjid, person: input, now: at });
const received = (masjid: UUID, id: string, receivedPaise: number, at = NOW) =>
  setBeneficiaryReceived(as('admin'), adminOf(masjid), { masjidId: masjid, id: idOf(id), receivedPaise, now: at });

beforeAll(async () => {
  test = await createTestDatabase('beneficiaries-state');
  await runMigrations(t().db, MIGRATIONS);
  for (const user of ['admin', 'system', 'public'] as const) handles[user] = await processUserHandle(t(), `mc_${user}`);
  await writeDevSeed(as('system'), systemScope(), buildDevSeed({ now: NOW, today: TODAY }));
});

afterAll(async () => {
  for (const handle of Object.values(handles)) await handle.dispose();
  await test?.dispose();
});

describe('fundedPermille', () => {
  it('is received ÷ cap in ‰, rounded down and capped at 1000', () => {
    expect(fundedPermille(0, 300_000)).toBe(0);
    expect(fundedPermille(120_000, 300_000)).toBe(400);
    expect(fundedPermille(299_999, 300_000)).toBe(999);
    expect(fundedPermille(300_000, 300_000)).toBe(1000);
    expect(fundedPermille(900_000, 300_000)).toBe(1000);
    expect(() => fundedPermille(1, 0)).toThrow(RangeError);
  });
});

describe('create', () => {
  it('lists the person at ₹0, bumps the version and audits the UPI details — never the name, reason or phone', async () => {
    const before = await version(ALPHA);
    const { id, publicId } = await createBeneficiary(as('admin'), alpha, {
      masjidId: ALPHA,
      person: person({ vpa: ' TestPerson@OKEXAMPLE ', displayName: '  Test A.  ' }),
      privateEnc: PRIVATE_ENC,
      requestId: 'req-needy-1',
      now: NOW,
    });
    expect(await version(ALPHA)).toBe(before + 1);
    expect(publicId).toMatch(/^[A-Za-z0-9_-]{12}$/);
    const doc = await raw('beneficiaries').findOne({ _id: idOf(id) }, { promoteLongs: false });
    expect(doc).toMatchObject({
      public_id: publicId,
      display_name: 'Test A.',
      category: 'widow',
      vpa: 'TestPerson@okexample', // the bank handle is lower-cased (normalizeVpa)
      payee_name: 'Test Person A',
      cap_paise: toInt64(300_000),
      received_paise: toInt64(0),
      funded_permille: 0,
      zakat_eligible: false,
      consent_confirmed: true,
      private_enc: PRIVATE_ENC,
      status: 'active',
      masjid_visible: true,
    });
    expect(doc?.['created_by']).toEqual(alpha.adminId);
    expect(doc).not.toHaveProperty('purge_after');
    const audit = await raw('audit_log').findOne({ action: 'beneficiary.create', target_id: id });
    expect(audit).toMatchObject({
      request_id: 'req-needy-1',
      meta: {
        category: 'widow',
        consent_confirmed: true,
        vpa_new: 'TestPerson@okexample',
        payee_new: 'Test Person A',
      },
    });
    expect(JSON.stringify(audit)).not.toMatch(/Test A\.|Sample reason|v1:k1/);
  });

  it('refuses a person without consent or with bad details; other masjids are out of reach; nothing is written', async () => {
    const before = await version(ALPHA);
    const count = await raw('beneficiaries').countDocuments({});
    for (const bad of [
      person({ consentConfirmed: false }),
      person({ displayName: '   ' }),
      person({ displayName: 'T'.repeat(41) }),
      person({ reason: '' }),
      person({ reason: 'r'.repeat(301) }),
      person({ payeeName: '' }),
      person({ vpa: 'not-a-upi-id' }),
      person({ vpa: 'a@b&am=1' }),
      person({ capPaise: 99 }),
      person({ capPaise: 1_000_000_001 }),
      person({ capPaise: 1000.5 }),
    ]) {
      expect(await code(add(ALPHA, bad))).toBe('BENEFICIARY_INVALID');
    }
    expect(
      await code(
        createBeneficiary(as('admin'), alpha, {
          masjidId: ALPHA,
          person: person(),
          privateEnc: 'plain text',
          now: NOW,
        }),
      ),
    ).toBe('BENEFICIARY_INVALID');
    // An admin of Alpha cannot add to Beta; the Super Admin cannot add at all.
    expect(await code(createBeneficiary(as('admin'), alpha, { masjidId: BETA, person: person() }))).toBe(
      'MASJID_NOT_FOUND',
    );
    expect(
      await code(createBeneficiary(as('admin'), superScope(newId(), NOW), { masjidId: ALPHA, person: person() })),
    ).toBe('MASJID_NOT_FOUND');
    expect(await version(ALPHA)).toBe(before);
    expect(await raw('beneficiaries').countDocuments({})).toBe(count);
  });

  it('the database refuses a person without consent even past the data layer', async () => {
    // Longs kept as longs, so only the rule under test can refuse the copies.
    const doc = await raw('beneficiaries').findOne({ masjid_id: ALPHA, status: 'active' }, { promoteLongs: false });
    await raw('beneficiaries').insertOne({ ...doc, _id: new UUID(), public_id: 'testValidCpy' }); // a plain copy is fine
    await raw('beneficiaries').deleteOne({ public_id: 'testValidCpy' });
    await expect(
      raw('beneficiaries').insertOne({ ...doc, _id: new UUID(), public_id: 'testNoConsnt', consent_confirmed: false }),
    ).rejects.toThrow(/Document failed validation/);
    // …and an active person with a purge date, or a fulfilled one without it.
    await expect(
      raw('beneficiaries').insertOne({ ...doc, _id: new UUID(), public_id: 'testPurgeAct', purge_after: NOW }),
    ).rejects.toThrow(/Document failed validation/);
    await expect(
      raw('beneficiaries').insertOne({ ...doc, _id: new UUID(), public_id: 'testFulfNoPg', status: 'fulfilled' }),
    ).rejects.toThrow(/Document failed validation/);
  });
});

describe('public list (A23)', () => {
  const ids: Record<string, string> = {};
  beforeAll(async () => {
    // Beta: three people, added a minute apart.
    const at = (minutes: number) => new Date(NOW.getTime() + minutes * 60_000);
    ids['oldest'] = (await add(BETA, person({ displayName: 'Test Oldest' }), at(0))).id;
    ids['zakat'] = (await add(BETA, person({ displayName: 'Test Zakat', zakatEligible: true }), at(1))).id;
    ids['newest'] = (await add(BETA, person({ displayName: 'Test Newest', category: 'student' }), at(2))).id;
  });
  const names = async (zakatOnly = false) =>
    (await listPublicBeneficiaries(as('public'), BETA, zakatOnly)).map((entry) => entry.displayName);

  it('is least-funded first, then oldest; the zakat filter keeps the tagged people', async () => {
    expect(await names()).toEqual(['Test Oldest', 'Test Zakat', 'Test Newest']); // all at 0: oldest first
    await received(BETA, ids['oldest'] ?? '', 150_000); // 50 %
    await received(BETA, ids['zakat'] ?? '', 30_000); // 10 %
    expect(await names()).toEqual(['Test Newest', 'Test Zakat', 'Test Oldest']);
    expect(await names(true)).toEqual(['Test Zakat']);
    expect((await getMasjidBundle(as('public'), BETA, TODAY))?.sections).toMatchObject({ needy: 3 });
  });

  it('carries public fields only — never the private phone / note, who added the person, the consent flag or ids', async () => {
    const [first] = await listPublicBeneficiaries(as('public'), BETA);
    expect(Object.keys(first ?? {}).sort()).toEqual(
      [
        'capPaise',
        'category',
        'displayName',
        'fundedPermille',
        'payeeName',
        'publicId',
        'reason',
        'reasonLocale',
        'receivedPaise',
        'vpa',
        'zakatEligible',
      ].sort(),
    );
    await raw('beneficiaries').updateOne({ _id: idOf(ids['newest'] ?? '') }, { $set: { private_enc: PRIVATE_ENC } });
    // The view itself, as `mc_public` reads it.
    const docs = await (await as('public').db()).collection('v_pub_beneficiaries').find({}).toArray();
    expect(docs.length).toBeGreaterThanOrEqual(3);
    for (const doc of docs) {
      expect(Object.keys(doc)).not.toEqual(expect.arrayContaining(['_id']));
      for (const hidden of ['private_enc', 'created_by', 'consent_confirmed', 'status', 'purge_after', 'updated_at']) {
        expect(doc).not.toHaveProperty(hidden);
      }
    }
    expect(JSON.stringify(docs)).not.toContain('v1:k1');
    // `mc_public` cannot read the collection or its history at all.
    await expect((await as('public').db()).collection('beneficiaries').findOne({})).rejects.toThrow(
      /not authorized|Unauthorized/i,
    );
    await expect((await as('public').db()).collection('beneficiary_amount_history').findOne({})).rejects.toThrow(
      /not authorized|Unauthorized/i,
    );
    await expect(scoped({ scope: publicScope(), db: t().db }, 'beneficiaries').find({})).rejects.toThrow();
  });

  it('a hidden masjid lists nobody', async () => {
    const { id } = await add(GAMMA, person({ displayName: 'Test Gamma' }));
    expect(await listPublicBeneficiaries(as('public'), GAMMA)).toHaveLength(1);
    await changeMasjidStatus(as('admin'), superScope(newId(), new Date()), {
      masjidId: GAMMA,
      transition: 'suspend',
      reason: 'Test suspension',
    });
    expect(await listPublicBeneficiaries(as('public'), GAMMA)).toEqual([]);
    expect(await raw('beneficiaries').findOne({ _id: idOf(id) })).toMatchObject({ masjid_visible: false });
  });
});

describe('update received', () => {
  it('sets the amount, appends a history row with who and when, and audits it', async () => {
    const scope = adminOf(ALPHA);
    const { id } = await add(ALPHA, person({ displayName: 'Test History' }));
    const set = (receivedPaise: number, at: Date) =>
      setBeneficiaryReceived(as('admin'), scope, { masjidId: ALPHA, id: idOf(id), receivedPaise, now: at });
    expect(await set(120_000, NOW)).toEqual({ status: 'active', fundedPermille: 400 });
    expect(await set(120_050, new Date(NOW.getTime() + 60_000))).toEqual({ status: 'active', fundedPermille: 400 });
    const doc = await raw('beneficiaries').findOne({ _id: idOf(id) }, { promoteLongs: false });
    expect(doc).toMatchObject({
      received_paise: toInt64(120_050),
      received_updated_at: new Date(NOW.getTime() + 60_000),
      funded_permille: 400,
      status: 'active',
    });
    const history = await raw('beneficiary_amount_history')
      .find({ beneficiary_id: idOf(id) }, { sort: { created_at: 1 }, promoteLongs: false })
      .toArray();
    expect(history.map((row) => (row['received_paise'] as Long).toNumber())).toEqual([120_000, 120_050]);
    expect(history.every((row) => (row['updated_by'] as UUID).equals(scope.adminId))).toBe(true);
    expect(await raw('audit_log').countDocuments({ action: 'beneficiary.received', target_id: id })).toBe(2);
    for (const bad of [-1, 0.5, 1_000_000_000_001]) {
      expect(await code(received(ALPHA, id, bad))).toBe('BENEFICIARY_INVALID');
    }
    expect(await code(received(BETA, id, 100))).toBe('BENEFICIARY_NOT_FOUND'); // not Beta's person
  });

  it('reaching the cap fulfils the person in the same transaction: hidden, the 90-day clock starts', async () => {
    const { id, publicId } = await add(ALPHA, person({ displayName: 'Test Fulfil', capPaise: 200_000 }));
    const listed = async () =>
      (await listPublicBeneficiaries(as('public'), ALPHA)).some((entry) => entry.publicId === publicId);
    expect(await listed()).toBe(true);
    const needy = async () => (await getMasjidBundle(as('public'), ALPHA, TODAY))?.sections?.needy ?? -1;
    const before = await needy();
    const versionBefore = await version(ALPHA);
    expect(await received(ALPHA, id, 200_000)).toEqual({ status: 'fulfilled', fundedPermille: 1000 });
    expect(await listed()).toBe(false);
    expect(await needy()).toBe(before - 1);
    expect(await version(ALPHA)).toBe(versionBefore + 1); // followers refetch the list
    expect(await raw('beneficiaries').findOne({ _id: idOf(id) })).toMatchObject({
      status: 'fulfilled',
      fulfilled_at: NOW,
      purge_after: new Date(NOW.getTime() + BENEFICIARY_PURGE_DAYS * DAY_MS),
    });
    expect(await raw('audit_log').findOne({ action: 'beneficiary.received', target_id: id })).toMatchObject({
      meta: { fulfilled: true },
    });
    // More than the cap keeps it fulfilled and does not restart the clock.
    const later = new Date(NOW.getTime() + 5 * DAY_MS);
    expect(await received(ALPHA, id, 250_000, later)).toMatchObject({ status: 'fulfilled' });
    expect(await raw('beneficiaries').findOne({ _id: idOf(id) })).toMatchObject({
      purge_after: new Date(NOW.getTime() + BENEFICIARY_PURGE_DAYS * DAY_MS),
    });
    // A correction below the cap lists the person again, without a purge date.
    expect(await received(ALPHA, id, 20_000, later)).toEqual({ status: 'active', fundedPermille: 100 });
    expect(await listed()).toBe(true);
    const relisted = await raw('beneficiaries').findOne({ _id: idOf(id) });
    expect(relisted).toMatchObject({ status: 'active' });
    expect(relisted).not.toHaveProperty('purge_after');
    expect(relisted).not.toHaveProperty('fulfilled_at');
  });

  it('parallel updates never leave the amount, the status and the history out of step', async () => {
    const { id } = await add(ALPHA, person({ displayName: 'Test Race', capPaise: 100_000 }));
    const amounts = [10_000, 100_000, 40_000, 150_000, 99_999, 100_000];
    const results = await Promise.all(amounts.map((amount) => code(received(ALPHA, id, amount))));
    expect(results.every((result) => result === 'ok')).toBe(true);
    const doc = await raw('beneficiaries').findOne({ _id: idOf(id) }, { promoteLongs: false });
    const history = await raw('beneficiary_amount_history')
      .find({ beneficiary_id: idOf(id) }, { promoteLongs: false })
      .toArray();
    expect(history).toHaveLength(amounts.length); // every update left its row
    const final = (doc?.['received_paise'] as Long).toNumber();
    expect(amounts).toContain(final);
    // Whatever order they committed in, the document is consistent with its own final amount.
    expect(doc?.['funded_permille']).toBe(fundedPermille(final, 100_000));
    expect(doc?.['status']).toBe(final >= 100_000 ? 'fulfilled' : 'active');
    expect(doc?.['purge_after'] instanceof Date).toBe(final >= 100_000);
  });
});

describe('edit', () => {
  it('replaces the details; a changed UPI ID or payee name is audited old → new (04 R13)', async () => {
    const { id } = await add(ALPHA, person({ displayName: 'Test Edit' }));
    const save = (input: BeneficiaryInput, privateEnc?: string | null) =>
      updateBeneficiary(as('admin'), alpha, { masjidId: ALPHA, id: idOf(id), person: input, privateEnc, now: NOW });
    expect(await save(person({ displayName: 'Test Edited', zakatEligible: true }), PRIVATE_ENC)).toEqual({
      status: 'active',
    });
    const first = await raw('audit_log').findOne({ action: 'beneficiary.update', target_id: id });
    expect(first?.['meta']).toEqual({ fields: ['display_name', 'zakat_eligible', 'private'] }); // no UPI change: none logged
    await save(
      person({ displayName: 'Test Edited', zakatEligible: true, vpa: 'other@okexample', payeeName: 'Other Name' }),
    );
    const audits = await raw('audit_log')
      .find({ action: 'beneficiary.update', target_id: id }, { sort: { at: 1 } })
      .toArray();
    expect(audits.at(-1)?.['meta']).toEqual({
      fields: ['vpa', 'payee_name'],
      vpa_old: 'testperson@okexample',
      vpa_new: 'other@okexample',
      payee_old: 'Test Person A',
      payee_new: 'Other Name',
    });
    expect(await raw('beneficiaries').findOne({ _id: idOf(id) })).toMatchObject({
      display_name: 'Test Edited',
      zakat_eligible: true,
      vpa: 'other@okexample',
      private_enc: PRIVATE_ENC, // kept: `undefined` leaves it alone
    });
    await save(person({ displayName: 'Test Edited', vpa: 'other@okexample', payeeName: 'Other Name' }), null);
    expect(await raw('beneficiaries').findOne({ _id: idOf(id) })).not.toHaveProperty('private_enc');
    expect(await code(save(person({ consentConfirmed: false })))).toBe('BENEFICIARY_INVALID');
  });

  it('a cap lowered to what was received fulfils the person', async () => {
    const { id } = await add(ALPHA, person({ displayName: 'Test Cap', capPaise: 500_000 }));
    await received(ALPHA, id, 200_000);
    const save = (capPaise: number) =>
      updateBeneficiary(as('admin'), alpha, {
        masjidId: ALPHA,
        id: idOf(id),
        person: person({ displayName: 'Test Cap', capPaise }),
        now: NOW,
      });
    expect(await save(400_000)).toEqual({ status: 'active' });
    expect(await raw('beneficiaries').findOne({ _id: idOf(id) })).toMatchObject({ funded_permille: 500 });
    expect(await save(200_000)).toEqual({ status: 'fulfilled' });
    expect(await raw('beneficiaries').findOne({ _id: idOf(id) })).toMatchObject({
      status: 'fulfilled',
      funded_permille: 1000,
      purge_after: new Date(NOW.getTime() + BENEFICIARY_PURGE_DAYS * DAY_MS),
    });
    expect(await code(save(900_000))).toBe('BENEFICIARY_NOT_FOUND'); // details of a fulfilled person are not edited
  });
});

describe('close and delete', () => {
  it('are final: hidden at once, purge in 90 days, no further writes — also not through the policy gateway', async () => {
    for (const end of ['closed', 'deleted'] as const) {
      const { id, publicId } = await add(ALPHA, person({ displayName: `Test ${end}` }));
      await endBeneficiary(as('admin'), alpha, { masjidId: ALPHA, id: idOf(id), as: end, now: NOW });
      expect(await raw('beneficiaries').findOne({ _id: idOf(id) })).toMatchObject({
        status: end,
        closed_at: NOW,
        purge_after: new Date(NOW.getTime() + BENEFICIARY_PURGE_DAYS * DAY_MS),
      });
      expect((await listPublicBeneficiaries(as('public'), ALPHA)).map((entry) => entry.publicId)).not.toContain(
        publicId,
      );
      expect(
        await raw('audit_log').countDocuments({
          action: `beneficiary.${end === 'closed' ? 'close' : 'delete'}`,
          target_id: id,
        }),
      ).toBe(1);
      expect(await code(received(ALPHA, id, 100))).toBe('BENEFICIARY_NOT_FOUND');
      expect(await code(endBeneficiary(as('admin'), alpha, { masjidId: ALPHA, id: idOf(id), as: 'closed' }))).toBe(
        'BENEFICIARY_NOT_FOUND',
      );
      expect(
        await code(updateBeneficiary(as('admin'), alpha, { masjidId: ALPHA, id: idOf(id), person: person() })),
      ).toBe('BENEFICIARY_NOT_FOUND');
      // The generic gateway cannot bring the person back either.
      const gateway = scoped({ scope: alpha, db: t().db, contentMasjidId: ALPHA }, 'beneficiaries');
      expect(await gateway.updateOne({ _id: idOf(id) }, { $set: { status: 'active' } })).toBe(0);
    }
  });

  it('closing a fulfilled person keeps the running purge clock', async () => {
    const { id } = await add(ALPHA, person({ displayName: 'Test Clock', capPaise: 100_000 }));
    await received(ALPHA, id, 100_000, NOW);
    const later = new Date(NOW.getTime() + 30 * DAY_MS);
    await endBeneficiary(as('admin'), alpha, { masjidId: ALPHA, id: idOf(id), as: 'closed', now: later });
    expect(await raw('beneficiaries').findOne({ _id: idOf(id) })).toMatchObject({
      status: 'closed',
      purge_after: new Date(NOW.getTime() + BENEFICIARY_PURGE_DAYS * DAY_MS),
    });
  });
});

describe('admin list (B19) and the private phone / note', () => {
  it('lists active (least-funded first), then fulfilled, then closed — never deleted; says only whether something private is stored', async () => {
    const { people } = await listBeneficiariesForAdmin(as('admin'), alpha, ALPHA);
    const statuses = people.map((entry) => entry.status);
    expect(statuses).toEqual(
      [...statuses].sort(
        (a, b) => ['active', 'fulfilled', 'closed'].indexOf(a) - ['active', 'fulfilled', 'closed'].indexOf(b),
      ),
    );
    expect(statuses).not.toContain('deleted');
    const active = people.filter((entry) => entry.status === 'active').map((entry) => entry.fundedPermille);
    expect(active).toEqual([...active].sort((a, b) => a - b));
    expect(people.find((entry) => entry.displayName === 'Test A.')).toMatchObject({ hasPrivate: true });
    expect(people.find((entry) => entry.displayName === 'Test History')).toMatchObject({ hasPrivate: false });
    expect(JSON.stringify(people)).not.toContain('v1:k1');
    expect(await code(listBeneficiariesForAdmin(as('admin'), alpha, BETA))).toBe('MASJID_NOT_FOUND');
  });

  it('`private_enc` is hidden from every generic read — admin and Super Admin', async () => {
    for (const scope of [alpha, superScope(newId(), NOW)]) {
      const docs = await scoped({ scope, db: t().db }, 'beneficiaries').find({ private_enc: { $exists: true } });
      expect(docs.length).toBeGreaterThan(0);
      for (const doc of docs) expect(doc).not.toHaveProperty('private_enc');
    }
  });

  it('only the masjid’s own admins get the ciphertext, and each view is audited', async () => {
    const withPrivate = await raw('beneficiaries').findOne({ masjid_id: ALPHA, display_name: 'Test A.' });
    const id = withPrivate?._id ?? new UUID();
    const read = (scope: Parameters<typeof readBeneficiaryPrivate>[1], masjidId = ALPHA) =>
      readBeneficiaryPrivate(as('admin'), scope, { masjidId, id, requestId: 'req-private-1' });
    expect(await read(alpha)).toBe(PRIVATE_ENC);
    const audits = await raw('audit_log').find({ action: 'beneficiary.private_view' }).toArray();
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({ actor_id: alpha.adminId, masjid_id: ALPHA, request_id: 'req-private-1' });
    // Another masjid's admin — also when naming their own masjid — and the Super Admin get nothing.
    const beta = adminOf(BETA);
    expect(await code(read(beta))).toBe('MASJID_NOT_FOUND');
    expect(await code(read(beta, BETA))).toBe('BENEFICIARY_NOT_FOUND');
    expect(await code(read(superScope(newId(), NOW)))).toBe('MASJID_NOT_FOUND');
    expect(await raw('audit_log').countDocuments({ action: 'beneficiary.private_view' })).toBe(1);
    const none = await raw('beneficiaries').findOne({ masjid_id: ALPHA, display_name: 'Test History' });
    expect(
      await readBeneficiaryPrivate(as('admin'), alpha, { masjidId: ALPHA, id: none?._id ?? new UUID() }),
    ).toBeNull();
  });
});

describe('limit', () => {
  it(`at most ${String(BENEFICIARIES_ACTIVE_MAX)} active people per masjid — also when adds race`, async () => {
    const template = await raw('beneficiaries').findOne({ masjid_id: BETA, status: 'active' }, { promoteLongs: false });
    const active = await raw('beneficiaries').countDocuments({ masjid_id: BETA, status: 'active' });
    const fill = BENEFICIARIES_ACTIVE_MAX - active - 2;
    await raw('beneficiaries').insertMany(
      Array.from({ length: fill }, (_, index) => ({
        ...template,
        _id: new UUID(),
        public_id: `fill${String(index).padStart(8, '0')}`,
        display_name: 'Test Fill',
      })),
    );
    // Two places left, five parallel adds: exactly two succeed.
    const results = await Promise.all(
      Array.from({ length: 5 }, (_, index) => code(add(BETA, person({ displayName: `Test Race ${String(index)}` })))),
    );
    expect(results.filter((result) => result === 'ok')).toHaveLength(2);
    expect(results.filter((result) => result === 'BENEFICIARY_LIMIT_REACHED')).toHaveLength(3);
    expect(await raw('beneficiaries').countDocuments({ masjid_id: BETA, status: 'active' })).toBe(
      BENEFICIARIES_ACTIVE_MAX,
    );
    expect(await listPublicBeneficiaries(as('public'), BETA)).toHaveLength(BENEFICIARIES_ACTIVE_MAX);
  });
});

describe('retention (02 §6)', () => {
  it('purges a person and their history once 90 days have passed — not a day earlier, and only as the system', async () => {
    const { id } = await add(ALPHA, person({ displayName: 'Test Purge', capPaise: 100_000 }));
    await received(ALPHA, id, 50_000, NOW);
    await received(ALPHA, id, 100_000, NOW); // fulfilled at NOW
    const history = () => raw('beneficiary_amount_history').countDocuments({ beneficiary_id: idOf(id) });
    expect(await history()).toBe(2);
    const others = await raw('beneficiaries').countDocuments({ _id: { $ne: idOf(id) } });
    const dueAt = new Date(NOW.getTime() + BENEFICIARY_PURGE_DAYS * DAY_MS);
    expect(await code(purgeBeneficiaries(as('admin'), alpha, { now: dueAt }))).toBe('FORBIDDEN');
    expect(await purgeBeneficiaries(as('system'), systemScope(), { now: new Date(dueAt.getTime() - 1000) })).toBe(0);
    expect(await raw('beneficiaries').countDocuments({ _id: idOf(id) })).toBe(1);
    // Everything that fulfilled / ended at NOW in this file is due now; active people stay.
    const due = await raw('beneficiaries').countDocuments({ purge_after: { $lte: dueAt } });
    expect(await purgeBeneficiaries(as('system'), systemScope(), { now: dueAt })).toBe(due);
    expect(await raw('beneficiaries').countDocuments({ _id: idOf(id) })).toBe(0);
    expect(await history()).toBe(0);
    expect(await raw('beneficiaries').countDocuments({})).toBe(others - (due - 1));
    expect(await raw('beneficiaries').countDocuments({ status: 'active' })).toBeGreaterThan(0);
    expect(await purgeBeneficiaries(as('system'), systemScope(), { now: dueAt })).toBe(0); // idempotent
  });
});
