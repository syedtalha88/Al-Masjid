// Masjid-scoped admin API (03 §4 "Masjid-scoped", PHASE_03): `/masjids/:masjidId/...` for the masjid's own admins. The
// repositories re-resolve the id under the session's scope (02 §4.1), so another masjid — or a malformed id — answers
// exactly like an unknown one (404 `MASJID_NOT_FOUND`).
import { type DbHandle, idText, parseId } from '@mc/db';
import {
  countNotifyAudience,
  getAdminSchedule,
  getMasjidProfile,
  getMasjidStats,
  getPushQuota,
  getRamadan,
  listItemsForAdmin,
  listSpecialDates,
  listTemplatesForAdmin,
  requireOwnMasjid,
} from '@mc/db/repos';
import {
  deleteItem,
  deleteSpecialDate,
  editItem,
  type ItemEdit,
  publishAnnouncement,
  publishDailyContent,
  publishDuaRequest,
  recordAudioUpload,
  recordImageUpload,
  requestMasjidChange,
  saveRamadan,
  saveSpecialDate,
  saveTimings,
  updateMasjidProfile,
} from '@mc/db/state';
import { resolveSchedule } from '@mc/domain/prayer';
import { addDays, calendarDateInZone } from '@mc/domain/time';
import {
  adminItemListQuerySchema,
  adminItemListSchema,
  adminMasjidProfileSchema,
  adminMasjidStatsSchema,
  adminScheduleSchema,
  adminSpecialDatesSchema,
  announcementPublishSchema,
  audioUploadedSchema,
  audioUploadQuerySchema,
  dailyContentPublishSchema,
  duaPublishSchema,
  imageUploadedSchema,
  imageUploadQuerySchema,
  type ItemEditBody,
  itemEditedSchema,
  itemEditSchema,
  itemPublishedSchema,
  masjidChangeRequestSchema,
  masjidPhotoQuerySchema,
  masjidProfilePatchSchema,
  pushQuotaSchema,
  ramadanSaveSchema,
  ramadanSchema,
  specialDateSavedSchema,
  specialDateSaveSchema,
  templateListSchema,
  timingsPreviewSchema,
  timingsSavedSchema,
  timingsSaveSchema,
} from '@mc/shared/contracts';
import type { Request } from 'express';
import { z } from 'zod';

import { defineRoute, type RouteDefinition } from '../http/define-route.ts';
import { ApiProblem } from '../http/problem.ts';
import { AUDIO_MAX_BYTES, AudioRejected, keptDuration, sniffAudio } from '../media/audio.ts';
import { IMAGE_MAX_BYTES, ImageRejected, sanitizeImage } from '../media/image.ts';
import { type MediaStore, newAudioKey, newImageKey } from '../media/store.ts';
import type { PushNotifier } from '../queue/queues.ts';

export interface AdminMasjidRouteDeps {
  readonly db: DbHandle;
  /** Photo storage and the origin its delivery URLs are on (T3.6); absent → `POST /images` answers 503. */
  readonly media?: { readonly store: MediaStore; readonly origin: string } | undefined;
  /** Hands a publish's outbox job to the worker after commit (T4.4); absent → the outbox sweeper does (≤ 2 min). */
  readonly notifier?: PushNotifier | undefined;
}

const Params = z.object({ masjidId: z.string().max(64) });

/** The masjid id from the path; a malformed one answers like an unknown masjid. */
function masjidIdOf(text: string) {
  const id = parseId(text);
  if (!id) throw new ApiProblem(404, 'MASJID_NOT_FOUND');
  return id;
}

const ItemParams = z.object({ masjidId: z.string().max(64), itemId: z.string().max(64) });

/** A post's id from the path; a malformed one answers like an unknown post. */
function itemIdOf(text: string) {
  const id = parseId(text);
  if (!id) throw new ApiProblem(404, 'ITEM_NOT_FOUND');
  return id;
}

/** A library id of an edit body (contract-checked UUID text). */
function libraryIdOf(text: string) {
  const id = parseId(text);
  if (!id) throw new ApiProblem(404, 'LIBRARY_ENTRY_NOT_FOUND');
  return id;
}

