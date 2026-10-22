import { describe, expect, it } from 'vitest';

import {
  feedItemSchema,
  feedQuerySchema,
  masjidBundleSchema,
  masjidVersionsSchema,
  publicIdText,
  registerDeviceRequestSchema,
  registerDeviceResponseSchema,
  templateParamValueSchema,
  updateDeviceRequestSchema,
  uuidText,
} from './public.ts';

// 03 §3 wire contracts (PHASE_02 T2.2): what the musalli app may send and what it accepts back.

const ID = '6f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b';

describe('public contracts', () => {
  it('ids: lower-case UUID v4 and 12-character public ids only', () => {
    expect(uuidText.safeParse(ID).success).toBe(true);
    expect(uuidText.safeParse(ID.toUpperCase()).success).toBe(false);
    expect(uuidText.safeParse('6f1c2a3b-4d5e-1f60-8a7b-9c0d1e2f3a4b').success).toBe(false); // v1
    expect(publicIdText.safeParse('seedA0000001').success).toBe(true);
    expect(publicIdText.safeParse('seedA000001').success).toBe(false);
  });

  it('device registration: closed enums, bounded token, strict secret shape', () => {
    const body = {
      locale: 'ur',
      audiencePref: 'sisters',
      platform: 'ios',
      privacyVersion: 'draft-1',
      turnstileToken: 't',
    };
    expect(registerDeviceRequestSchema.safeParse(body).success).toBe(true);
    expect(registerDeviceRequestSchema.safeParse({ ...body, locale: 'fr' }).success).toBe(false);
    expect(registerDeviceRequestSchema.safeParse({ ...body, privacyVersion: 'a b' }).success).toBe(false);
    expect(registerDeviceRequestSchema.safeParse({ ...body, turnstileToken: 'x'.repeat(2049) }).success).toBe(false);
    expect(registerDeviceResponseSchema.safeParse({ deviceId: ID, secret: 'A'.repeat(43) }).success).toBe(true);
    expect(registerDeviceResponseSchema.safeParse({ deviceId: ID, secret: 'A'.repeat(42) }).success).toBe(false);
  });

  it('device update needs at least one field', () => {
    expect(updateDeviceRequestSchema.safeParse({}).success).toBe(false);
    expect(updateDeviceRequestSchema.safeParse({ locale: 'hi' }).success).toBe(true);
  });

  it('versions, bundle (active / suspended), feed items and queries', () => {
    expect(masjidVersionsSchema.safeParse({ [ID]: { v: 3, status: 'active' } }).success).toBe(true);
    expect(masjidVersionsSchema.safeParse({ [ID]: { v: 0, status: 'active' } }).success).toBe(false);
    expect(masjidBundleSchema.safeParse({ status: 'suspended', v: 4 }).success).toBe(true);
    expect(masjidBundleSchema.safeParse({ status: 'deleted', v: 4 }).success).toBe(false);
    const item = {
      publicId: 'seedA0000001',
      masjidId: ID,
      type: 'dua_request',
      audience: 'everyone',
      isImportant: false,
      publishedAt: '2026-10-22T04:30:00.000Z',
      dua: { category: 'illness', namePrivate: true },
    };
    expect(feedItemSchema.safeParse(item).success).toBe(true);
    expect(feedItemSchema.safeParse({ ...item, type: 'gossip' }).success).toBe(false);
    expect(feedQuerySchema.parse({ v: '7', limit: '30' })).toEqual({ v: 7, limit: 30 });
    expect(feedQuerySchema.safeParse({ limit: '31' }).success).toBe(false);
  });

  it('template parameter values: text, numbers and ranges', () => {
    expect(templateParamValueSchema.safeParse('10:00').success).toBe(true);
    expect(templateParamValueSchema.safeParse(3).success).toBe(true);
    expect(templateParamValueSchema.safeParse({ start: '10:00', end: '14:00' }).success).toBe(true);
    expect(templateParamValueSchema.safeParse({ start: '10:00' }).success).toBe(false);
  });
});
