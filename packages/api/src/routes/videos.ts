// Bayan videos over HTTP (03 §4 "Videos", 07 B10, DECISIONS #39, PHASE_06 T6.2). The admin pastes a YouTube link: the
// server parses it strictly (`parseYouTubeLink`), asks YouTube's oEmbed whether the video can play in other apps and
// for its title, and copies the thumbnail once through the image pipeline. Only the id, the start second and our
// thumbnail are kept — the pasted link is never stored or logged. Publishing is immediate; the push is
// audience-filtered. Delete is the common `DELETE /items/:itemId`.
import { type DbHandle, idText, parseId } from '@mc/db';
import { countNotifyAudience, listVideosForAdmin, requireOwnMasjid } from '@mc/db/repos';
import { editVideo, publishVideo } from '@mc/db/state';
import { parseYouTubeLink } from '@mc/domain/youtube';
import {
  adminVideoListSchema,
  itemEditedSchema,
  itemPublishedSchema,
  videoCreateSchema,
  videoPatchSchema,
  videoPreviewRequestSchema,
  videoPreviewSchema,
} from '@mc/shared/contracts';
import type { Request } from 'express';
import { z } from 'zod';

import { defineRoute, type RouteDefinition } from '../http/define-route.ts';
import { ApiProblem } from '../http/problem.ts';
import { ImageRejected, sanitizeImage } from '../media/image.ts';
import { type MediaStore, newImageKey } from '../media/store.ts';
import type { PushNotifier } from '../queue/queues.ts';
import { type VideoLookup, VideoLookupFailed } from '../video/youtube.ts';

export interface VideoRouteDeps {
  readonly db: DbHandle;
  /** YouTube oEmbed + thumbnail (env `VIDEO_LOOKUP`: the real one, or the mock locally); absent → 503. */
  readonly video?: VideoLookup | undefined;
  /** Where the thumbnail copy is stored (T3.6); absent → 503. */
  readonly media?: { readonly store: MediaStore; readonly origin: string } | undefined;
  readonly notifier?: PushNotifier | undefined;
}

const Params = z.object({ masjidId: z.string().max(64) });
const ItemParams = z.object({ masjidId: z.string().max(64), id: z.string().max(64) });

function masjidIdOf(text: string) {
  const id = parseId(text);
  if (!id) throw new ApiProblem(404, 'MASJID_NOT_FOUND');
  return id;
}

function videoIdOf(text: string) {
  const id = parseId(text);
  if (!id) throw new ApiProblem(404, 'ITEM_NOT_FOUND');
  return id;
}

/** `If-Match: "<updatedAt>"` (quotes optional). Missing or malformed → 400. */
function updatedAtOf(header: string | undefined): string {
  const parsed = z.iso.datetime().safeParse(header?.replaceAll('"', ''));
  if (!parsed.success) throw new ApiProblem(400, 'VALIDATION_FAILED');
  return parsed.data;
}

