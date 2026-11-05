// PHASE_03 T3.16 — Ilm contacts as the real `mc_admin` / `mc_public` users: the admin adds contacts (version bump,
// audit without the name or number), a contact without consent or with a number not in E.164 is refused (also by the
// validator); the 10-contact limit holds, also for parallel adds; replace and delete; the bundle carries both
// audiences without private fields, deleted contacts or hidden masjids. Fake names and numbers only (10 §Fixtures).
import { type Long, UUID } from 'mongodb';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { MIGRATIONS } from '../migrations/index.ts';
import type { DbHandle } from '../src/client.ts';
import { StateError } from '../src/effects.ts';
import { runMigrations } from '../src/migrate/index.ts';
import { getMasjidBundle, getPublicContacts, listContactsForAdmin } from '../src/repos/index.ts';
import { CONTACTS_MAX } from '../src/schema/index.ts';
import { adminScope, systemScope } from '../src/scope.ts';
import { buildDevSeed, seedId, writeDevSeed } from '../src/seed/index.ts';
import { addContact, type ContactInput, deleteContact, updateContact } from '../src/state/index.ts';
import { createTestDatabase, processUserHandle, type TestDatabase } from '../src/testing/index.ts';
import { newId, parseId } from '../src/values.ts';

const NOW = new Date('2026-11-05T06:30:00Z');
const TODAY = '2026-11-05';
const ALPHA = seedId('masjid-alpha');
const BETA = seedId('masjid-beta');
const GAMMA = seedId('masjid-gamma');

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
const contact = (overrides: Partial<ContactInput> = {}): ContactInput => ({
  name: 'Test Contact',
  role: 'Sample role',
  topics: 'Sample topics',
  whatsapp: '+910000000009',
  audience: 'sisters',
  consentConfirmed: true,
  ...overrides,
});
const idOf = (text: string) => {
  const id = parseId(text);
  if (!id) throw new Error(`not an id: ${text}`);
  return id;
};
const add = (masjid: UUID, input: ContactInput) =>
  addContact(adm(), adminOf(masjid), { masjidId: masjid, contact: input, now: NOW });

beforeAll(async () => {
  test = await createTestDatabase('contacts-state');
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
  it('goes to the end of the list, bumps the version and is audited without the name or number', async () => {
    const before = await version(ALPHA);
    const { id } = await addContact(adm(), alpha, {
      masjidId: ALPHA,
      contact: contact(),
      requestId: 'req-contact-1',
      now: NOW,
    });
    expect(await version(ALPHA)).toBe(before + 1);
    const doc = await raw('masjid_contacts').findOne({ _id: idOf(id) });
    expect(doc).toMatchObject({
      name: 'Test Contact',
      whatsapp: '+910000000009',
      audience: 'sisters',
      consent_confirmed: true,
      sort: 2, // after the two seeded contacts
      status: 'active',
      masjid_visible: true,
    });
    expect(doc?.['created_by']).toEqual(alpha.adminId);
    const audit = await raw('audit_log').findOne({ action: 'contact.create', target_id: id });
    expect(audit).toMatchObject({
      request_id: 'req-contact-1',
      meta: { audience: 'sisters', consent_confirmed: true },
    });
    expect(JSON.stringify(audit)).not.toMatch(/0000000009|Test Contact/);
  });

  it('refuses a contact without consent or with a number not in E.164; nothing is written', async () => {
    const before = await version(ALPHA);
    for (const bad of [
      contact({ consentConfirmed: false }),
      contact({ whatsapp: '9876500000' }),
      contact({ whatsapp: '+91 00000 00000' }),
      contact({ whatsapp: '+0910000000' }),
    ]) {
      expect(await code(add(ALPHA, bad))).toBe('CONTACT_INVALID');
    }
    expect(await version(ALPHA)).toBe(before);
    expect(await code(addContact(adm(), alpha, { masjidId: BETA, contact: contact() }))).toBe('MASJID_NOT_FOUND');
  });

  it(`refuses contact ${String(CONTACTS_MAX + 1)}, also when the last places are taken in parallel`, async () => {
    const existing = await raw('masjid_contacts').countDocuments({ masjid_id: GAMMA, status: 'active' });
    for (let index = existing; index < CONTACTS_MAX - 3; index += 1) await add(GAMMA, contact());
    // A deleted contact does not count.
    const { id } = await add(GAMMA, contact());
    await deleteContact(adm(), adminOf(GAMMA), { masjidId: GAMMA, id: idOf(id) });
    const results = await Promise.all(Array.from({ length: 6 }, () => code(add(GAMMA, contact()))));
    expect(results.filter((result) => result === 'ok')).toHaveLength(3);
    expect(results.filter((result) => result === 'CONTACT_LIMIT_REACHED')).toHaveLength(3);
    expect(await raw('masjid_contacts').countDocuments({ masjid_id: GAMMA, status: 'active' })).toBe(CONTACTS_MAX);
  });
});

