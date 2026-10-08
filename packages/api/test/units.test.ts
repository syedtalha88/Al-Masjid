import type { Request } from 'express';
import { describe, expect, it } from 'vitest';

import { clientIp } from '../src/http/client-ip.ts';
import { toOpenApiPath } from '../src/http/define-route.ts';
import { ApiProblem, problemBody } from '../src/http/problem.ts';
import { findUnsafeKey } from '../src/http/unsafe-keys.ts';
import { createLogger } from '../src/logger.ts';
import { buildOpenApiDocument } from '../src/openapi.ts';

const fakeRequest = (headers: Record<string, string>, remoteAddress?: string) =>
  ({
    get: (name: string) => headers[name.toLowerCase()],
    socket: { remoteAddress },
  }) as unknown as Request; // minimal shape used by clientIp

describe('clientIp (rate limits only, never stored)', () => {
  it('uses CF-Connecting-IP behind Cloudflare', () => {
    expect(clientIp(fakeRequest({ 'cf-connecting-ip': '203.0.113.7' }, '172.18.0.2'), 'cloudflare')).toBe(
      '203.0.113.7',
    );
    expect(clientIp(fakeRequest({ 'cf-connecting-ip': '2001:db8::1' }), 'cloudflare')).toBe('2001:db8::1');
  });

  it('rejects a missing or malformed header', () => {
    expect(clientIp(fakeRequest({}), 'cloudflare')).toBeNull();
    expect(clientIp(fakeRequest({ 'cf-connecting-ip': '1.2.3.4, 5.6.7.8' }), 'cloudflare')).toBeNull();
  });

  it('uses the socket address locally and ignores spoofable headers', () => {
    expect(clientIp(fakeRequest({ 'cf-connecting-ip': '203.0.113.7' }, '127.0.0.1'), 'none')).toBe('127.0.0.1');
    expect(clientIp(fakeRequest({}), 'none')).toBeNull();
  });
});

describe('findUnsafeKey', () => {
  it.each([
    [{ $ne: 1 }, '$ne'],
    [{ a: { b: [{ 'c.d': 1 }] } }, 'a.b[0].c.d'],
    [[{ ok: 1 }, { $gt: 0 }], '[1].$gt'],
  ])('finds %j at %s', (value, path) => {
    expect(findUnsafeKey(value)).toBe(path);
  });

  it('accepts clean input and primitives', () => {
    expect(findUnsafeKey({ a: 'x$y', b: ['$ok as a value'], c: null })).toBeNull();
    expect(findUnsafeKey('string')).toBeNull();
    expect(findUnsafeKey(undefined)).toBeNull();
  });

  it('stops at the depth limit', () => {
    let deep: unknown = 'leaf';
    for (let i = 0; i < 10; i += 1) deep = { n: deep };
    expect(findUnsafeKey(deep, 3)).toBe('n.n.n.n');
    expect(findUnsafeKey([[['x']]], 1)).toBe('[0][0]');
  });
});

describe('problem details', () => {
  it('builds RFC 9457 bodies with a URN type', () => {
    expect(problemBody(415, 'UNSUPPORTED_MEDIA_TYPE')).toEqual({
      type: 'urn:masjid-connect:problem:unsupported-media-type',
      title: 'Unsupported Media Type',
      status: 415,
      code: 'UNSUPPORTED_MEDIA_TYPE',
    });
    expect(problemBody(418, 'INTERNAL_ERROR').title).toBe('Error');
  });

  it('ApiProblem message is for logs only', () => {
    expect(new ApiProblem(404, 'NOT_FOUND').message).toBe('404 NOT_FOUND');
    expect(new ApiProblem(400, 'VALIDATION_FAILED', 'Bad').message).toBe('400 VALIDATION_FAILED: Bad');
  });
});

describe('toOpenApiPath', () => {
  it('converts Express params', () => {
    expect(toOpenApiPath('/masjids/:id/feed/:cursor')).toBe('/masjids/{id}/feed/{cursor}');
  });
});

describe('logger', () => {
  it('redacts secret-looking fields and tags every line with process + release', () => {
    const chunks: string[] = [];
    const logger = createLogger({
      process: 'api-admin',
      level: 'info',
      release: 'abc123',
      destination: { write: (chunk: string) => chunks.push(chunk) },
    });
    logger.info(
      { token: 'T-SECRET', admin: { phone: '+91 98765 43210' }, headers: { authorization: 'A-SECRET' } },
      'hello',
    );
    const line = JSON.parse(chunks.join('')) as Record<string, unknown>; // one JSON line
    expect(JSON.stringify(line)).not.toMatch(/T-SECRET|98765|A-SECRET/);
    expect(line).toMatchObject({
      process: 'api-admin',
      release: 'abc123',
      level: 'info',
      msg: 'hello',
      token: '[redacted]',
    });
  });
});

describe('OpenAPI document', () => {
  it('contains both health routes', () => {
    const document = buildOpenApiDocument();
    expect(Object.keys(document.paths ?? {})).toEqual(expect.arrayContaining(['/api/v1/health', '/api/admin/health']));
  });
});
