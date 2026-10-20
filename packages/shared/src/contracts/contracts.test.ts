import { describe, expect, it } from 'vitest';

import {
  adminMeSchema,
  assertionVerifyRequestSchema,
  creationOptionsSchema,
  inviteInfoSchema,
  inviteLinkSchema,
  passkeyLabelSchema,
  registerOptionsRequestSchema,
  registerVerifyRequestSchema,
  requestOptionsSchema,
  undertakingAcceptSchema,
} from './admin-auth.ts';
import {
  auditQuerySchema,
  hijriOffsetSchema,
  INDIA_BOUNDS,
  superAdminCreatedSchema,
  superAdminCreateSchema,
  superMasjidCreateSchema,
  superMasjidPatchSchema,
  superQuotaSchema,
  superSettingsPatchSchema,
} from './super.ts';

// Wire contracts shared by api-admin and the admin PWA (03 §4, §5). The server-side behaviour behind them is covered
// by the API integration tests; these pin the boundaries each schema promises.

const TOKEN = 'A'.repeat(43);
const NOW = '2026-10-19T10:00:00.000Z';

describe('admin auth contracts (03 §4)', () => {
  it('invite tokens are exactly 43 base64url characters (32 random bytes)', () => {
    expect(registerOptionsRequestSchema.safeParse({ inviteToken: TOKEN }).success).toBe(true);
    for (const inviteToken of ['A'.repeat(42), 'A'.repeat(44), `${'A'.repeat(42)}=`, `${'A'.repeat(42)}/`]) {
      expect(registerOptionsRequestSchema.safeParse({ inviteToken }).success).toBe(false);
    }
  });

  it('passkey labels are trimmed and 1–60 characters', () => {
    expect(passkeyLabelSchema.parse({ label: '  Test phone  ' })).toEqual({ label: 'Test phone' });
    expect(passkeyLabelSchema.safeParse({ label: '   ' }).success).toBe(false);
    expect(passkeyLabelSchema.safeParse({ label: 'x'.repeat(61) }).success).toBe(false);
    expect(
      registerVerifyRequestSchema.safeParse({ inviteToken: TOKEN, response: { id: 'abc' }, label: '' }).success,
    ).toBe(false);
  });

  it('credential responses: the fields the server verifies, base64url and bounded; everything else dropped', () => {
    const assertion = {
      id: 'Y3JlZA',
      rawId: 'Y3JlZA',
      type: 'public-key',
      response: { clientDataJSON: 'e30', authenticatorData: 'AAAA', signature: 'c2ln', userHandle: 'dXNlcg' },
    };
    const parsed = assertionVerifyRequestSchema.parse({
      response: { ...assertion, clientExtensionResults: { appid: true }, authenticatorAttachment: 'platform' },
    });
    expect(parsed.response).toEqual(assertion);
    const bad = (patch: Record<string, unknown>, inner: Record<string, unknown> = {}) =>
      assertionVerifyRequestSchema.safeParse({
        response: { ...assertion, ...patch, response: { ...assertion.response, ...inner } },
      }).success;
    expect(bad({ type: 'password' })).toBe(false);
    expect(bad({ id: 'a+b/' })).toBe(false); // standard base64, not base64url
    expect(bad({ id: 'A'.repeat(1365) })).toBe(false); // > 1023-byte credential id
    expect(bad({}, { signature: '' })).toBe(false);
    expect(bad({}, { signature: 'A'.repeat(1025) })).toBe(false);
    expect(bad({}, { userHandle: 'A'.repeat(89) })).toBe(false);
    expect(assertionVerifyRequestSchema.safeParse({ response: 'abc' }).success).toBe(false);

    const registration = {
      id: 'Y3JlZA',
      rawId: 'Y3JlZA',
      type: 'public-key',
      response: { clientDataJSON: 'e30', attestationObject: 'o2Nm', transports: ['internal', 'hybrid'] },
    };
    expect(registerVerifyRequestSchema.parse({ inviteToken: TOKEN, response: registration, label: 'Phone' })).toEqual({
      inviteToken: TOKEN,
      response: registration,
      label: 'Phone',
    });
    const regBad = (inner: Record<string, unknown>) =>
      registerVerifyRequestSchema.safeParse({
        inviteToken: TOKEN,
        label: 'Phone',
        response: { ...registration, response: { ...registration.response, ...inner } },
      }).success;
    expect(regBad({ attestationObject: undefined })).toBe(false);
    expect(regBad({ transports: Array.from({ length: 11 }, () => 'usb') })).toBe(false);
  });

  it('undertaking versions are 1–20 characters', () => {
    expect(undertakingAcceptSchema.safeParse({ version: 'draft-1' }).success).toBe(true);
    expect(undertakingAcceptSchema.safeParse({ version: '' }).success).toBe(false);
    expect(undertakingAcceptSchema.safeParse({ version: 'v'.repeat(21) }).success).toBe(false);
  });

  it('ceremony options pin base64url challenges and public-key descriptors', () => {
    const creation = {
      rp: { id: 'localhost', name: 'Test RP' },
      user: { id: 'dXNlcg', name: 'test-admin', displayName: 'Test Admin' },
      challenge: 'Y2hhbGxlbmdl',
      pubKeyCredParams: [{ type: 'public-key', alg: -7 }],
      excludeCredentials: [{ id: 'Y3JlZA', type: 'public-key', transports: ['internal'] }],
      authenticatorSelection: { residentKey: 'required', userVerification: 'required' },
      attestation: 'none',
    };
    expect(creationOptionsSchema.safeParse(creation).success).toBe(true);
    expect(creationOptionsSchema.safeParse({ ...creation, challenge: 'not+base64url' }).success).toBe(false);
    expect(
      requestOptionsSchema.safeParse({ challenge: 'Y2g', allowCredentials: [{ id: 'Y3', type: 'x' }] }).success,
    ).toBe(false);
  });

  it('responses: invite info, /me and invite links', () => {
    expect(
      inviteInfoSchema.safeParse({
        adminDisplayName: 'Test Admin',
        masjidNames: ['Test Masjid Alpha'],
        purpose: 'register',
        uiLocale: 'ur',
      }).success,
    ).toBe(true);
    expect(
      adminMeSchema.safeParse({
        admin: { id: 'a1', displayName: 'Test Admin', role: 'masjid_admin', uiLocale: 'xx' },
        masjids: [],
        undertakingRequired: true,
      }).success,
    ).toBe(false);
    expect(inviteLinkSchema.safeParse({ inviteUrl: 'not a url', expiresAt: NOW }).success).toBe(false);
    expect(
      superAdminCreatedSchema.safeParse({
        inviteUrl: 'https://admin.example.test/invite#x',
        expiresAt: NOW,
        adminId: 'a1',
      }).success,
    ).toBe(true);
  });
});

