import type { RequestHandler } from 'express';

import { ApiProblem } from './problem.ts';

/**
 * 04 §8: the APIs are same-origin only — no CORS headers anywhere and no `cors` middleware.
 * A CORS preflight (`OPTIONS` with `Access-Control-Request-Method`) is answered with 403.
 */
export function rejectPreflight(): RequestHandler {
  return (req, _res, next) => {
    if (req.method === 'OPTIONS' && req.get('access-control-request-method') !== undefined) {
      next(new ApiProblem(403, 'CORS_NOT_ALLOWED'));
      return;
    }
    next();
  };
}