describe('the validator', () => {
  const base = () => ({
    _id: new UUID(),
    masjid_id: BETA,
    name: 'Test Contact',
    whatsapp: '+910000000009',
    audience: 'brothers',
    consent_confirmed: true,
    status: 'active',
    sort: 0,
    masjid_visible: true,
    created_by: new UUID(),
    created_at: NOW,
    updated_at: NOW,
  });
  const refused = async (doc: Record<string, unknown>) => {
    await expect(raw('masjid_contacts').insertOne({ ...base(), ...doc })).rejects.toMatchObject({ code: 121 });
  };

  it('accepts a contact with consent', async () => {
    await raw('masjid_contacts').insertOne(base());
  });

  it('refuses no consent, a false consent, a bad number, an audience of everyone, a deleted_at mismatch', async () => {
    const { consent_confirmed: _consent, ...withoutConsent } = base();
    await expect(raw('masjid_contacts').insertOne(withoutConsent)).rejects.toMatchObject({ code: 121 });
    await refused({ consent_confirmed: false });
    for (const whatsapp of ['9876500000', '+91 0000000000', '+0910000000', '+١٢٣٤٥٦٧٨']) await refused({ whatsapp });
    await refused({ audience: 'everyone' });
    await refused({ status: 'deleted' });
    await refused({ deleted_at: NOW });
  });
});

describe('replace, delete', () => {
  it('a replacement keeps the place and removes what was left out; another masjid cannot touch it', async () => {
    const { id } = await add(BETA, contact());
    const sort = (await raw('masjid_contacts').findOne({ _id: idOf(id) }))?.['sort'];
    await updateContact(adm(), adminOf(BETA), {
      masjidId: BETA,
      id: idOf(id),
      contact: {
        name: 'Test Contact Renamed',
        whatsapp: '+910000000008',
        audience: 'brothers',
        consentConfirmed: true,
      },
    });
    const doc = await raw('masjid_contacts').findOne({ _id: idOf(id) });
    expect(doc).toMatchObject({ name: 'Test Contact Renamed', whatsapp: '+910000000008', audience: 'brothers', sort });
    expect(doc).not.toHaveProperty('role');
    expect(doc).not.toHaveProperty('topics');
    expect(await raw('audit_log').countDocuments({ action: 'contact.update', target_id: id })).toBe(1);
    expect(
      await code(
        updateContact(adm(), adminOf(BETA), {
          masjidId: BETA,
          id: idOf(id),
          contact: contact({ consentConfirmed: false }),
        }),
      ),
    ).toBe('CONTACT_INVALID');
    expect(await code(updateContact(adm(), alpha, { masjidId: ALPHA, id: idOf(id), contact: contact() }))).toBe(
      'CONTACT_NOT_FOUND',
    );
  });

  it('a deleted contact is gone for followers, keeps its retention clock and cannot be changed again', async () => {
    const { id } = await add(BETA, contact());
    const before = await version(BETA);
    await deleteContact(adm(), adminOf(BETA), { masjidId: BETA, id: idOf(id), now: NOW });
    expect(await version(BETA)).toBe(before + 1);
    expect(await raw('masjid_contacts').findOne({ _id: idOf(id) })).toMatchObject({
      status: 'deleted',
      deleted_at: NOW,
    });
    expect(await code(deleteContact(adm(), adminOf(BETA), { masjidId: BETA, id: idOf(id) }))).toBe('CONTACT_NOT_FOUND');
    expect(await code(updateContact(adm(), adminOf(BETA), { masjidId: BETA, id: idOf(id), contact: contact() }))).toBe(
      'CONTACT_NOT_FOUND',
    );
    expect((await listContactsForAdmin(adm(), adminOf(BETA), BETA)).contacts.map((row) => row.id)).not.toContain(id);
    expect((await getPublicContacts(pub(), BETA)).map((row) => row.id)).not.toContain(id);
  });
});

describe('public reads', () => {
  it('the bundle carries both audiences, brothers first, without consent, creator, status or sort', async () => {
    const bundle = await getMasjidBundle(pub(), ALPHA, TODAY);
    if (bundle?.status !== 'active') throw new Error('alpha is not active');
    const audiences = bundle.contacts.map((row) => row.audience);
    expect(audiences).toContain('brothers');
    expect(audiences).toContain('sisters');
    expect(audiences).toEqual([...audiences].sort()); // 'brothers' < 'sisters'
    expect(bundle.contacts[0]).toMatchObject({ name: 'Test Contact Brother', whatsapp: '+910000000001' });
    expect(JSON.stringify(bundle.contacts)).not.toMatch(/consent|created_by|createdBy|status|masjid_visible|"sort"/);
  });

  it('a hidden masjid’s contacts are not public (visibility mirror)', async () => {
    await raw('masjid_contacts').updateMany({ masjid_id: ALPHA }, { $set: { masjid_visible: false } });
    expect(await getPublicContacts(pub(), ALPHA)).toEqual([]);
    await raw('masjid_contacts').updateMany({ masjid_id: ALPHA }, { $set: { masjid_visible: true } });
    expect((await getPublicContacts(pub(), ALPHA)).length).toBeGreaterThan(0);
  });
});
