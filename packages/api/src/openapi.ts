import { OpenApiGeneratorV31 } from '@asteasolutions/zod-to-openapi';
import { createDbHandle } from '@mc/db';
import { systemClock } from '@mc/shared/clock';
import { pino } from 'pino';

import { createAdminApp, createPublicApp } from './app.ts';
import { memoryChallengeStore } from './auth/challenges.ts';
import { adminRoutes, apiPublicRoutes } from './routes/index.ts';

/**
 * Builds the committed OpenAPI document (03 header) from every route registered by both apps.
 * CI regenerates it and fails when `packages/api/openapi.json` is out of date.
 */
export function buildOpenApiDocument(): ReturnType<OpenApiGeneratorV31['generateDocument']> {
  const deps = { logger: pino({ level: 'silent' }), release: 'openapi', trustedProxyMode: 'none' as const };
  // Routes are only registered here, never called: the handle is created but never connects.
  const db = createDbHandle({ uri: 'mongodb://openapi.invalid', database: 'openapi', process: 'script', local: true });
  const admin = createAdminApp({
    ...deps,
    ...adminRoutes({
      db,
      pepper: Buffer.alloc(32),
      adminOrigin: 'https://admin.example',
      keyRing: { currentId: 'openapi', keys: new Map([['openapi', Buffer.alloc(32)]]) },
      rp: { id: 'admin.example', name: 'openapi', origin: 'https://admin.example' },
      challenges: memoryChallengeStore(systemClock),
      logger: deps.logger,
    }),
  });
  const publicApp = createPublicApp({
    ...deps,
    routes: apiPublicRoutes({ db, turnstile: () => Promise.resolve(false) }),
  });
  const definitions = [publicApp.registry, admin.registry].flatMap((registry) => registry.definitions);
  return new OpenApiGeneratorV31(definitions).generateDocument({
    openapi: '3.1.0',
    info: {
      title: 'Masjid Connect API',
      version: '1.0.0',
      description:
        'Public API (`/api/v1`, api-public) and admin API (`/api/admin`, api-admin). Errors: RFC 9457 problem+json.',
    },
  });
}
