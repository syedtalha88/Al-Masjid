import { z } from 'zod';

import { defineRoute, type RouteDefinition } from '../http/define-route.ts';

const DependencyState = z.enum(['ok', 'down', 'unchecked']);

export const HealthResponse = z
  .object({
    ok: z.boolean(),
    service: z.enum(['api-public', 'api-admin']),
    version: z.string(),
    db: DependencyState,
    redis: DependencyState,
  })
  .meta({ id: 'HealthResponse' });

/** Dependency checks for `/health`: each resolves `true` when reachable. Must not throw (a throw counts as down). */
export interface HealthProbes {
  readonly db: () => Promise<boolean>;
  readonly redis: () => Promise<boolean>;
}

/** A probe slower than this counts as down — the healthcheck itself allows 3 s (apps/server healthcheck.ts). */
export const PROBE_TIMEOUT_MS = 2_000;

async function probe(check: (() => Promise<boolean>) | undefined): Promise<z.infer<typeof DependencyState>> {
  if (!check) return 'unchecked';
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<false>((resolve) => {
    timer = setTimeout(() => {
      resolve(false);
    }, PROBE_TIMEOUT_MS);
  });
  try {
    return (await Promise.race([check().catch(() => false), timeout])) ? 'ok' : 'down';
  } finally {
    clearTimeout(timer);
  }
}

/**
 * `GET /health` (03 §3, 01 §10): MongoDB ping, Redis ping and the build version — nothing else. 200 when every
 * checked dependency is up, otherwise 503 (container healthcheck, deploy wait, uptime monitor). The entrypoints always
 * pass both probes; `unchecked` only appears in tests that build an app without them.
 */
export function healthRoute(
  service: 'api-public' | 'api-admin',
  release: string,
  probes: Partial<HealthProbes> = {},
): RouteDefinition {
  return defineRoute({
    method: 'get',
    path: '/health',
    summary: 'Liveness, dependency pings and build version',
    tags: ['system'],
    auth: 'none',
    responses: { 200: HealthResponse, 503: HealthResponse },
    handler: async ({ reply }) => {
      const [db, redis] = await Promise.all([probe(probes.db), probe(probes.redis)]);
      const ok = db !== 'down' && redis !== 'down';
      const body = { ok, service, version: release, db, redis };
      return ok ? reply(200, body) : reply(503, body);
    },
  });
}
