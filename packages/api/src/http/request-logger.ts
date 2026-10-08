import type { IncomingMessage, ServerResponse } from 'node:http';

import type { RequestHandler } from 'express';
import type { Logger } from 'pino';
import { pinoHttp } from 'pino-http';

/**
 * Access log with **allow-listed** fields only (CLAUDE.md §6, 04 §10): request id, method, path
 * *without* the query string, status, duration. Never headers, bodies, cookies, query strings or IPs.
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
        path: (req.url ?? '').split('?')[0],
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