describe('Super Admin contracts (03 §5)', () => {
  const masjid = {
    name: ' Test Masjid Alpha ',
    area: 'Test Area',
    city: 'Test City',
    state: 'Test State',
    address: '',
    lat: 17.4,
    lng: 78.4,
  };

  it('masjid coordinates must lie inside India', () => {
    expect(superMasjidCreateSchema.parse(masjid).name).toBe('Test Masjid Alpha');
    for (const [lat, lng] of [
      [INDIA_BOUNDS.lat[0] - 0.1, 78],
      [INDIA_BOUNDS.lat[1] + 0.1, 78],
      [17, INDIA_BOUNDS.lng[0] - 0.1],
      [17, INDIA_BOUNDS.lng[1] + 0.1],
      [51.5, -0.1],
    ]) {
      expect(superMasjidCreateSchema.safeParse({ ...masjid, lat, lng }).success).toBe(false);
    }
  });

  it('required masjid text cannot be blank; optional patch fields stay optional', () => {
    expect(superMasjidCreateSchema.safeParse({ ...masjid, city: '   ' }).success).toBe(false);
    expect(superMasjidPatchSchema.safeParse({}).success).toBe(true);
    expect(superMasjidPatchSchema.safeParse({ hijriOffset: null }).success).toBe(true);
  });

  it('Hijri offsets are whole days in −2…+2', () => {
    for (const offset of [-2, -1, 0, 1, 2]) expect(hijriOffsetSchema.safeParse(offset).success).toBe(true);
    for (const offset of [-3, 3, 0.5]) expect(hijriOffsetSchema.safeParse(offset).success).toBe(false);
  });

  it('push quotas are integers 0–50', () => {
    expect(superQuotaSchema.safeParse({ pushDailyQuota: 50 }).success).toBe(true);
    expect(superQuotaSchema.safeParse({ pushDailyQuota: 51 }).success).toBe(false);
    expect(superQuotaSchema.safeParse({ pushDailyQuota: 2.5 }).success).toBe(false);
  });

  it('admin phone numbers are digits with an optional +', () => {
    const admin = { displayName: 'Test Admin', uiLocale: 'te', masjidId: 'm1', role: 'editor' };
    expect(superAdminCreateSchema.safeParse(admin).success).toBe(true);
    expect(superAdminCreateSchema.safeParse({ ...admin, phone: '+910000000000' }).success).toBe(true);
    for (const phone of ['12345', '+91 00000 00000', 'tel:0000000000']) {
      expect(superAdminCreateSchema.safeParse({ ...admin, phone }).success).toBe(false);
    }
  });

  it('settings: WhatsApp number can be cleared, grievance e-mail must be valid', () => {
    expect(superSettingsPatchSchema.safeParse({ supportWhatsapp: null }).success).toBe(true);
    expect(
      superSettingsPatchSchema.safeParse({
        grievanceOfficer: { name: 'Test Officer', email: 'not-an-email', address: 'Test Address', city: 'Test City' },
      }).success,
    ).toBe(false);
  });

  it('audit filters: actions look like `noun.verb`, dates are ISO', () => {
    expect(auditQuerySchema.safeParse({ action: 'masjid.create', from: NOW }).success).toBe(true);
    for (const action of ['masjid', 'masjid.create;drop', '$where.x', 'Masjid.Create']) {
      expect(auditQuerySchema.safeParse({ action }).success).toBe(false);
    }
    expect(auditQuerySchema.safeParse({ from: '19/10/2026' }).success).toBe(false);
  });
});
