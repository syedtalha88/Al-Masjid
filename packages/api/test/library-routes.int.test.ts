// PHASE_03 T3.4 (API) against a migrated MongoDB as api-admin's own database user: the Content Library import (dry
// run → ★ all-or-nothing import as draft), file checks (UTF-8, JSON, envelope, size, multipart only), edits, verify,
// retire, and the admin reads — verified entries only (acceptance), today's suggestion, other masjids unreachable —
// and (T3.7) publishing a verified hadith as daily content, with the suggestion's "already one today" flag.
// Religious text: the 10 §5 placeholders only.
import { itemPublishedSchema, LIBRARY_IMPORT_FORMAT, LIBRARY_IMPORT_MAX_BYTES } from '@mc/shared/contracts';
import request from 'supertest';
import { describe, expect, it } from 'vitest';

import { CSRF, superHarness } from './super-harness.ts';

const { app, asSuper, stepUp, register, db } = superHarness('library_routes');

let counter = 0;
const row = (over: Record<string, unknown> = {}) => {
  counter += 1;
  return {
    kind: 'hadith',
    arabic: 'نَصٌّ تجريبي للعرض فقط',
    transliteration: { en: 'Sample transliteration — DEV ONLY' },
    translation: { en: 'Sample translation text for development. Not a real hadith.' },
    reference: `DEV-SAMPLE-${String(500 + counter)}`,
    source_name: 'Development fixture',
    source_license: 'N/A — not for production',
    tags: ['patience'],
    ...over,
  };
};
const file = (entries: unknown[]) =>
  Buffer.from(JSON.stringify({ format: LIBRARY_IMPORT_FORMAT, version: 1, entries }));
const upload = (path: string, bytes: Buffer) =>
  asSuper('post', path).attach('file', bytes, { filename: 'library.json', contentType: 'application/json' });
const count = () => db().collection('content_library').countDocuments();

interface Report {
  entries: number;
  valid: number;
  imported: number;
  errors: { row: number; path: string }[];
  duplicates: { row: number; in: string }[];
  batchId?: string;
}

describe('import: dry run, then ★ all or nothing', () => {
  it('the dry run reports row errors and duplicates (file and library) and writes nothing', async () => {
    const existing = row();
    await stepUp(true);
    expect((await upload('/library/import', file([existing]))).body).toMatchObject({ imported: 1 });
    await stepUp(false);
    const before = await count();
    const twin = row();
    const { source_license: _dropped, ...unlicensed } = row();
    const response = await upload('/library/import/dry-run', file([twin, unlicensed, { ...twin }, { ...existing }]));
    expect(response.status).toBe(200);
    const report = response.body as Report;
    expect(report).toMatchObject({ entries: 4, valid: 1, imported: 0 });
    expect(report.errors).toEqual([expect.objectContaining({ row: 2, path: 'source_license' })]);
    expect(report.duplicates).toEqual([
      expect.objectContaining({ row: 3, in: 'file' }),
      expect.objectContaining({ row: 4, in: 'library' }),
    ]);
    expect(await count()).toBe(before);
  });

  it('★ import needs a fresh step-up; then every entry is a draft; a bad file imports nothing', async () => {
    await stepUp(false);
    const rows = [row(), row({ kind: 'dhikr', repeat: 33, occasions: ['after_salah'], tags: [] })];
    const refused = await upload('/library/import', file(rows));
    expect(refused.status).toBe(403);
    expect(refused.body).toMatchObject({ code: 'STEP_UP_REQUIRED' });
    await stepUp(true);
    const before = await count();
    const bad = await upload('/library/import', file([row(), row({ repeat: 3 })]));
    expect(bad.body).toMatchObject({ imported: 0, valid: 1 });
    expect(await count()).toBe(before);
    const done = await upload('/library/import', file(rows));
    expect(done.status).toBe(200);
    expect(done.body).toMatchObject({ entries: 2, valid: 2, imported: 2, batchId: expect.any(String) as unknown });
    const stored = await db().collection('content_library').find({ reference: rows[0]?.reference }).toArray();
    expect(stored[0]).toMatchObject({ status: 'draft' });
    const audit = await db().collection('audit_log').findOne({ action: 'library.import', 'meta.entries': 2 });
    expect(audit).toMatchObject({ actor_type: 'super_admin' });
  });

  it('refuses what is not an import file: not UTF-8, not JSON, wrong envelope, unsafe keys, too large, not multipart', async () => {
    const problem = (response: request.Response, status: number, code: string) => {
      expect(response.status).toBe(status);
      expect(response.body).toMatchObject({ code });
    };
    problem(await upload('/library/import/dry-run', Buffer.from([0xff, 0xfe, 0x00])), 400, 'VALIDATION_FAILED');
    problem(await upload('/library/import/dry-run', Buffer.from('{"format":')), 400, 'VALIDATION_FAILED');
    problem(
      await upload(
        '/library/import/dry-run',
        Buffer.from(JSON.stringify({ format: 'other', version: 1, entries: [row()] })),
      ),
      400,
      'VALIDATION_FAILED',
    );
    problem(await upload('/library/import/dry-run', file([{ ...row(), $where: 'x' }])), 400, 'UNSAFE_INPUT');
    problem(
      await upload('/library/import/dry-run', Buffer.alloc(LIBRARY_IMPORT_MAX_BYTES + 1)),
      413,
      'PAYLOAD_TOO_LARGE',
    );
    problem(await asSuper('post', '/library/import/dry-run').send({ entries: [] }), 415, 'UNSUPPORTED_MEDIA_TYPE');
    // Unauthenticated: refused before the body is read.
    const anonymous = await request(app())
      .post('/api/super/library/import/dry-run')
      .set(CSRF)
      .attach('file', file([row()]), 'library.json');
    expect(anonymous.status).toBe(401);
  });
});