/** The PATCH body as the data layer takes it (instants as Dates, ids as UUIDs). */
function itemEditOf(body: ItemEditBody): ItemEdit {
  switch (body.type) {
    case 'announcement': {
      const { type, eventAt, image, ...announcement } = body;
      return {
        type,
        announcement: {
          ...announcement,
          ...(eventAt === undefined ? {} : { eventAt: new Date(eventAt) }),
          ...(image === undefined ? {} : { image }),
        },
      };
    }
    case 'daily_content':
      return {
        type: body.type,
        daily: { libraryId: libraryIdOf(body.libraryId), note: body.note, voice: body.voice, title: body.title },
      };
    case 'dua_request': {
      const { type, libraryId, janazaAt, ...dua } = body;
      return {
        type,
        dua: {
          ...dua,
          libraryId: libraryIdOf(libraryId),
          ...(janazaAt === undefined ? {} : { janazaAt: new Date(janazaAt) }),
        },
      };
    }
  }
}

/** `If-Match: "<updatedAt>"` of a post (quotes optional). Missing or malformed → 400. */
function updatedAtOf(header: string | undefined): string {
  const parsed = z.iso.datetime().safeParse(header?.replaceAll('"', ''));
  if (!parsed.success) throw new ApiProblem(400, 'VALIDATION_FAILED');
  return parsed.data;
}

const PreviewQuery = z.object({ date: z.iso.date() });
const SpecialParams = z.object({ masjidId: z.string().max(64), id: z.string().max(64) });
const Empty = z.object({});
/** The B11 list starts this many days back (recent entries stay editable). */
const SPECIAL_LIST_PAST_DAYS = 30;

/** A special date's id from the path; a malformed one answers like an unknown entry. */
function specialIdOf(text: string) {
  const id = parseId(text);
  if (!id) throw new ApiProblem(404, 'SPECIAL_DATE_NOT_FOUND');
  return id;
}

/**
 * PHASE_03 T3.1: the Admin Home's reads; T3.2: saving timings and the preview of a day; T3.3: special dates, Ramadan;
 * T3.6: photos, the template list and publishing a notice.
 */
