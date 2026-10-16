import type { IncomingMessage, ServerResponse } from 'node:http';

import type { RequestHandler } from 'express';
import type { Logger } from 'pino';
import { pinoHttp } from 'pino-http';

const UUID_SEGMENT = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Path segments that look like secrets — 32+ base64url/hex characters, e.g. the invite token in
 * `GET /auth/invite/:token` — are replaced, so a live token never reaches the 180-day log archive. Canonical UUIDs
 * (resource ids) stay readable.
 */
export const redactPath = (path: string): string =>
  path.replace(/(?<=\/)[A-Za-z0-9_-]{32,}(?=\/|$)/g, (segment) => (UUID_SEGMENT.test(segment) ? segment : ':redacted'));

/**
 * Access log with **allow-listed** fields only (CLAUDE.md §6, 04 §10): request id, method, path *without* the query
 * string and with token-like segments redacted, status, duration. Never headers, bodies, cookies, query strings or IPs.
 */
export function requestLogger(logger: Logger): RequestHandler {
  return pinoHttp({
    logger,
    genReqId: (_req: IncomingMessage, res: ServerResponse) => {
      const id = res.getHeader('X-Request-Id');
      return typeof id === 'string' ? id : 'unknown';
    },
    customAttributeKeys: { responseTime: 'durationMs' },
    serializers: {
      req: (req: { id?: unknown; method?: string; url?: string }) => ({
        requestId: req.id,
        method: req.method,
        path: redactPath((req.url ?? '').split('?')[0] ?? ''),
      }),
      res: (res: { statusCode?: number }) => ({ status: res.statusCode }),
    },
    wrapSerializers: false,
    customLogLevel: (_req, res, error) => {
      if (error !== undefined || res.statusCode >= 500) return 'error';
      if (res.statusCode >= 400) return 'warn';
      return 'info';
    },
    customSuccessMessage: () => 'request completed',
    customErrorMessage: () => 'request failed',
  });
}
