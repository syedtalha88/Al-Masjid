// Super Admin Content Library API (03 §5, PHASE_03 T3.4, DECISIONS #108): the C8 review list, the import (dry run,
// then ★ all-or-nothing import as draft), edits, verification and retirement. The import file is read as one upload
// (DECISIONS #107), decoded as strict UTF-8 and checked row by row, so the report names every bad row. All writes go
// through the library state functions (scope, step-up, audit).
import type { Scope } from '@mc/db';
import { type DbHandle, parseId } from '@mc/db';
import { getLibraryEntryForSuper, listLibraryForSuper, type SuperLibraryRow } from '@mc/db/repos';
import {
  findLibraryDuplicates,
  importLibraryEntries,
  type LibraryEntryInput,
  libraryKey,
  type LibraryPatch,
  retireLibraryEntry,
  updateLibraryEntry,
  verifyLibraryEntry,
} from '@mc/db/state';
import {
  LIBRARY_IMPORT_MAX_BYTES,
  LIBRARY_REPORT_MAX_ISSUES,
  libraryImportFileSchema,
  type LibraryImportReport,
  libraryImportReportSchema,
  type LibraryImportRow,
  libraryImportRowSchema,
  libraryVerifySchema,
  type SuperLibraryEntry,
  superLibraryEntryResponseSchema,
  superLibraryListQuerySchema,
  superLibraryListSchema,
  type SuperLibraryPatch,
  superLibraryPatchSchema,
} from '@mc/shared/contracts';
import { z } from 'zod';

import { defineRoute, type RouteDefinition } from '../http/define-route.ts';
import { ApiProblem } from '../http/problem.ts';
import { findUnsafeKey } from '../http/unsafe-keys.ts';
import type { Upload } from '../http/upload.ts';

export interface SuperLibraryRouteDeps {
  readonly db: DbHandle;
}

const Id = z.object({ id: z.string().max(64) });

function entryIdOf(text: string) {
  const id = parseId(text);
  if (!id) throw new ApiProblem(404, 'LIBRARY_ENTRY_NOT_FOUND');
  return id;
}

const out = (row: SuperLibraryRow): SuperLibraryEntry => row;

const fileProblem = (code: string) => new ApiProblem(400, 'VALIDATION_FAILED', undefined, [{ path: 'file', code }]);

/** The file's JSON: strict UTF-8 (a leading BOM allowed), no `$` / dotted keys, the import envelope. */
function readImportFile(file: Upload | undefined): unknown[] {
  if (!file) throw fileProblem('required');
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(file.bytes);
  } catch {
    throw fileProblem('not_utf8');
  }
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw fileProblem('invalid_json');
  }
  const unsafe = findUnsafeKey(json);
  if (unsafe !== null) {
    throw new ApiProblem(400, 'UNSAFE_INPUT', undefined, [{ path: `file.${unsafe}`, code: 'unsafe_key' }]);
  }
  const envelope = libraryImportFileSchema.safeParse(json);
  if (!envelope.success) {
    throw new ApiProblem(
      400,
      'VALIDATION_FAILED',
      undefined,
      envelope.error.issues.map((issue) => ({ path: ['file', ...issue.path.map(String)].join('.'), code: issue.code })),
    );
  }
  return envelope.data.entries;
}

const entryOf = (row: LibraryImportRow): LibraryEntryInput => ({
  kind: row.kind,
  arabic: row.arabic,
  ...(row.transliteration ? { transliteration: row.transliteration } : {}),
  translation: row.translation,
  reference: row.reference,
  sourceName: row.source_name,
  sourceLicense: row.source_license,
  ...(row.tags ? { tags: row.tags } : {}),
  ...(row.dua_category ? { duaCategory: row.dua_category } : {}),
  ...(row.repeat === undefined ? {} : { repeat: row.repeat }),
  ...(row.occasions ? { occasions: row.occasions } : {}),
});

