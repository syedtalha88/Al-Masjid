import { z } from 'zod';

import { defineRoute, type RouteDefinition } from '../http/define-route.ts';

export const HealthResponse = z
  .object({
    ok: z.literal(true),
    service: z.enum(['api-public', 'api-admin']),
    release: z.string(),
  })
  .meta({ id: 'HealthResponse' });

/**
 * `GET /health` — liveness + build version only (03 §3). MongoDB/Redis pings are added in Phase 1
 * (01 §10). Used by Docker healthchecks and the deploy smoke test.
 */
export function healthRoute(service: 'api-public' | 'api-admin', release: string): RouteDefinition {
  return defineRoute({
    method: 'get',
    path: '/health',
    summary: 'Liveness and build version',
    tags: ['system'],
    auth: 'none',
    responses: { 200: HealthResponse },
    handler: ({ reply }) => reply(200, { ok: true, service, release }),
  });
}
