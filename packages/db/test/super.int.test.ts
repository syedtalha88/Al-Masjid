// PHASE_01 T1.10/T1.11 data layer against a migrated MongoDB: Super Admin masjid edits (version bump, allow-list),
// ★ revocations and the audited phone view, undertaking acceptance (current version only), settings, and the read
// repositories (search, cursors, hidden fields, dashboard).
import { randomBytes } from 'node:crypto';

import { Binary, Long, type UUID } from 'mongodb';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { MIGRATIONS } from '../migrations/index.ts';
import { createDbHandle, type DbHandle } from '../src/client.ts';
import { StateError } from '../src/effects.ts';
import { runMigrations } from '../src/migrate/index.ts';
import { getDashboard, getMasjidDetail, getSettings, listAudit, listMasjids } from '../src/repos/index.ts';
import { adminScope, publicScope, superScope } from '../src/scope.ts';
import {
  acceptUndertaking,
  addAdminToMasjid,
  createAdmin,
  createMasjid,
  readAdminPhone,
  resolveSession,
  revokeAdminPasskeys,
  revokeAdminSessions,
  updateMasjid,
  updateSettings,
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
/** A well-formed ciphertext shape (the validator checks the format; this one is never decrypted). */
const PHONE_ENC = `v1:k1:${'A'.repeat(16)}:${'B'.repeat(40)}`;
const fresh = () => superScope(SUPER_ID, new Date());
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
const masjid = (name = 'Test Masjid Delta', city = 'Hyderabad') =>
  createMasjid(h(), fresh(), {
    name,
    area: 'Test Area',
    city,
    state: 'Telangana',
    address: 'Test address',
    lat: 17.4,
    lng: 78.5,
  });
const version = async (id: UUID) =>
  ((await raw('masjids').findOne({ _id: id }, { promoteLongs: false }))?.['content_version'] as Long).toNumber();

/** An admin with a credential and two live sessions. */
async function adminWithSessions() {
  const adminId = await createAdmin(h(), fresh(), { displayName: 'Test Admin', uiLocale: 'en' });
  await raw('admin_users').updateOne({ _id: adminId }, { $set: { status: 'active' } });
  await raw('webauthn_credentials').insertOne({
    _id: newId(),
    admin_id: adminId,
    credential_id: new Binary(randomBytes(32)),
    public_key: new Binary(randomBytes(64)),
    sign_count: Long.fromNumber(0),
    transports: ['internal'],
    backed_up: true,
    device_type: 'multiDevice',
    label: 'Test phone',
    created_at: new Date(),
  });
  const tokens = [randomBytes(32), randomBytes(32)];
  for (const token of tokens) {
    await raw('admin_sessions').insertOne(
      {
        _id: newId(),
        admin_id: adminId,
        token_hash: new Binary(token),
        created_at: new Date(),
        last_seen_at: new Date(),
        idle_expires_at: new Date(Date.now() + 3_600_000),
        absolute_expires_at: new Date(Date.now() + 7_200_000),
      },
      { bypassDocumentValidation: true },
    );
  }
  return { adminId, tokens };
}

beforeAll(async () => {
  test = await createTestDatabase('super');
  await runMigrations(t().db, MIGRATIONS);
  handle = createDbHandle({ uri: testMongoUri(), database: t().name, process: 'script', local: true });
});

afterAll(async () => {
  await handle?.close();
  await test?.dispose();
});

describe('updateMasjid', () => {
  it('edits allowed fields, bumps the content version once, audits the field names; null offset removes it', async () => {
    const { id } = await masjid();
    const before = await version(id);
    const fields = await updateMasjid(h(), fresh(), {
      masjidId: id,
      patch: {
        name: 'Test Masjid Delta 2',
        nameI18n: { ur: 'ٹیسٹ' },
        lat: 17.1234567,
        hijriOffset: 1,
        pushDailyQuota: 12,
      },
    });
    expect(fields).toEqual(['name', 'name_i18n', 'lat', 'hijri_offset', 'push_daily_quota']);
    expect(await version(id)).toBe(before + 1);
    expect(await raw('masjids').findOne({ _id: id })).toMatchObject({
      name: 'Test Masjid Delta 2',
      name_i18n: { ur: 'ٹیسٹ' },
      lat: 17.123457,
      hijri_offset: 1,
      push_daily_quota: 12,
      status: 'pending',
    });
    await updateMasjid(h(), fresh(), { masjidId: id, patch: { hijriOffset: null } });
    expect(await raw('masjids').findOne({ _id: id })).not.toHaveProperty('hijri_offset');
    expect(
      await raw('audit_log').findOne({ action: 'masjid.update', masjid_id: id }, { sort: { _id: 1 } }),
    ).toMatchObject({
      actor_type: 'super_admin',
      meta: { fields: ['name', 'name_i18n', 'lat', 'hijri_offset', 'push_daily_quota'] },
    });
  });

  it('refuses: empty patch, unknown masjid, outside India (validator), non-super scope', async () => {
    const { id } = await masjid();
    expect(await code(updateMasjid(h(), fresh(), { masjidId: id, patch: {} }))).toBe('NOTHING_TO_UPDATE');
    expect(await code(updateMasjid(h(), fresh(), { masjidId: newId(), patch: { name: 'x' } }))).toBe(
      'MASJID_NOT_FOUND',
    );
    await expect(updateMasjid(h(), fresh(), { masjidId: id, patch: { lat: 51.5 } })).rejects.toThrow(/validation/i);
    const admin = adminScope({ adminId: newId(), masjids: [{ id, role: 'owner' }] });
    expect(await code(updateMasjid(h(), admin, { masjidId: id, patch: { name: 'x' } }))).toBe('FORBIDDEN');
  });
});

describe('★ admin actions', () => {
  it('revokeAdminSessions: needs a fresh step-up; every session dies; audited with the count', async () => {
    const { adminId, tokens } = await adminWithSessions();
    expect(await code(revokeAdminSessions(h(), stale(), { adminId }))).toBe('STEP_UP_REQUIRED');
    expect(await revokeAdminSessions(h(), fresh(), { adminId })).toBe(2);
    for (const token of tokens) expect(await resolveSession(h(), publicScope(), { tokenHash: token })).toBeNull();
    expect(
      await raw('audit_log').findOne({ action: 'session.revoke', target_id: adminId.toHexString() }),
    ).toMatchObject({
      actor_type: 'super_admin',
      meta: { reason: 'revoked_by_super_admin', count: 2 },
    });
    expect(await code(revokeAdminSessions(h(), fresh(), { adminId: newId() }))).toBe('ADMIN_NOT_FOUND');
  });

  it('revokeAdminPasskeys: credentials and sessions revoked together', async () => {
    const { adminId } = await adminWithSessions();
    expect(await revokeAdminPasskeys(h(), fresh(), { adminId })).toBe(1);
    expect(
      await raw('webauthn_credentials').countDocuments({ admin_id: adminId, revoked_at: { $exists: false } }),
    ).toBe(0);
    expect(await raw('admin_sessions').countDocuments({ admin_id: adminId, revoked_at: { $exists: false } })).toBe(0);
    expect(await code(revokeAdminPasskeys(h(), stale(), { adminId }))).toBe('STEP_UP_REQUIRED');
  });

  it('readAdminPhone: returns the ciphertext only with a fresh step-up, and every view is audited', async () => {
    const adminId = await createAdmin(h(), fresh(), {
      displayName: 'Test Admin',
      uiLocale: 'en',
      phoneEnc: PHONE_ENC,
    });
    expect(await code(readAdminPhone(h(), stale(), { adminId }))).toBe('STEP_UP_REQUIRED');
    expect(await readAdminPhone(h(), fresh(), { adminId, requestId: 'phone-1' })).toBe(PHONE_ENC);
    expect(await raw('audit_log').findOne({ action: 'admin.phone_view', request_id: 'phone-1' })).toMatchObject({
      actor_type: 'super_admin',
      actor_id: SUPER_ID,
      target_id: adminId.toHexString(),
    });
    const noPhone = await createAdmin(h(), fresh(), { displayName: 'Test Admin', uiLocale: 'en' });
    expect(await readAdminPhone(h(), fresh(), { adminId: noPhone })).toBeNull();
  });
});

describe('undertaking and settings', () => {
  it('acceptUndertaking: current version only; history kept; audited', async () => {
    const adminId = await createAdmin(h(), fresh(), { displayName: 'Test Admin', uiLocale: 'en' });
    const me = adminScope({ adminId, masjids: [] });
    const current = String((await getSettings(h(), fresh()))['undertaking_version']);
    expect(await code(acceptUndertaking(h(), me, { version: 'old-version' }))).toBe('UNDERTAKING_VERSION_MISMATCH');
    await acceptUndertaking(h(), me, { version: current });
    expect(await raw('admin_users').findOne({ _id: adminId })).toMatchObject({
      undertaking_version: current,
      undertaking_history: [{ version: current }],
    });
    expect(await raw('audit_log').findOne({ action: 'admin.undertaking_accept', actor_id: adminId })).toMatchObject({
      meta: { version: current },
    });
    expect(await code(acceptUndertaking(h(), publicScope(), { version: current }))).toBe('FORBIDDEN');
  });

  it('updateSettings: allow-listed fields, updated_by recorded, audited; non-super refused', async () => {
    const fields = await updateSettings(h(), fresh(), {
      patch: { globalHijriOffset: -1, defaultPushQuota: 6, supportWhatsapp: '+919999999999' },
    });
    expect(fields).toEqual(['global_hijri_offset', 'default_push_quota', 'support_whatsapp']);
    expect(await getSettings(h(), fresh())).toMatchObject({
      global_hijri_offset: -1,
      default_push_quota: 6,
      support_whatsapp: '+919999999999',
      updated_by: SUPER_ID,
    });
    await updateSettings(h(), fresh(), { patch: { supportWhatsapp: null } });
    expect(await getSettings(h(), fresh())).not.toHaveProperty('support_whatsapp');
    expect(
      await code(
        updateSettings(h(), adminScope({ adminId: newId(), masjids: [] }), { patch: { defaultPushQuota: 1 } }),
      ),
    ).toBe('FORBIDDEN');
    expect(await code(updateSettings(h(), fresh(), { patch: {} }))).toBe('NOTHING_TO_UPDATE');
  });
});

describe('read repositories', () => {
  it('listMasjids: search (literal, case-insensitive), status filter, stable cursor pages', async () => {
    const ids = [];
    for (let i = 0; i < 5; i += 1) ids.push((await masjid(`Searchable Masjid ${String(i)}`, 'Warangal')).id);
    const first = await listMasjids(h(), fresh(), { q: 'searchable', limit: 2 });
    expect(first.rows).toHaveLength(2);
    const second = await listMasjids(h(), fresh(), {
      q: 'SEARCHABLE',
      limit: 2,
      ...(first.next ? { cursor: first.next } : {}),
    });
    const third = await listMasjids(h(), fresh(), {
      q: 'searchable',
      limit: 2,
      ...(second.next ? { cursor: second.next } : {}),
    });
    const seen = [...first.rows, ...second.rows, ...third.rows].map((r) => r.id.toHexString());
    expect(new Set(seen).size).toBe(5);
    expect(third.next).toBeUndefined();
    expect((await listMasjids(h(), fresh(), { q: 'Searchable.*' })).rows).toHaveLength(0); // regex is literal
    expect((await listMasjids(h(), fresh(), { q: 'warangal', status: 'active' })).rows).toHaveLength(0);
    await expect(listMasjids(h(), fresh(), { cursor: 'not-a-cursor' })).rejects.toMatchObject({
      code: 'INVALID_CURSOR',
    });
    expect(await code(listMasjids(h(), adminScope({ adminId: newId(), masjids: [] }), {}))).toBe('FORBIDDEN');
  });

  it('getMasjidDetail: admins with role/status and phone presence, never the phone itself', async () => {
    const { id } = await masjid();
    const adminId = await createAdmin(h(), fresh(), {
      displayName: 'Test Admin',
      uiLocale: 'te',
      phoneEnc: PHONE_ENC,
    });
    await addAdminToMasjid(h(), fresh(), { masjidId: id, adminId, role: 'owner' });
    const detail = await getMasjidDetail(h(), fresh(), id);
    expect(detail?.admins).toEqual([
      expect.objectContaining({
        displayName: 'Test Admin',
        role: 'owner',
        status: 'invited',
        uiLocale: 'te',
        hasPhone: true,
      }),
    ]);
    expect(JSON.stringify(detail)).not.toContain(PHONE_ENC);
    expect(await getMasjidDetail(h(), fresh(), newId())).toBeNull();
  });

  it('listAudit: filters and cursor pages; dashboard counts pending masjids', async () => {
    const { id } = await masjid('Audit Masjid');
    await updateMasjid(h(), fresh(), { masjidId: id, patch: { area: 'A1' } });
    await updateMasjid(h(), fresh(), { masjidId: id, patch: { area: 'A2' } });
    const page1 = await listAudit(h(), fresh(), { masjidId: id, limit: 2 });
    expect(page1.rows.map((r) => r.action)).toEqual(['masjid.update', 'masjid.update']);
    const page2 = await listAudit(h(), fresh(), {
      masjidId: id,
      limit: 2,
      ...(page1.next ? { cursor: page1.next } : {}),
    });
    expect(page2.rows.map((r) => r.action)).toEqual(['masjid.create']);
    expect((await listAudit(h(), fresh(), { action: 'masjid.update', masjidId: id })).rows).toHaveLength(2);
    expect((await listAudit(h(), fresh(), { masjidId: id, to: new Date(0) })).rows).toHaveLength(0);
    const dashboard = await getDashboard(h(), fresh());
    expect(dashboard.counts.pending).toBeGreaterThanOrEqual(1);
    expect(dashboard.pending.length).toBeGreaterThanOrEqual(1);
  });
});
