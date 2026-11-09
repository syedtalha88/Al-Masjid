// PHASE_04 T4.4 / 04 R7 — no HTTP route can trigger a job. The route tables of both APIs (as OpenAPI registers them)
// have no queue, job or worker endpoint; the only job producers are the publish routes' after-commit hand-over of an
// outbox job they just committed, and the Super Admin's own test alert outside production (T4.6). The one jobs path
// is the admin's read-only notification history (T4.5).
import { describe, expect, it } from 'vitest';

import { buildOpenApiDocument } from '../src/openapi.ts';

const JOBISH = /\/(jobs?|queues?|bull|fan-?out|send-batch|outbox|sweep(er)?|workers?|push-(fanout|send))(\/|$)/i;
const METHODS = ['get', 'put', 'post', 'patch', 'delete'] as const;

/** Every (method, path) the two APIs register. */
function routes(): { method: string; path: string }[] {
  const document = buildOpenApiDocument();
  return Object.entries(document.paths ?? {}).flatMap(([path, item]) =>
    METHODS.filter((method) => item[method] !== undefined).map((method) => ({ method, path })),
  );
}

describe('route table (no HTTP route triggers a job)', () => {
  it('no queue, job or worker endpoint except the read-only notification history', () => {
    const jobish = routes().filter((route) => JOBISH.test(route.path));
    for (const route of jobish) {
      expect(route.path).toMatch(/\/notifications\/jobs$/);
      expect(route.method).toBe('get');
    }
  });

  it('api-public has no push route besides the device subscription', () => {
    const publicPush = routes().filter(
      (route) => route.path.startsWith('/api/v1') && /push|notif|alert/i.test(route.path),
    );
    for (const route of publicPush) expect(route.path).toBe('/api/v1/devices/me/push');
  });
});
