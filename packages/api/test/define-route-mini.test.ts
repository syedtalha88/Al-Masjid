import request from 'supertest';
import { describe, expect, it } from 'vitest';
import * as zm from 'zod/mini';

import { createPublicApp } from '../src/app.ts';
import { defineRoute } from '../src/http/define-route.ts';
import { silentLogger } from './helpers.ts';

// DECISIONS #92: public contracts are Zod Mini schemas; defineRoute validates them like classic ones, refuses a
// non-strict Mini request object at definition time, and documents them in OpenAPI as JSON Schema.

const Body = zm.strictObject({ name: zm.string().check(zm.maxLength(5)) });
const Reply = zm.object({ greeting: zm.string() });

const route = defineRoute({
  method: 'post',
  path: '/mini',
  summary: 'mini',
  auth: 'none',
  request: { body: Body },
  responses: { 200: Reply },
  handler: ({ body, reply }) => reply(200, { greeting: `hi ${body.name}` }),
});

describe('defineRoute with Zod Mini schemas', () => {
  const { app, registry } = createPublicApp({
    logger: silentLogger(),
    release: 't',
    trustedProxyMode: 'none',
    routes: [route],
  });

  it('validates bodies (unknown keys refused) and responses', async () => {
    expect((await request(app).post('/api/v1/mini').send({ name: 'Ali' })).body).toEqual({ greeting: 'hi Ali' });
    expect((await request(app).post('/api/v1/mini').send({ name: 'Ali', extra: 1 })).status).toBe(400);
    expect((await request(app).post('/api/v1/mini').send({ name: 'toolong' })).body).toMatchObject({
      code: 'VALIDATION_FAILED',
      errors: [{ path: 'body.name', code: 'too_big' }],
    });
  });

  it('refuses a non-strict Mini request object when the route is defined', () => {
    expect(() =>
      defineRoute({
        method: 'post',
        path: '/loose',
        summary: 'loose',
        auth: 'none',
        request: { body: zm.object({ a: zm.string() }) },
        responses: { 204: zm.object({}) },
        handler: ({ reply }) => reply(204, {}),
      }),
    ).toThrow(/strictObject/);
  });

  it('documents Mini schemas as JSON Schema', () => {
    const path = registry.definitions.find(
      (definition) => definition.type === 'route' && definition.route.path === '/api/v1/mini',
    );
    expect(JSON.stringify(path)).toContain('"maxLength":5');
  });
});