/**
 * The dry-run report: every row checked; duplicates (kind + reference) within the file and against the whole library.
 *
 * @returns the report (with `imported: 0`) and the importable entries — all of them, or none when anything is wrong.
 */
async function checkFile(
  db: DbHandle,
  scope: Scope,
  rows: readonly unknown[],
): Promise<{ report: LibraryImportReport; entries: LibraryEntryInput[] }> {
  const errors: LibraryImportReport['errors'] = [];
  const valid: { row: number; entry: LibraryEntryInput }[] = [];
  rows.forEach((value, index) => {
    const parsed = libraryImportRowSchema.safeParse(value);
    if (parsed.success) valid.push({ row: index + 1, entry: entryOf(parsed.data) });
    else
      for (const issue of parsed.error.issues)
        errors.push({ row: index + 1, path: issue.path.map(String).join('.'), message: issue.message });
  });
  const existing = await findLibraryDuplicates(
    db,
    scope,
    valid.map(({ entry }) => entry),
  );
  const seen = new Set<string>();
  const duplicates: LibraryImportReport['duplicates'] = [];
  for (const { row, entry } of valid) {
    const key = libraryKey(entry);
    const where = existing.has(key) ? 'library' : seen.has(key) ? 'file' : undefined;
    seen.add(key);
    if (where) duplicates.push({ row, kind: entry.kind, reference: entry.reference, in: where });
  }
  const badRows = new Set([...errors.map((error) => error.row), ...duplicates.map((duplicate) => duplicate.row)]);
  const report: LibraryImportReport = {
    entries: rows.length,
    valid: rows.length - badRows.size,
    errors: errors.slice(0, LIBRARY_REPORT_MAX_ISSUES),
    duplicates: duplicates.slice(0, LIBRARY_REPORT_MAX_ISSUES),
    truncated: errors.length > LIBRARY_REPORT_MAX_ISSUES || duplicates.length > LIBRARY_REPORT_MAX_ISSUES,
    imported: 0,
  };
  return { report, entries: badRows.size === 0 ? valid.map(({ entry }) => entry) : [] };
}

const patchOf = (body: SuperLibraryPatch): LibraryPatch => ({
  ...(body.arabic === undefined ? {} : { arabic: body.arabic }),
  ...(body.transliteration === undefined ? {} : { transliteration: body.transliteration }),
  ...(body.translation === undefined ? {} : { translation: body.translation }),
  ...(body.reference === undefined ? {} : { reference: body.reference }),
  ...(body.source_name === undefined ? {} : { sourceName: body.source_name }),
  ...(body.source_license === undefined ? {} : { sourceLicense: body.source_license }),
  ...(body.tags === undefined ? {} : { tags: body.tags }),
  ...(body.dua_category === undefined ? {} : { duaCategory: body.dua_category }),
  ...(body.repeat === undefined ? {} : { repeat: body.repeat }),
  ...(body.occasions === undefined ? {} : { occasions: body.occasions }),
});

