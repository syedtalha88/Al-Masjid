import express, { type RequestHandler } from 'express';

import { ApiProblem } from './problem.ts';
import { isMultipart } from './upload.ts';

/** JSON body limit (03 §0). Uploads use busboy on their own routes. */
export const JSON_BODY_LIMIT = '32kb';

const METHODS_WITH_BODY = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * Middleware 3 (03 §0): JSON body parsing with a hard size limit.
 *
 * - A request that carries a body (`Content-Length > 0` or chunked) must be `application/json`,
 *   otherwise 415 `UNSUPPORTED_MEDIA_TYPE` — so a form post can't sneak past validation. `multipart/form-data` passes
 *   unparsed: only routes declared with `upload` read it (after auth), every other route answers it with 415.
 * - Malformed JSON → 400 `INVALID_JSON`; too large → 413 `PAYLOAD_TOO_LARGE` (mapped in errors.ts).
 * - `strict: true` accepts only objects/arrays at the top level.
 * - `inflate: false`: our clients never compress request bodies, so any `Content-Encoding` → 415. This also closes
 *   GHSA-27r3-jxmh-p828 (trailing bytes after a gzip frame crash the process in body-parser < 2.4.0).
 */
export function jsonBody(): RequestHandler[] {
  return [
    (req, _res, next) => {
      const hasBody =
        METHODS_WITH_BODY.has(req.method) &&
        (req.get('transfer-encoding') !== undefined || Number(req.get('content-length') ?? '0') > 0);
      if (hasBody && !req.is('application/json') && !isMultipart(req)) {
        next(new ApiProblem(415, 'UNSUPPORTED_MEDIA_TYPE', 'Send the request body as application/json.'));
        return;
      }
      next();
    },
    express.json({ limit: JSON_BODY_LIMIT, strict: true, inflate: false, type: 'application/json' }),
  ];
}
