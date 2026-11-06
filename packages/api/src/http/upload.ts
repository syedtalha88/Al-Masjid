// Multipart uploads (04 §6 "Files", 01 §5.4–5.5): exactly one file per request, in the form field `file`, parsed with
// @fastify/busboy (DECISIONS #107) after auth and rate limits (defineRoute `upload`). Hard limits — one part, no other
// field, a byte limit — and the bytes stay in memory: nothing is ever written to disk. At most
// MAX_UPLOADS_IN_FLIGHT uploads per process are held at once (DECISIONS #135): parallel 25 MB uploads from one session
// must not exhaust the process's memory for every other admin.
import Busboy, { type BusboyInstance } from '@fastify/busboy';
import type { Request } from 'express';

import { ApiProblem } from './problem.ts';

/** The multipart form field that carries the file. */
export const UPLOAD_FIELD = 'file';

/** One uploaded file. `filename` and `mimeType` are what the client claims — check content, never trust these. */
export interface Upload {
  readonly bytes: Buffer;
  readonly filename: string;
  readonly mimeType: string;
}

/** Is the request body `multipart/form-data`? */
export const isMultipart = (req: Request): boolean => typeof req.is('multipart/form-data') === 'string';

const invalid = () => new ApiProblem(400, 'UPLOAD_INVALID');

/** Uploads held in memory at once per process: 2 × 25 MB (and its copies) stays well inside api-admin's 384 MB. */
export const MAX_UPLOADS_IN_FLIGHT = 2;
let inFlight = 0;

/**
 * Reads the one file of a `multipart/form-data` request into memory.
 *
 * @param limits.maxBytes - the largest file accepted; one byte more is refused (the rest is discarded unread).
 * The upload's slot is held until the response is closed (the handler is done with the bytes).
 *
 * @throws ApiProblem 415 UNSUPPORTED_MEDIA_TYPE (not multipart), 413 PAYLOAD_TOO_LARGE (file over `maxBytes`), 400
 *   UPLOAD_INVALID (no file, a second part, any other field, a file under another field name, a malformed body), 503
 *   SERVICE_UNAVAILABLE with `Retry-After` (MAX_UPLOADS_IN_FLIGHT uploads are already being handled).
 */
export function readUpload(req: Request, limits: { readonly maxBytes: number }): Promise<Upload> {
  if (inFlight >= MAX_UPLOADS_IN_FLIGHT) {
    // The body is read and dropped (never kept), so the client finishes sending and reads the 503 instead of a reset.
    req.resume();
    return Promise.reject(
      new ApiProblem(503, 'SERVICE_UNAVAILABLE', 'Another upload is in progress.', undefined, { 'Retry-After': '5' }),
    );
  }
  inFlight += 1;
  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    inFlight -= 1;
  };
  if (req.res) req.res.once('close', release);
  else req.once('close', release);
  return new Promise((resolve, reject) => {
    let busboy: BusboyInstance;
    try {
      busboy = new Busboy({
        headers: { ...req.headers, 'content-type': req.get('content-type') ?? '' },
        limits: { files: 1, fields: 0, parts: 1, fileSize: limits.maxBytes, headerPairs: 20 },
      });
    } catch {
      reject(new ApiProblem(415, 'UNSUPPORTED_MEDIA_TYPE', 'Send the file as multipart/form-data.'));
      return;
    }
    let upload: Upload | undefined;
    let failure: ApiProblem | undefined;
    const fail = (problem: ApiProblem) => {
      failure ??= problem;
    };
    busboy.on('file', (field, stream, filename, _encoding, mimeType) => {
      if (field !== UPLOAD_FIELD) {
        fail(invalid());
        stream.resume();
        return;
      }
      const chunks: Buffer[] = [];
      stream.on('data', (chunk: Buffer) => chunks.push(chunk));
      stream.on('limit', () => {
        fail(new ApiProblem(413, 'PAYLOAD_TOO_LARGE'));
      });
      stream.on('end', () => {
        if (!stream.truncated) upload = { bytes: Buffer.concat(chunks), filename, mimeType };
      });
    });
    for (const event of ['field', 'partsLimit', 'filesLimit', 'fieldsLimit'] as const) {
      busboy.on(event, () => {
        fail(invalid());
      });
    }
    busboy.on('error', () => {
      reject(failure ?? invalid());
    });
    busboy.on('finish', () => {
      if (failure) reject(failure);
      else if (upload) resolve(upload);
      else reject(invalid());
    });
    req.on('error', () => {
      reject(invalid());
    });
    req.pipe(busboy);
  });
}