/** Every `/api/super/library…` route (03 §5 "Library"). */
export function superLibraryRoutes(deps: SuperLibraryRouteDeps): RouteDefinition[] {
  const { db } = deps;
  const writes = [{ bucket: 'superWrites', key: 'session' }] as const;
  const reread = async (scope: Scope, text: string) => {
    const row = await getLibraryEntryForSuper(db, scope, entryIdOf(text));
    if (!row) throw new ApiProblem(404, 'LIBRARY_ENTRY_NOT_FOUND');
    return { entry: out(row) };
  };
  return [
    defineRoute({
      method: 'get',
      path: '/library',
      summary: 'Content Library review list — every status, filters and search (C8)',
      tags: ['super'],
      auth: 'super',
      request: { query: superLibraryListQuerySchema },
      responses: { 200: superLibraryListSchema },
      handler: async ({ auth, query, reply }) => {
        const page = await listLibraryForSuper(db, auth.scope, {
          ...(query.status ? { status: query.status } : {}),
          ...(query.kind ? { kind: query.kind } : {}),
          ...(query.category ? { category: query.category } : {}),
          ...(query.tag ? { tag: query.tag } : {}),
          ...(query.q ? { q: query.q } : {}),
          ...(query.cursor ? { cursor: query.cursor } : {}),
        });
        return reply(200, { entries: page.rows.map(out), ...(page.next ? { next: page.next } : {}) });
      },
    }),
    defineRoute({
      method: 'get',
      path: '/library/:id',
      summary: 'One Content Library entry in full, any status (C8 review)',
      tags: ['super'],
      auth: 'super',
      request: { params: Id },
      responses: { 200: superLibraryEntryResponseSchema },
      handler: async ({ auth, params, reply }) => reply(200, await reread(auth.scope, params.id)),
    }),
    defineRoute({
      method: 'post',
      path: '/library/import/dry-run',
      summary: 'Check a Content Library file: row errors and duplicates; nothing is written',
      tags: ['super'],
      auth: 'super',
      rateLimit: writes,
      upload: { maxBytes: LIBRARY_IMPORT_MAX_BYTES },
      responses: { 200: libraryImportReportSchema },
      handler: async ({ auth, file, reply }) => {
        const { report } = await checkFile(db, auth.scope, readImportFile(file));
        return reply(200, report);
      },
    }),
    defineRoute({
      method: 'post',
      path: '/library/import',
      summary: '★ Import a Content Library file as draft — all entries, or none when anything is wrong',
      tags: ['super'],
      auth: 'super_step_up',
      rateLimit: writes,
      upload: { maxBytes: LIBRARY_IMPORT_MAX_BYTES },
      responses: { 200: libraryImportReportSchema },
      handler: async ({ auth, file, clock, requestId, reply }) => {
        const { report, entries } = await checkFile(db, auth.scope, readImportFile(file));
        if (entries.length === 0) return reply(200, report);
        const { batchId, imported } = await importLibraryEntries(db, auth.scope, {
          entries,
          now: clock.now(),
          requestId,
        });
        return reply(200, { ...report, imported, batchId: batchId.toHexString(true) });
      },
    }),
    defineRoute({
      method: 'patch',
      path: '/library/:id',
      summary: 'Edit an entry — changing its text sends a verified entry back to draft (DECISIONS #108)',
      tags: ['super'],
      auth: 'super',
      rateLimit: writes,
      request: { params: Id, body: superLibraryPatchSchema },
      responses: { 200: superLibraryEntryResponseSchema },
      handler: async ({ auth, params, body, clock, requestId, reply }) => {
        await updateLibraryEntry(db, auth.scope, {
          id: entryIdOf(params.id),
          patch: patchOf(body),
          now: clock.now(),
          requestId,
        });
        return reply(200, await reread(auth.scope, params.id));
      },
    }),
    defineRoute({
      method: 'post',
      path: '/library/:id/verify',
      summary: 'Verify a draft entry (records who verified it); admins may pick it from now on',
      tags: ['super'],
      auth: 'super',
      rateLimit: writes,
      request: { params: Id, body: libraryVerifySchema },
      responses: { 200: superLibraryEntryResponseSchema },
      handler: async ({ auth, params, body, clock, requestId, reply }) => {
        await verifyLibraryEntry(db, auth.scope, {
          id: entryIdOf(params.id),
          verifiedBy: body.verifiedBy,
          now: clock.now(),
          requestId,
        });
        return reply(200, await reread(auth.scope, params.id));
      },
    }),
    defineRoute({
      method: 'post',
      path: '/library/:id/retire',
      summary: 'Retire an entry (final): no longer selectable or shown',
      tags: ['super'],
      auth: 'super',
      rateLimit: writes,
      request: { params: Id },
      responses: { 200: superLibraryEntryResponseSchema },
      handler: async ({ auth, params, clock, requestId, reply }) => {
        await retireLibraryEntry(db, auth.scope, { id: entryIdOf(params.id), now: clock.now(), requestId });
        return reply(200, await reread(auth.scope, params.id));
      },
    }),
  ];
}