/** B10: the masjid admin's bayan routes (mounted under `/api/admin/v1`). */
export function adminVideoRoutes(deps: VideoRouteDeps): RouteDefinition[] {
  const { db } = deps;
  const writes = [{ bucket: 'adminWrites', key: 'session' }] as const;
  // 03 §2 / PHASE_06 T6.2: 30 per hour per masjid (whichever admin), plus the session's write budget — each preview and
  // publish makes requests to YouTube on the masjid's behalf.
  const lookups = [
    { bucket: 'adminUploads', key: (req: Request) => req.params['masjidId']?.toString().toLowerCase() },
    ...writes,
  ] as const;

  /**
   * The link → a playable video with our sanitized thumbnail. The masjid is checked first, so the server never asks
   * YouTube for anyone outside their own masjid.
   */
  const lookUp = async (
    scope: Parameters<typeof requireOwnMasjid>[0],
    masjidId: ReturnType<typeof masjidIdOf>,
    url: string,
  ) => {
    requireOwnMasjid(scope, masjidId);
    const link = parseYouTubeLink(url);
    if ('error' in link) throw new ApiProblem(422, 'INVALID_VIDEO_LINK');
    if (!deps.video) throw new ApiProblem(503, 'SERVICE_UNAVAILABLE');
    let details: Awaited<ReturnType<VideoLookup['lookup']>>;
    try {
      details = await deps.video.lookup(link.id);
    } catch (error) {
      if (error instanceof VideoLookupFailed) throw new ApiProblem(503, 'VIDEO_LOOKUP_FAILED');
      throw error;
    }
    if (!details?.thumbnail) throw new ApiProblem(422, 'VIDEO_UNAVAILABLE');
    let thumbnail: Awaited<ReturnType<typeof sanitizeImage>>;
    try {
      thumbnail = await sanitizeImage(details.thumbnail);
    } catch (error) {
      if (error instanceof ImageRejected) throw new ApiProblem(503, 'VIDEO_LOOKUP_FAILED'); // YouTube sent no image
      throw error;
    }
    return { link, title: details.title, thumbnail };
  };

  return [
    defineRoute({
      method: 'get',
      path: '/masjids/:masjidId/videos',
      summary: 'Bayans — published, removed by moderation, deleted; newest first (B10)',
      tags: ['masjid'],
      auth: 'session',
      request: { params: Params },
      responses: { 200: adminVideoListSchema },
      handler: async ({ auth, params, reply }) =>
        reply(200, await listVideosForAdmin(db, auth.scope, masjidIdOf(params.masjidId))),
    }),
    defineRoute({
      method: 'post',
      path: '/masjids/:masjidId/videos/preview',
      summary: 'Check a pasted YouTube link: playable in other apps? Title and our copy of the thumbnail (B10)',
      tags: ['masjid'],
      auth: 'session',
      rateLimit: lookups,
      request: { params: Params, body: videoPreviewRequestSchema },
      responses: { 200: videoPreviewSchema },
      handler: async ({ auth, params, body, reply }) => {
        const { link, title, thumbnail } = await lookUp(auth.scope, masjidIdOf(params.masjidId), body.url);
        return reply(200, {
          youtubeId: link.id,
          ...(link.startS === undefined ? {} : { startS: link.startS }),
          title,
          thumbnail: `data:image/jpeg;base64,${thumbnail.master.toString('base64')}`,
        });
      },
    }),
    defineRoute({
      method: 'post',
      path: '/masjids/:masjidId/videos',
      summary: 'Publish a bayan from a YouTube link — only the id, start second and our thumbnail copy are kept',
      tags: ['masjid'],
      auth: 'session',
      rateLimit: lookups,
      request: { params: Params, body: videoCreateSchema },
      responses: { 201: itemPublishedSchema },
      handler: async ({ auth, params, body, clock, requestId, reply }) => {
        const masjidId = masjidIdOf(params.masjidId);
        if (!deps.media) throw new ApiProblem(503, 'SERVICE_UNAVAILABLE');
        // Asked again at publish: the video may have turned private since the preview.
        const { link, thumbnail } = await lookUp(auth.scope, masjidId, body.url);
        const key = newImageKey(idText(masjidId));
        await deps.media.store.putImage(key, thumbnail.master);
        const published = await publishVideo(db, auth.scope, {
          masjidId,
          video: {
            youtubeId: link.id,
            ...(link.startS === undefined ? {} : { startS: link.startS }),
            title: body.title,
            speaker: body.speaker,
            description: body.description,
            audience: body.audience,
            locale: body.locale,
            thumb: { key, thumbhash: thumbnail.thumbhash },
            rightsConfirmed: body.rightsConfirmed,
          },
          notify: body.notify,
          now: clock.now(),
          requestId,
        });
        await (deps.notifier?.afterCommit(published.notificationJobId) ?? Promise.resolve());
        const notification =
          published.quotaLeft === null
            ? null
            : {
                queued: true,
                targeted: await countNotifyAudience(db, auth.scope, masjidId, body.audience),
                quotaLeft: published.quotaLeft,
              };
        return reply(201, { item: published.item, notification });
      },
    }),
    defineRoute({
      method: 'patch',
      path: '/masjids/:masjidId/videos/:id',
      summary: 'Edit a bayan’s title, speaker and description within 24 h (If-Match: "<updatedAt>"; never notifies)',
      tags: ['masjid'],
      auth: 'session',
      rateLimit: writes,
      request: { params: ItemParams, body: videoPatchSchema },
      responses: { 200: itemEditedSchema },
      handler: async ({ auth, params, body, req, clock, requestId, reply }) =>
        reply(
          200,
          await editVideo(db, auth.scope, {
            masjidId: masjidIdOf(params.masjidId),
            itemId: videoIdOf(params.id),
            ifMatch: updatedAtOf(req.get('if-match')),
            title: body.title,
            speaker: body.speaker,
            description: body.description,
            now: clock.now(),
            requestId,
          }),
        ),
    }),
  ];
}