export function adminMasjidRoutes(deps: AdminMasjidRouteDeps): RouteDefinition[] {
  const { db, media } = deps;
  const afterCommit = (jobId: string | null) => deps.notifier?.afterCommit(jobId) ?? Promise.resolve();
  const writes = [{ bucket: 'adminWrites', key: 'session' }] as const;
  // 03 §2: 30 uploads per hour per masjid (whichever admin uploads), and the session's write budget. The id is
  // lower-cased as `parseId` does, so another spelling of the same masjid shares its bucket (DECISIONS #135).
  const uploads = [
    { bucket: 'adminUploads', key: (req: Request) => req.params['masjidId']?.toString().toLowerCase() },
    ...writes,
  ] as const;

  /** Delivery URLs of a stored image on the media origin (01 §5.4). */
  const urlsOf = (key: string) => {
    if (!media) return undefined;
    const origin = media.origin.endsWith('/') ? media.origin.slice(0, -1) : media.origin;
    const url = (width: number) => `${origin}/i/${String(width)}/webp/${key}`;
    return { w480: url(480), w960: url(960), w1440: url(1440) };
  };

  /** An uploaded photo through the pipeline (magic bytes, size, re-encode, no metadata, ThumbHash) into the store. */
  const storeImage = async (masjidId: ReturnType<typeof masjidIdOf>, bytes: Buffer) => {
    if (!media) throw new ApiProblem(503, 'SERVICE_UNAVAILABLE');
    let image: Awaited<ReturnType<typeof sanitizeImage>>;
    try {
      image = await sanitizeImage(bytes);
    } catch (error) {
      if (error instanceof ImageRejected) throw new ApiProblem(422, 'IMAGE_INVALID');
      throw error;
    }
    const key = newImageKey(idText(masjidId));
    await media.store.putImage(key, image.master);
    return { key, image };
  };

  /** B13's profile with the photo's delivery URL. */
  const profileOf = async (scope: Parameters<typeof getMasjidProfile>[1], masjidId: ReturnType<typeof masjidIdOf>) => {
    const profile = await getMasjidProfile(db, scope, masjidId);
    if (!profile) throw new ApiProblem(404, 'MASJID_NOT_FOUND');
    const url = profile.photo ? urlsOf(profile.photo.key)?.w960 : undefined;
    return { ...profile, ...(profile.photo ? { photo: { ...profile.photo, ...(url ? { url } : {}) } } : {}) };
  };

  return [
    defineRoute({
      method: 'get',
      path: '/masjids/:masjidId/stats',
      summary: 'Followers, items published and Ameens in the last 7 days (B3 header)',
      tags: ['masjid'],
      auth: 'session',
      request: { params: Params },
      responses: { 200: adminMasjidStatsSchema },
      handler: async ({ auth, params, clock, reply }) =>
        reply(200, await getMasjidStats(db, auth.scope, masjidIdOf(params.masjidId), clock.now())),
    }),
    defineRoute({
      method: 'get',
      path: '/masjids/:masjidId/notifications/quota',
      summary: "Today's notifying publishes against the masjid's daily push quota (IST day)",
      tags: ['masjid'],
      auth: 'session',
      request: { params: Params },
      responses: { 200: pushQuotaSchema },
      handler: async ({ auth, params, clock, reply }) => {
        const quota = await getPushQuota(db, auth.scope, masjidIdOf(params.masjidId), clock.now());
        return reply(200, { used: quota.used, limit: quota.limit, resetsAt: quota.resetsAt.toISOString() });
      },
    }),
    defineRoute({
      method: 'get',
      path: '/masjids/:masjidId/timings',
      summary: 'Location, calculation settings and raw timings — resolved on the phone (today strip, editor)',
      tags: ['masjid'],
      auth: 'session',
      request: { params: Params },
      responses: { 200: adminScheduleSchema },
      handler: async ({ auth, params, reply }) =>
        reply(200, await getAdminSchedule(db, auth.scope, masjidIdOf(params.masjidId))),
    }),
    defineRoute({
      method: 'put',
      path: '/masjids/:masjidId/timings',
      summary: 'Save the five prayers and Jumu’ah at once (If-Match: "<rev>"; 412 when someone saved in between)',
      tags: ['masjid'],
      auth: 'session',
      rateLimit: writes,
      request: { params: Params, body: timingsSaveSchema },
      responses: { 200: timingsSavedSchema },
      handler: async ({ auth, params, body, req, clock, requestId, reply }) => {
        const { notify, ...timings } = body;
        const saved = await saveTimings(db, auth.scope, {
          masjidId: masjidIdOf(params.masjidId),
          timings,
          expectedRev: revOf(req.get('if-match')),
          notify,
          now: clock.now(),
          requestId,
        });
        const { notificationJobId, ...result } = saved;
        await afterCommit(notificationJobId);
        return reply(200, result);
      },
    }),
    defineRoute({
      method: 'get',
      path: '/masjids/:masjidId/timings/preview',
      summary: 'The saved timings resolved for one IST day, as musallis see them',
      tags: ['masjid'],
      auth: 'session',
      request: { params: Params, query: PreviewQuery },
      responses: { 200: timingsPreviewSchema },
      handler: async ({ auth, params, query, reply }) => {
        const schedule = await getAdminSchedule(db, auth.scope, masjidIdOf(params.masjidId));
        if (!schedule.timings) throw new ApiProblem(404, 'NOT_FOUND');
        const day = resolveSchedule(
          {
            coordinates: { lat: schedule.masjid.lat, lng: schedule.masjid.lng },
            method: schedule.masjid.calcMethod,
            madhab: schedule.masjid.asrMadhab,
            prayers: schedule.timings.prayers,
            jumuah: schedule.timings.jumuah,
          },
          query.date,
        );
        return reply(200, {
          date: query.date,
          sunrise: day.sunrise,
          prayers: day.prayers.map(({ prayer, adhan, adhanCalculated, jamaat }) => ({
            prayer,
            adhan,
            calculated: adhanCalculated,
            jamaat,
          })),
          jumuah: schedule.timings.jumuah,
        });
      },
    }),
    defineRoute({
      method: 'get',
      path: '/masjids/:masjidId/special',
      summary: 'Special dates from 30 days ago onwards, by date (B11)',
      tags: ['masjid'],
      auth: 'session',
      request: { params: Params },
      responses: { 200: adminSpecialDatesSchema },
      handler: async ({ auth, params, clock, reply }) => {
        const from = addDays(calendarDateInZone(clock.now()), -SPECIAL_LIST_PAST_DAYS);
        const specialDates = await listSpecialDates(db, auth.scope, masjidIdOf(params.masjidId), from);
        return reply(200, { specialDates });
      },
    }),
    defineRoute({
      method: 'post',
      path: '/masjids/:masjidId/special',
      summary: 'Add a special date (1–5 times, within 400 days; optionally notify followers)',
      tags: ['masjid'],
      auth: 'session',
      rateLimit: writes,
      request: { params: Params, body: specialDateSaveSchema },
      responses: { 201: specialDateSavedSchema },
      handler: async ({ auth, params, body, clock, requestId, reply }) => {
        const { notify, ...entry } = body;
        const saved = await saveSpecialDate(db, auth.scope, {
          masjidId: masjidIdOf(params.masjidId),
          entry,
          notify,
          now: clock.now(),
          requestId,
        });
        const { notificationJobId, ...result } = saved;
        await afterCommit(notificationJobId);
        return reply(201, result);
      },
    }),
    defineRoute({
      method: 'patch',
      path: '/masjids/:masjidId/special/:id',
      summary: 'Replace a special date (a label or note left out is removed)',
      tags: ['masjid'],
      auth: 'session',
      rateLimit: writes,
      request: { params: SpecialParams, body: specialDateSaveSchema },
      responses: { 200: specialDateSavedSchema },
      handler: async ({ auth, params, body, clock, requestId, reply }) => {
        const { notify, ...entry } = body;
        const saved = await saveSpecialDate(db, auth.scope, {
          masjidId: masjidIdOf(params.masjidId),
          id: specialIdOf(params.id),
          entry,
          notify,
          now: clock.now(),
          requestId,
        });
        const { notificationJobId, ...result } = saved;
        await afterCommit(notificationJobId);
        return reply(200, result);
      },
    }),
    defineRoute({
      method: 'delete',
      path: '/masjids/:masjidId/special/:id',
      summary: 'Delete a special date (followers stop seeing it after their next version poll)',
      tags: ['masjid'],
      auth: 'session',
      rateLimit: writes,
      request: { params: SpecialParams },
      responses: { 204: Empty },
      handler: async ({ auth, params, clock, requestId, reply }) => {
        await deleteSpecialDate(db, auth.scope, {
          masjidId: masjidIdOf(params.masjidId),
          id: specialIdOf(params.id),
          now: clock.now(),
          requestId,
        });
        return reply(204, {});
      },
    }),
    defineRoute({
      method: 'post',
      path: '/masjids/:masjidId/images',
      summary: 'Upload a photo (≤ 10 MB; JPEG, PNG, WebP or AVIF by content): sanitized, re-encoded, then stored',
      tags: ['masjid'],
      auth: 'session',
      rateLimit: uploads,
      upload: { maxBytes: IMAGE_MAX_BYTES },
      request: { params: Params, query: imageUploadQuerySchema },
      responses: { 201: imageUploadedSchema },
      handler: async ({ auth, params, query, file, requestId, reply }) => {
        const masjidId = masjidIdOf(params.masjidId);
        requireOwnMasjid(auth.scope, masjidId);
        if (!file) throw new ApiProblem(503, 'SERVICE_UNAVAILABLE');
        const { key, image } = await storeImage(masjidId, file.bytes);
        await recordImageUpload(db, auth.scope, { masjidId, key, purpose: query.purpose, requestId });
        const urls = urlsOf(key);
        if (!urls) throw new ApiProblem(503, 'SERVICE_UNAVAILABLE');
        return reply(201, {
          imageKey: key,
          thumbhash: image.thumbhash,
          width: image.width,
          height: image.height,
          urls,
        });
      },
    }),
    defineRoute({
      method: 'get',
      path: '/masjids/:masjidId/templates',
      summary: 'Notice templates an admin may pick (active, not system) in all four languages (B5)',
      tags: ['masjid'],
      auth: 'session',
      request: { params: Params },
      responses: { 200: templateListSchema },
      handler: async ({ auth, params, reply }) =>
        reply(200, { templates: await listTemplatesForAdmin(db, auth.scope, masjidIdOf(params.masjidId)) }),
    }),
    defineRoute({
      method: 'post',
      path: '/masjids/:masjidId/items/announcement',
      summary: 'Publish a notice — a template with its params or own text; optionally notify followers (B5)',
      tags: ['masjid'],
      auth: 'session',
      rateLimit: writes,
      request: { params: Params, body: announcementPublishSchema },
      responses: { 201: itemPublishedSchema },
      handler: async ({ auth, params, body, clock, requestId, reply }) => {
        const masjidId = masjidIdOf(params.masjidId);
        const { eventAt, image, ...rest } = body;
        const published = await publishAnnouncement(db, auth.scope, {
          masjidId,
          announcement: {
            ...rest,
            ...(eventAt === undefined ? {} : { eventAt: new Date(eventAt) }),
            ...(image === undefined ? {} : { image }),
          },
          now: clock.now(),
          requestId,
        });
        await afterCommit(published.notificationJobId);
        const notification =
          published.quotaLeft === null
            ? null
            : {
                queued: true,
                targeted: await countNotifyAudience(db, auth.scope, masjidId, 'everyone'),
                quotaLeft: published.quotaLeft,
              };
        return reply(201, { item: published.item, notification });
      },
    }),
    defineRoute({
      method: 'post',
      path: '/masjids/:masjidId/items/daily-content',
      summary: "Publish today's hadith or ayah — a verified library entry and an optional note (B6)",
      tags: ['masjid'],
      auth: 'session',
      rateLimit: writes,
      request: { params: Params, body: dailyContentPublishSchema },
      responses: { 201: itemPublishedSchema },
      handler: async ({ auth, params, body, clock, requestId, reply }) => {
        const masjidId = masjidIdOf(params.masjidId);
        const libraryId = parseId(body.libraryId);
        if (!libraryId) throw new ApiProblem(404, 'LIBRARY_ENTRY_NOT_FOUND');
        const published = await publishDailyContent(db, auth.scope, {
          masjidId,
          daily: { libraryId, note: body.note, voice: body.voice, title: body.title, notify: body.notify },
          now: clock.now(),
          requestId,
        });
        await afterCommit(published.notificationJobId);
        const notification =
          published.quotaLeft === null
            ? null
            : {
                queued: true,
                targeted: await countNotifyAudience(db, auth.scope, masjidId, 'everyone'),
                quotaLeft: published.quotaLeft,
              };
        return reply(201, { item: published.item, notification });
      },
    }),
    defineRoute({
      method: 'post',
      path: '/masjids/:masjidId/items/dua',
      summary: 'Publish a dua request — message, optional private name, a verified dua, an inteqal janaza (B7)',
      tags: ['masjid'],
      auth: 'session',
      rateLimit: writes,
      request: { params: Params, body: duaPublishSchema },
      responses: { 201: itemPublishedSchema },
      handler: async ({ auth, params, body, clock, requestId, reply }) => {
        const masjidId = masjidIdOf(params.masjidId);
        const libraryId = parseId(body.libraryId);
        if (!libraryId) throw new ApiProblem(404, 'LIBRARY_ENTRY_NOT_FOUND');
        const { janazaAt, libraryId: _text, ...rest } = body;
        const published = await publishDuaRequest(db, auth.scope, {
          masjidId,
          dua: { ...rest, libraryId, ...(janazaAt === undefined ? {} : { janazaAt: new Date(janazaAt) }) },
          now: clock.now(),
          requestId,
        });
        await afterCommit(published.notificationJobId);
        const notification =
          published.quotaLeft === null
            ? null
            : {
                queued: true,
                targeted: await countNotifyAudience(db, auth.scope, masjidId, 'everyone'),
                quotaLeft: published.quotaLeft,
              };
        return reply(201, { item: published.item, notification });
      },
    }),
    defineRoute({
      method: 'get',
      path: '/masjids/:masjidId/items',
      summary: 'My Posts: every status, newest first, with the edit window and the If-Match value (B12)',
      tags: ['masjid'],
      auth: 'session',
      request: { params: Params, query: adminItemListQuerySchema },
      responses: { 200: adminItemListSchema },
      handler: async ({ auth, params, query, clock, reply }) => {
        const page = await listItemsForAdmin(db, auth.scope, masjidIdOf(params.masjidId), {
          type: query.type,
          status: query.status,
          cursor: query.cursor,
          now: clock.now(),
        });
        return reply(200, { items: page.rows, next: page.next });
      },
    }),
    defineRoute({
      method: 'patch',
      path: '/masjids/:masjidId/items/:itemId',
      summary:
        'Edit a post within 24 h of publishing (If-Match: "<updatedAt>"; 412 when someone saved in between; never notifies)',
      tags: ['masjid'],
      auth: 'session',
      rateLimit: writes,
      request: { params: ItemParams, body: itemEditSchema },
      responses: { 200: itemEditedSchema },
      handler: async ({ auth, params, body, req, clock, requestId, reply }) => {
        const edited = await editItem(db, auth.scope, {
          masjidId: masjidIdOf(params.masjidId),
          itemId: itemIdOf(params.itemId),
          ifMatch: updatedAtOf(req.get('if-match')),
          edit: itemEditOf(body),
          now: clock.now(),
          requestId,
        });
        return reply(200, edited);
      },
    }),
    defineRoute({
      method: 'delete',
      path: '/masjids/:masjidId/items/:itemId',
      summary: 'Delete a post (followers stop seeing it after their next version poll; kept 180 days, then purged)',
      tags: ['masjid'],
      auth: 'session',
      rateLimit: writes,
      request: { params: ItemParams },
      responses: { 204: Empty },
      handler: async ({ auth, params, clock, requestId, reply }) => {
        await deleteItem(db, auth.scope, {
          masjidId: masjidIdOf(params.masjidId),
          itemId: itemIdOf(params.itemId),
          now: clock.now(),
          requestId,
        });
        return reply(204, {});
      },
    }),
    defineRoute({
      method: 'get',
      path: '/masjids/:masjidId',
      summary: 'Masjid Profile: names in four scripts, place, photo, the Hijri adjustment (B13)',
      tags: ['masjid'],
      auth: 'session',
      request: { params: Params },
      responses: { 200: adminMasjidProfileSchema },
      handler: async ({ auth, params, reply }) => reply(200, await profileOf(auth.scope, masjidIdOf(params.masjidId))),
    }),
    defineRoute({
      method: 'patch',
      path: '/masjids/:masjidId',
      summary: "Set the masjid's Hijri adjustment (-2 to +2; null = the app's) - no other field can change here",
      tags: ['masjid'],
      auth: 'session',
      rateLimit: writes,
      request: { params: Params, body: masjidProfilePatchSchema },
      responses: { 200: adminMasjidProfileSchema },
      handler: async ({ auth, params, body, requestId, reply }) => {
        const masjidId = masjidIdOf(params.masjidId);
        await updateMasjidProfile(db, auth.scope, { masjidId, patch: { hijriOffset: body.hijriOffset }, requestId });
        return reply(200, await profileOf(auth.scope, masjidId));
      },
    }),
    defineRoute({
      method: 'post',
      path: '/masjids/:masjidId/audio',
      summary:
        'Upload a voice note (up to 25 MB and 10 minutes; Ogg, WebM, MP4/M4A/AAC/3GP, MP3 or WAV by content) with its waveform',
      tags: ['masjid'],
      auth: 'session',
      rateLimit: uploads,
      upload: { maxBytes: AUDIO_MAX_BYTES },
      request: { params: Params, query: audioUploadQuerySchema },
      responses: { 201: audioUploadedSchema },
      handler: async ({ auth, params, query, file, requestId, reply }) => {
        const masjidId = masjidIdOf(params.masjidId);
        requireOwnMasjid(auth.scope, masjidId);
        if (!media || !file) throw new ApiProblem(503, 'SERVICE_UNAVAILABLE');
        const type = sniffAudio(file.bytes);
        if (!type) throw new ApiProblem(422, 'AUDIO_INVALID');
        const key = newAudioKey(idText(masjidId));
        const stored = await media.store.putAudio(key, file.bytes, type);
        let durationS: number;
        try {
          durationS = keptDuration(query.durationS, stored.durationS);
        } catch (error) {
          if (!(error instanceof AudioRejected)) throw error;
          await media.store.deleteAudio(key);
          throw new ApiProblem(422, 'AUDIO_TOO_LONG');
        }
        await recordAudioUpload(db, auth.scope, { masjidId, key, durationS, requestId });
        return reply(201, { audioKey: key, durationS, peaks: query.peaks });
      },
    }),
    defineRoute({
      method: 'post',
      path: '/masjids/:masjidId/photo',
      summary: 'Change the masjid photo (up to 10 MB; JPEG, PNG, WebP or AVIF by content; sanitized and re-encoded)',
      tags: ['masjid'],
      auth: 'session',
      rateLimit: uploads,
      upload: { maxBytes: IMAGE_MAX_BYTES },
      request: { params: Params, query: masjidPhotoQuerySchema },
      responses: { 200: adminMasjidProfileSchema },
      handler: async ({ auth, params, file, requestId, reply }) => {
        const masjidId = masjidIdOf(params.masjidId);
        requireOwnMasjid(auth.scope, masjidId);
        if (!file) throw new ApiProblem(503, 'SERVICE_UNAVAILABLE');
        const { key, image } = await storeImage(masjidId, file.bytes);
        await recordImageUpload(db, auth.scope, { masjidId, key, purpose: 'masjid', requestId });
        await updateMasjidProfile(db, auth.scope, {
          masjidId,
          patch: { photo: { key, thumbhash: image.thumbhash } },
          requestId,
        });
        return reply(200, await profileOf(auth.scope, masjidId));
      },
    }),
    defineRoute({
      method: 'post',
      path: '/masjids/:masjidId/change-requests',
      summary: 'Ask the Super Admin to change the names, area or address (a note on their dashboard)',
      tags: ['masjid'],
      auth: 'session',
      rateLimit: writes,
      request: { params: Params, body: masjidChangeRequestSchema },
      responses: { 204: Empty },
      handler: async ({ auth, params, body, requestId, reply }) => {
        await requestMasjidChange(db, auth.scope, {
          masjidId: masjidIdOf(params.masjidId),
          note: body.note,
          requestId,
        });
        return reply(204, {});
      },
    }),
    defineRoute({
      method: 'get',
      path: '/masjids/:masjidId/ramadan',
      summary: 'Ramadan mode (start/end, null when off) and the Sehri / Iftar precautions',
      tags: ['masjid'],
      auth: 'session',
      request: { params: Params },
      responses: { 200: ramadanSchema },
      handler: async ({ auth, params, reply }) =>
        reply(200, await getRamadan(db, auth.scope, masjidIdOf(params.masjidId))),
    }),
    defineRoute({
      method: 'put',
      path: '/masjids/:masjidId/ramadan',
      summary: 'Save Ramadan mode (start ≤ end, at most 30 days; both null = off) and the precautions',
      tags: ['masjid'],
      auth: 'session',
      rateLimit: writes,
      request: { params: Params, body: ramadanSaveSchema },
      responses: { 200: ramadanSchema },
      handler: async ({ auth, params, body, clock, requestId, reply }) => {
        const masjidId = masjidIdOf(params.masjidId);
        await saveRamadan(db, auth.scope, {
          masjidId,
          ramadan: {
            start: body.start,
            end: body.end,
            sehriPrecautionMin: body.sehriPrecaution,
            iftarPrecautionMin: body.iftarPrecaution,
          },
          now: clock.now(),
          requestId,
        });
        return reply(200, await getRamadan(db, auth.scope, masjidId));
      },
    }),
  ];
}

/** `If-Match: "<rev>"` (quotes optional; "0" = no timings saved yet). Missing or malformed → 400. */
const IfMatch = z
  .string()
  .regex(/^"?\d{1,10}"?$/)
  .transform((value) => Number(value.replaceAll('"', '')));

function revOf(header: string | undefined): number {
  const parsed = IfMatch.safeParse(header);
  if (!parsed.success) throw new ApiProblem(400, 'VALIDATION_FAILED');
  return parsed.data;
}
