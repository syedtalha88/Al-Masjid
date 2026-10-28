// Multipart uploads (04 §6 "Files", 01 §5.4–5.5): exactly one file per request, in the form field `file`, parsed with
// @fastify/busboy (DECISIONS #107) after auth and rate limits (defineRoute `upload`). Hard limits — one part, no other
// field, a byte limit — and the bytes stay in memory: nothing is ever written to disk.
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

/**
 * Reads the one file of a `multipart/form-data` request into memory.
 *
 * @param limits.maxBytes - the largest file accepted; one byte more is refused (the rest is discarded unread).
 * @throws ApiProblem 415 UNSUPPORTED_MEDIA_TYPE (not multipart), 413 PAYLOAD_TOO_LARGE (file over `maxBytes`), 400
 *   UPLOAD_INVALID (no file, a second part, any other field, a file under another field name, a malformed body).
 */
export function readUpload(req: Request, limits: { readonly maxBytes: number }): Promise<Upload> {
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
