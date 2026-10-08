import { randomUUID } from 'node:crypto';

import type { RequestHandler, Response } from 'express';

const HEADER = 'X-Request-Id';
/** Incoming ids are accepted only in this conservative shape (prevents log injection). */
const VALID_ID = /^[A-Za-z0-9-]{8,64}$/;

/**
 * Middleware 1 (03 §0): every request gets an `X-Request-Id` — the incoming one when well-formed
 * (e.g. set by Caddy), otherwise a new UUID — echoed on the response and stored in `res.locals`.
 */
export function requestId(): RequestHandler {
  return (req, res, next) => {
    const incoming = req.get(HEADER);
    const id = incoming !== undefined && VALID_ID.test(incoming) ? incoming : randomUUID();
    res.locals['requestId'] = id;
    res.set(HEADER, id);
    next();
  };
}

/** Reads the request id set by {@link requestId}. */
export function getRequestId(res: Response): string | undefined {
  const id: unknown = res.locals['requestId'];
  return typeof id === 'string' ? id : undefined;
}