describe('review: list, edit, verify, retire', () => {
  const importOne = async (over: Record<string, unknown> = {}) => {
    const entry = row(over);
    await stepUp(true);
    await upload('/library/import', file([entry]));
    const list = await asSuper('get', `/library?q=${encodeURIComponent(entry.reference)}`);
    const [first] = (list.body as { entries: { id: string; reference: string }[] }).entries;
    if (!first) throw new Error('not imported');
    return first.id;
  };

  it('verify → edit text (back to draft) → verify → retire, each returning the entry; unknown ids → 404', async () => {
    const id = await importOne();
    const verified = await asSuper('post', `/library/${id}/verify`).send({ verifiedBy: 'Test Reviewer' });
    expect(verified.body).toMatchObject({ entry: { id, status: 'verified', verifiedBy: 'Test Reviewer' } });
    const tagged = await asSuper('patch', `/library/${id}`).send({ tags: ['sabr'] });
    expect(tagged.body).toMatchObject({ entry: { status: 'verified', tags: ['sabr'] } });
    const edited = await asSuper('patch', `/library/${id}`).send({
      translation: { en: 'Sample corrected translation text for development.' },
    });
    expect(edited.body).toMatchObject({ entry: { status: 'draft' } });
    expect(edited.body).not.toHaveProperty('entry.verifiedBy');
    const retired = await asSuper('post', `/library/${id}/retire`);
    expect(retired.body).toMatchObject({ entry: { status: 'retired' } });
    const again = await asSuper('post', `/library/${id}/retire`);
    expect(again.status).toBe(409);
    expect((await asSuper('get', '/library/not-an-id')).status).toBe(404);
    expect((await asSuper('get', `/library/${'0'.repeat(32)}`)).body).toMatchObject({
      code: 'LIBRARY_ENTRY_NOT_FOUND',
    });
    expect((await asSuper('patch', `/library/${id}`).send({ kind: 'ayah' })).status).toBe(400);
  });
});

describe('masjid admins: verified entries only (T3.4 acceptance), suggestion', () => {
  it('browse and suggestion show verified entries only; another masjid answers 404', async () => {
    const masjid = await asSuper('post', '/masjids').send({
      name: 'Test Masjid Library',
      area: 'Test Area',
      city: 'Hyderabad',
      state: 'Telangana',
      address: 'Test address',
      lat: 17.385,
      lng: 78.4867,
    });
    const masjidId = (masjid.body as { id: string }).id;
    const admin = await asSuper('post', '/admins').send({
      displayName: 'Test Imam',
      uiLocale: 'en',
      masjidId,
      role: 'owner',
    });
    const cookie = await register((admin.body as { inviteUrl: string }).inviteUrl);

    const draft = row({ kind: 'ayah', tags: ['draftonly'] });
    const shown = row({ kind: 'ayah', tags: ['shownonly'] });
    await stepUp(true);
    await upload('/library/import', file([draft, shown]));
    const listed = await asSuper('get', `/library?q=${encodeURIComponent(shown.reference)}`);
    const shownId = (listed.body as { entries: { id: string }[] }).entries[0]?.id ?? '';
    await asSuper('post', `/library/${shownId}/verify`).send({ verifiedBy: 'Test Reviewer' });

    const browse = await request(app()).get(`/api/admin/masjids/${masjidId}/library?kind=ayah`).set('Cookie', cookie);
    expect(browse.status).toBe(200);
    const references = (browse.body as { entries: { reference: string }[] }).entries.map((entry) => entry.reference);
    expect(references).toContain(shown.reference);
    expect(references).not.toContain(draft.reference);
    expect(JSON.stringify(browse.body)).not.toContain('search_text');
    const searched = await request(app())
      .get(`/api/admin/masjids/${masjidId}/library?q=draftonly`)
      .set('Cookie', cookie);
    expect((searched.body as { entries: unknown[] }).entries).toEqual([]);

    const suggestion = await request(app())
      .get(`/api/admin/masjids/${masjidId}/library/suggestion?kind=ayah`)
      .set('Cookie', cookie);
    expect(suggestion.status).toBe(200);
    expect(suggestion.body).toMatchObject({ entry: { kind: 'ayah' } });
    expect((suggestion.body as { entry: { reference: string } }).entry.reference).not.toBe(draft.reference);

    const elsewhere = await request(app())
      .get(`/api/admin/masjids/${'0'.repeat(32)}/library`)
      .set('Cookie', cookie);
    expect(elsewhere.status).toBe(404);
    expect(elsewhere.body).toMatchObject({ code: 'MASJID_NOT_FOUND' });
  });
});

