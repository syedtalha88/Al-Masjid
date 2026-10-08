import { OpenApiGeneratorV31 } from '@asteasolutions/zod-to-openapi';
import { pino } from 'pino';

import { createAdminApp, createPublicApp } from './app.ts';

/**
 * Builds the committed OpenAPI document (03 header) from every route registered by both apps.
 * CI regenerates it and fails when `packages/api/openapi.json` is out of date.
 */
export function buildOpenApiDocument(): ReturnType<OpenApiGeneratorV31['generateDocument']> {
  const deps = { logger: pino({ level: 'silent' }), release: 'openapi', trustedProxyMode: 'none' as const };
  const definitions = [createPublicApp(deps).registry, createAdminApp(deps).registry].flatMap(
    (registry) => registry.definitions,
  );
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
