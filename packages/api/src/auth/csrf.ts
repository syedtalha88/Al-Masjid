import type { RequestHandler } from 'express';

import { ApiProblem } from '../http/problem.ts';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Middleware 4 (03 §0/§1), api-admin only: every state-changing request must carry `X-MC-CSRF: 1` AND an `Origin`
 * exactly equal to `ADMIN_ORIGIN` (SameSite=Strict cookies are the first line; this is the second). Without a
 * configured origin every unsafe request is refused — the guard fails closed.
 *
 * @throws ApiProblem 403 `ORIGIN_REJECTED`.
 */
export function requireAdminOrigin(adminOrigin: string | undefined): RequestHandler {
  return (req, _res, next) => {
    if (SAFE_METHODS.has(req.method)) {
      next();
      return;
    }
    const origin = req.get('origin');
    if (adminOrigin === undefined || origin !== adminOrigin || req.get('x-mc-csrf') !== '1') {
      next(new ApiProblem(403, 'ORIGIN_REJECTED'));
      return;
    }
    next();
  };
}