describe('daily content (T3.7): POST /items/daily-content and the "already today" flag', () => {
  it('publishes a verified hadith with a note; the suggestion then says one went out today; refusals', async () => {
    const masjid = await asSuper('post', '/masjids').send({
      name: 'Test Masjid Daily',
      area: 'Test Area',
      city: 'Hyderabad',
      state: 'Telangana',
      address: 'Test address',
      lat: 17.385,
      lng: 78.4867,
    });
    const masjidId = (masjid.body as { id: string }).id;
    const admin = await asSuper('post', '/admins').send({
      displayName: 'Test Imam',
      uiLocale: 'en',
      masjidId,
      role: 'owner',
    });
    const cookie = await register((admin.body as { inviteUrl: string }).inviteUrl);
    // Writes need the accepted undertaking (B2).
    const settings = await asSuper('get', '/settings');
    const version = (settings.body as { undertakingVersion: string }).undertakingVersion;
    await request(app()).post('/api/admin/auth/undertaking').set(CSRF).set('Cookie', cookie).send({ version });

    const hadith = row({ tags: ['dailyhadith'] });
    const drafted = row({ tags: ['dailydraft'] });
    await stepUp(true);
    await upload('/library/import', file([hadith, drafted]));
    const idOf = async (reference: string) =>
      ((await asSuper('get', `/library?q=${encodeURIComponent(reference)}`)).body as { entries: { id: string }[] })
        .entries[0]?.id ?? '';
    const hadithId = await idOf(hadith.reference);
    const draftId = await idOf(drafted.reference);
    await asSuper('post', `/library/${hadithId}/verify`).send({ verifiedBy: 'Test Reviewer' });

    const flag = async () =>
      (
        (
          await request(app())
            .get(`/api/admin/masjids/${masjidId}/library/suggestion?kind=hadith`)
            .set('Cookie', cookie)
        ).body as { publishedToday: boolean }
      ).publishedToday;
    const publish = (body: object, id = masjidId) =>
      request(app()).post(`/api/admin/masjids/${id}/items/daily-content`).set('Cookie', cookie).set(CSRF).send(body);

    expect(await flag()).toBe(false);
    const published = await publish({ libraryId: hadithId, note: 'Test note from the masjid.', notify: false });
    expect(published.status).toBe(201);
    const { item, notification } = itemPublishedSchema.parse(published.body);
    expect(notification).toBeNull();
    const publicId = item.publicId;
    expect(await db().collection('items').findOne({ public_id: publicId })).toMatchObject({
      type: 'daily_content',
      daily: { kind: 'hadith', note: 'Test note from the masjid.' },
    });
    expect(await flag()).toBe(true); // a second one is allowed — B6 warns first

    const notified = await publish({ libraryId: hadithId, notify: true });
    expect(notified.status).toBe(201);
    expect(notified.body).toMatchObject({ notification: { queued: true, targeted: 0, quotaLeft: 7 } });

    expect((await publish({ libraryId: draftId, notify: false })).body).toMatchObject({
      status: 404,
      code: 'LIBRARY_ENTRY_NOT_FOUND',
    });
    for (const body of [
      { libraryId: 'not-an-id', notify: false },
      { libraryId: hadithId, note: 'x'.repeat(201), notify: false },
      { libraryId: hadithId, note: '', notify: false },
      { libraryId: hadithId, kind: 'ayah', notify: false }, // the kind is the entry's own
      { libraryId: hadithId, title: 'Test title', notify: false }, // free-form text is not allowed (00 §4.3)
    ]) {
      expect((await publish(body)).body).toMatchObject({ status: 400, code: 'VALIDATION_FAILED' });
    }
    expect((await publish({ libraryId: hadithId, note: 'x'.repeat(200), notify: false })).status).toBe(201);
    expect((await publish({ libraryId: hadithId, notify: false }, '0'.repeat(32))).body).toMatchObject({
      code: 'MASJID_NOT_FOUND',
    });
  });
});
