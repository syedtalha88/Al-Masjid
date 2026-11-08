// PHASE_04 T4.1 — the push adapter: answer classification, the headers and body of one push (decrypted here exactly
// as a browser would, RFC 8291 aes128gcm), the endpoint allow-list before any request, and job payloads refused at
// enqueue (before Redis is touched).
import { createDecipheriv, createECDH, hkdfSync, randomBytes } from 'node:crypto';

import { Redis } from 'ioredis';
import { describe, expect, it } from 'vitest';
import webpush from 'web-push';

import { buildPushRequest, classifyPushResponse, createPushSender, type PushTransport } from '../src/push/sender.ts';
import { InvalidJobPayloadError, parseJobPayload, sendBatchJobId } from '../src/queue/jobs.ts';
import { createJobQueues } from '../src/queue/queues.ts';
import { createMockPushService } from '../src/testing/mock-push.ts';

const VAPID = { subject: 'mailto:alerts@example.test', ...webpush.generateVAPIDKeys() };
const NOW = new Date('2026-11-08T06:30:00Z');

/** A browser-side subscription: its P-256 key pair and auth secret. */
function browserSubscription(endpoint = 'https://fcm.googleapis.com/fcm/send/test-1') {
  const ecdh = createECDH('prime256v1');
  ecdh.generateKeys();
  const auth = randomBytes(16);
  return {
    ecdh,
    auth,
    target: { endpoint, p256dh: ecdh.getPublicKey().toString('base64url'), auth: auth.toString('base64url') },
  };
}

/** RFC 8291 / RFC 8188 decryption of a single-record aes128gcm body, as the browser does it. */
function decrypt(body: Uint8Array, ecdh: ReturnType<typeof createECDH>, auth: Buffer): string {
  const buffer = Buffer.from(body);
  const salt = buffer.subarray(0, 16);
  const idLength = buffer.readUInt8(20);
  const serverKey = buffer.subarray(21, 21 + idLength);
  const cipherText = buffer.subarray(21 + idLength);
  const shared = ecdh.computeSecret(serverKey);
  const info = Buffer.concat([Buffer.from('WebPush: info\0'), ecdh.getPublicKey(), serverKey]);
  const ikm = Buffer.from(hkdfSync('sha256', shared, auth, info, 32));
  const cek = Buffer.from(hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: aes128gcm\0'), 16));
  const nonce = Buffer.from(hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: nonce\0'), 12));
  const decipher = createDecipheriv('aes-128-gcm', cek, nonce);
  decipher.setAuthTag(cipherText.subarray(cipherText.length - 16));
  const plain = Buffer.concat([decipher.update(cipherText.subarray(0, cipherText.length - 16)), decipher.final()]);
  const end = plain.lastIndexOf(2); // padding delimiter of the last record
  return plain.subarray(0, end).toString('utf8');
}

describe('classifyPushResponse (01 §5.3 step 3)', () => {
  it.each([200, 201, 202])('%i → sent', (status) => {
    expect(classifyPushResponse(status)).toEqual({ kind: 'sent' });
  });

  it.each([404, 410])('%i → gone (prune)', (status) => {
    expect(classifyPushResponse(status)).toEqual({ kind: 'gone', status });
  });

  it('429 / 5xx → retry, honouring Retry-After seconds or date (capped at an hour)', () => {
    expect(classifyPushResponse(429, '120')).toEqual({ kind: 'retry', status: 429, retryAfterS: 120 });
    expect(classifyPushResponse(503, null)).toEqual({ kind: 'retry', status: 503 });
    expect(classifyPushResponse(500, 'soon')).toEqual({ kind: 'retry', status: 500 });
    expect(classifyPushResponse(429, '999999')).toMatchObject({ retryAfterS: 3600 });
    const inAMinute = new Date(NOW.getTime() + 60_000).toUTCString();
    expect(classifyPushResponse(429, inAMinute, NOW)).toMatchObject({ retryAfterS: 60 });
  });

  it.each([301, 400, 401, 403, 413])('%i → rejected (neither retried nor pruned)', (status) => {
    expect(classifyPushResponse(status)).toEqual({ kind: 'rejected', status });
  });
});

describe('buildPushRequest', () => {
  it('builds TTL / Urgency / Topic / aes128gcm / VAPID headers and an encrypted body the browser can read', () => {
    const { ecdh, auth, target } = browserSubscription();
    const payload = JSON.stringify({ v: 1, t: 'Masjid', b: 'नोटिस — test' });
    const request = buildPushRequest(target, payload, { ttlS: 86_400, urgency: 'high', topic: 'seedA0000001' }, VAPID);

    expect(request.endpoint).toBe(target.endpoint);
    expect(request.headers).toMatchObject({
      TTL: '86400',
      Urgency: 'high',
      Topic: 'seedA0000001',
      'Content-Encoding': 'aes128gcm',
      'Content-Type': 'application/octet-stream',
      'Content-Length': String(request.body.length),
    });
    const authorization = request.headers['Authorization'] ?? '';
    expect(authorization).toMatch(/^vapid t=[\w-]+\.[\w-]+\.[\w-]+, k=[\w-]+$/);
    expect(authorization).toContain(`k=${VAPID.publicKey}`);
    const jwt = /t=([\w-]+)\.([\w-]+)\./.exec(authorization);
    const claims = JSON.parse(Buffer.from(jwt?.[2] ?? '', 'base64url').toString()) as Record<string, unknown>;
    expect(claims).toMatchObject({ aud: 'https://fcm.googleapis.com', sub: VAPID.subject });
    expect(JSON.stringify(request.headers)).not.toContain(VAPID.privateKey);

    expect(decrypt(request.body, ecdh, auth)).toBe(payload);
  });

  it('normal urgency and no Topic header when none is given', () => {
    const { target } = browserSubscription();
    const request = buildPushRequest(target, '{}', { ttlS: 43_200, urgency: 'normal' }, VAPID);
    expect(request.headers).toMatchObject({ TTL: '43200', Urgency: 'normal' });
    expect(request.headers).not.toHaveProperty('Topic');
  });

  it('refuses a topic that is not URL-safe base64 of at most 32 characters', () => {
    const { target } = browserSubscription();
    expect(() => buildPushRequest(target, '{}', { ttlS: 60, urgency: 'normal', topic: 'a+b' }, VAPID)).toThrow();
    expect(() =>
      buildPushRequest(target, '{}', { ttlS: 60, urgency: 'normal', topic: 'a'.repeat(33) }, VAPID),
    ).toThrow();
  });
});

describe('createPushSender', () => {
  const options = { ttlS: 60, urgency: 'normal' as const };

  it('sends through the transport and classifies the answer', async () => {
    const service = createMockPushService();
    const { target } = browserSubscription();
    service.answer(target.endpoint, 201, 410);
    const sender = createPushSender({ vapid: VAPID, transport: service.transport });
    expect(await sender.send(target, '{"a":1}', options)).toEqual({ kind: 'sent' });
    expect(await sender.send(target, '{"a":1}', options)).toEqual({ kind: 'gone', status: 410 });
    expect(service.requests.map((entry) => entry.payload)).toEqual(['{"a":1}', '{"a":1}']);
  });

  it('never contacts a host outside the allow-list', async () => {
    let called = false;
    const transport: PushTransport = () => {
      called = true;
      return Promise.resolve({ status: 201 });
    };
    const sender = createPushSender({ vapid: VAPID, transport });
    const { target } = browserSubscription('https://metadata.internal.example/push');
    expect(await sender.send(target, '{}', options)).toEqual({ kind: 'rejected', status: 0 });
    expect(called).toBe(false);
  });

  it('a network error or timeout is a retry; keys that do not decode are rejected', async () => {
    const service = createMockPushService();
    const { target } = browserSubscription();
    service.answer(target.endpoint, 'network-error');
    const sender = createPushSender({ vapid: VAPID, transport: service.transport });
    expect(await sender.send(target, '{}', options)).toEqual({ kind: 'retry' });
    expect(await sender.send({ ...target, p256dh: 'not-a-key' }, '{}', options)).toEqual({
      kind: 'rejected',
      status: 0,
    });
  });
});

describe('job payloads (T4.1)', () => {
  const JOB = '6f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b';

  it('valid payloads parse; invalid ones are refused naming only the job', () => {
    expect(parseJobPayload('push-fanout', { jobId: JOB })).toEqual({ jobId: JOB });
    for (const bad of [{}, { jobId: 'x' }, { jobId: JOB, extra: 1 }, null, 'text']) {
      expect(() => parseJobPayload('push-fanout', bad)).toThrow(InvalidJobPayloadError);
    }
    expect(() =>
      parseJobPayload('push-send-batch', { jobId: JOB, page: 0, locale: 'en', deviceIds: Array(1001).fill(JOB) }),
    ).toThrow('invalid push-send-batch job payload');
    expect(() =>
      parseJobPayload('alert-send', { alertId: 'a', to: { kind: 'super' }, alert: { type: 'free_text' } }),
    ).toThrow(InvalidJobPayloadError);
  });

  it('enqueue refuses an invalid payload before it reaches Redis', async () => {
    // The connection is never used: validation comes first, before any queue (or Redis) exists.
    const queues = createJobQueues(new Redis({ lazyConnect: true }), 'test:unused');
    await expect(queues.enqueue('push-fanout', { jobId: 'not-an-id' })).rejects.toThrow(InvalidJobPayloadError);
  });

  it('send-batch job ids are colon-free (BullMQ) and unique per page and locale', () => {
    expect(sendBatchJobId(JOB, 3, 'ur')).toBe(`${JOB}.3.ur`);
    expect(sendBatchJobId(JOB, 3, 'ur')).not.toContain(':');
  });
});
