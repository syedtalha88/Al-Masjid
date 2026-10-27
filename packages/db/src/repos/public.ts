// Public read repository (03 §3, PHASE_02 T2.2): everything api-public reads, ONLY through the `v_pub_*` views and
// `ameen_counters` with the public scope (02 §4.1–4.2 — the mc_public user cannot read the source collections at all).
// Results are JSON-ready (ids as canonical text, instants as ISO strings) in the shape of the API contracts; callers
// pass typed values only, never a raw filter.
import { type Document, UUID } from 'mongodb';

import type { DbHandle } from '../client.ts';
import { StateError } from '../effects.ts';
import {
  ANNOUNCEMENT_CATEGORY,
  ASR_MADHAB,
  AUDIENCE,
  CALC_METHOD,
  CAMPAIGN_PURPOSE,
  CAMPAIGN_STATUS,
  DHIKR_OCCASION,
  DUA_CATEGORY,
  ITEM_TYPE,
  LIBRARY_KIND,
  LOCALE,
  SPECIAL_TYPE,
  TEMPLATE_PARAM_TYPE,
} from '../schema/enums.ts';
import { publicScope } from '../scope.ts';
import { scoped } from '../scoped.ts';
import { idText } from '../values.ts';
import { arrayOf, compact, idOf, iso, maybeOneOf, need, numberOf, objectOf, oneOf, text, timingsOf } from './read.ts';

// --- document readers: ./read.ts (shared with the admin repositories) -----------------------------------------

const i18n = <K extends string>(
  doc: Document | undefined,
  keys: readonly K[],
): Partial<Record<K, string>> | undefined => {
  if (!doc) return undefined;
  const out: Partial<Record<K, string>> = {};
  for (const key of keys) {
    const value = text(doc, key);
    if (value !== undefined) out[key] = value;
  }
  return out;
};
const image = (doc: Document, key: string, hash: string) => {
  const value = text(doc, key);
  return value === undefined ? undefined : compact({ key: value, thumbhash: text(doc, hash) });
};

const view = async (handle: DbHandle, name: Parameters<typeof scoped>[1]) =>
  scoped({ scope: publicScope(), db: await handle.db() }, name);

// --- config ------------------------------------------------------------------------------------------------------------

/**
 * `GET /config`: the public settings (02 §2 app_settings via `v_pub_settings`).
 *
 * @throws Error when the global settings document is missing (migration 0007 seeds it).
 */
export async function getPublicConfig(handle: DbHandle) {
  const doc = await (await view(handle, 'v_pub_settings')).findOne({ _id: 'global' });
  if (!doc) throw new Error('app_settings "global" is missing');
  const officer = objectOf(doc, 'grievance_officer') ?? {};
  const banner = (key: string) => {
    const value = objectOf(doc, key);
    return value
      ? { en: need(value, 'en'), hi: need(value, 'hi'), ur: need(value, 'ur'), te: need(value, 'te') }
      : undefined;
  };
  return compact({
    globalHijriOffset: numberOf(doc, 'global_hijri_offset') ?? 0,
    maintenanceBanner: banner('maintenance_banner'),
    incidentBanner: banner('incident_banner'),
    legalVersions: { privacy: need(doc, 'privacy_version'), terms: need(doc, 'terms_version') },
    minClientVersion: need(doc, 'min_client_version'),
    grievanceOfficer: {
      name: need(officer, 'name'),
      email: need(officer, 'email'),
      address: need(officer, 'address'),
      city: need(officer, 'city'),
    },
  });
}

// --- masjids -----------------------------------------------------------------------------------------------------------

const summaryOf = (doc: Document) =>
  compact({
    id: idOf(doc),
    followCode: need(doc, 'follow_code'),
    name: need(doc, 'name'),
    nameI18n: i18n(objectOf(doc, 'name_i18n'), ['hi', 'ur', 'te']) ?? {},
    area: need(doc, 'area'),
    city: need(doc, 'city'),
    state: need(doc, 'state'),
    photo: image(doc, 'photo_key', 'photo_thumbhash'),
    verified: doc['verified_at'] instanceof Date,
  });
export type PublicMasjidSummary = ReturnType<typeof summaryOf>;

/**
 * `GET /masjids/resolve/:code`: an ACTIVE masjid by its canonical follow code.
 *
 * @returns the summary, or `null` for unknown, pending, suspended and deleted masjids alike (uniform 404 — 04 R6).
 */
export async function resolveMasjidByCode(handle: DbHandle, followCode: string): Promise<PublicMasjidSummary | null> {
  const doc = await (await view(handle, 'v_pub_masjids')).findOne({ follow_code: followCode });
  return doc ? summaryOf(doc) : null;
}

/**
 * The summary of an active masjid by id (item landing).
 *
 * @returns `null` unless the masjid is active.
 */
export async function getMasjidSummary(handle: DbHandle, id: UUID): Promise<PublicMasjidSummary | null> {
  const doc = await (await view(handle, 'v_pub_masjids')).findOne({ _id: id });
  return doc ? summaryOf(doc) : null;
}

export interface MasjidVersion {
  readonly v: number;
  readonly status: 'active' | 'suspended';
}

/**
 * `GET /masjids/versions`: content version and status of followed masjids (≤ 20 ids).
 *
 * @returns a map from id text to version; pending, deleted and unknown ids are absent.
 */
export async function getMasjidVersions(handle: DbHandle, ids: readonly UUID[]): Promise<Map<string, MasjidVersion>> {
  if (ids.length === 0) return new Map();
  const docs = await (await view(handle, 'v_pub_masjid_status')).find({ _id: { $in: [...ids] } });
  return new Map(
    docs.map((doc) => [
      idOf(doc),
      {
        v: numberOf(doc, 'content_version') ?? 1,
        status: text(doc, 'status') === 'suspended' ? 'suspended' : 'active',
      },
    ]),
  );
}

const SPECIAL_DATES_MAX = 100;

/**
 * `GET /masjids/:id/bundle`: the masjid's profile, raw timings, special dates from `fromDate` on, Ramadan settings;
 * payment, campaigns and chanda stay empty until Phase 5 (03 §3).
 *
 * @param fromDate - "YYYY-MM-DD" (today − 7 days in IST: the timetable's DateStepper range).
 * @returns `null` for unknown, pending and deleted masjids; `{status: 'suspended', v}` for a suspended one.
 */
export async function getMasjidBundle(handle: DbHandle, id: UUID, fromDate: string) {
  const status = (await getMasjidVersions(handle, [id])).get(idText(id));
  if (!status) return null;
  if (status.status === 'suspended') return { status: 'suspended' as const, v: status.v };
  const masjid = await (await view(handle, 'v_pub_masjids')).findOne({ _id: id });
  if (!masjid) return null; // suspended/deleted between the two reads
  const timings = await (await view(handle, 'v_pub_timings')).findOne({ _id: id });
  const specials = await (
    await view(handle, 'v_pub_special_timings')
  ).find({ masjid_id: id, date: { $gte: fromDate } }, { limit: SPECIAL_DATES_MAX }); // the view sorts by date
  const start = text(masjid, 'ramadan_start');
  const end = text(masjid, 'ramadan_end');
  return {
    status: 'active' as const,
    v: numberOf(masjid, 'content_version') ?? status.v,
    masjid: compact({
      ...summaryOf(masjid),
      address: need(masjid, 'address'),
      lat: numberOf(masjid, 'lat') ?? 0,
      lng: numberOf(masjid, 'lng') ?? 0,
      calcMethod: oneOf(masjid, 'calc_method', CALC_METHOD),
      asrMadhab: oneOf(masjid, 'asr_madhab', ASR_MADHAB),
      hijriOffset: numberOf(masjid, 'hijri_offset'),
      showChanda: masjid['show_chanda'] === true,
      chandaWeekStart: numberOf(masjid, 'chanda_week_start') ?? 5,
    }),
    timings: timings ? timingsOf(timings) : null,
    specialDates: specials.map((doc) =>
      compact({
        id: idOf(doc),
        type: oneOf(doc, 'type', SPECIAL_TYPE),
        date: need(doc, 'date'),
        label: text(doc, 'label'),
        times: arrayOf(doc, 'times').map((slot) => compact({ time: need(slot, 'time'), label: text(slot, 'label') })),
        note: text(doc, 'note'),
      }),
    ),
    ramadan:
      start && end
        ? {
            start,
            end,
            sehriPrecautionMin: numberOf(masjid, 'sehri_precaution_min') ?? 0,
            iftarPrecautionMin: numberOf(masjid, 'iftar_precaution_min') ?? 0,
          }
        : null,
    payment: null,
    campaigns: [],
    chanda: null,
  };
}

// --- library & templates -----------------------------------------------------------------------------------------------

const LOCALES = ['en', 'hi', 'ur', 'te'] as const;

/** A dhikr's occasions (validated enum values), or absent. */
const occasionsOf = (doc: Document) => {
  const value: unknown = doc['occasions'];
  return Array.isArray(value) ? value.map((entry: unknown) => oneOf({ entry }, 'entry', DHIKR_OCCASION)) : undefined;
};

const libraryOf = (doc: Document) => ({
  id: idOf(doc),
  kind: oneOf(doc, 'kind', LIBRARY_KIND),
  arabic: need(doc, 'arabic'),
  transliteration: i18n(objectOf(doc, 'transliteration'), LOCALES) ?? {},
  translation: { en: '', ...i18n(objectOf(doc, 'translation'), LOCALES) },
  reference: need(doc, 'reference'),
  sourceName: need(doc, 'source_name'),
  sourceLicense: need(doc, 'source_license'),
  ...compact({
    repeat: numberOf(doc, 'repeat'),
    occasions: occasionsOf(doc),
  }),
});
export type PublicLibraryEntry = ReturnType<typeof libraryOf>;

/**
 * `GET /library/:id`: a verified library entry.
 *
 * @returns `null` for unknown, draft and retired entries.
 */
export async function getLibraryEntry(handle: DbHandle, id: UUID): Promise<PublicLibraryEntry | null> {
  const doc = await (await view(handle, 'v_pub_library')).findOne({ _id: id });
  return doc ? libraryOf(doc) : null;
}

async function libraryMap(handle: DbHandle, ids: readonly UUID[]): Promise<Map<string, PublicLibraryEntry>> {
  if (ids.length === 0) return new Map();
  const docs = await (await view(handle, 'v_pub_library')).find({ _id: { $in: [...ids] } });
  return new Map(docs.map((doc) => [idOf(doc), libraryOf(doc)]));
}

/** `GET /templates`: active notice templates in all four languages (system ones included — 02 §4.2). */
export async function listTemplates(handle: DbHandle) {
  const docs = await (await view(handle, 'v_pub_templates')).find({}, { sort: { _id: 1 } });
  const all4 = (value: Document | undefined) => ({
    en: value ? need(value, 'en') : '',
    hi: value ? need(value, 'hi') : '',
    ur: value ? need(value, 'ur') : '',
    te: value ? need(value, 'te') : '',
  });
  return docs.map((doc) => ({
    key: need(doc, '_id'),
    category: oneOf(doc, 'category', ANNOUNCEMENT_CATEGORY),
    icon: need(doc, 'icon'),
    isImportantDefault: doc['is_important_default'] === true,
    title: all4(objectOf(doc, 'title')),
    body: all4(objectOf(doc, 'body')),
    params: arrayOf(doc, 'params').map((param) => ({
      name: need(param, 'name'),
      type: oneOf(param, 'type', TEMPLATE_PARAM_TYPE),
      required: param['required'] === true,
    })),
    system: doc['system'] === true,
  }));
}

// --- items -------------------------------------------------------------------------------------------------------------

export type PublicAudience = 'everyone' | 'brothers' | 'sisters';

const libraryIdOf = (doc: Document): UUID | undefined => {
  for (const key of ['daily', 'dua']) {
    const id: unknown = objectOf(doc, key)?.['library_id'];
    if (id instanceof UUID) return id;
  }
  return undefined;
};

const itemOf = (doc: Document, library: ReadonlyMap<string, PublicLibraryEntry>) => {
  const libraryId = libraryIdOf(doc);
  const entry = libraryId ? library.get(idText(libraryId)) : undefined;
  const announcement = objectOf(doc, 'announcement');
  const daily = objectOf(doc, 'daily');
  const dua = objectOf(doc, 'dua');
  const campaign = objectOf(doc, 'campaign');
  const video = objectOf(doc, 'video');
  return compact({
    publicId: need(doc, 'public_id'),
    masjidId: idOf(doc, 'masjid_id'),
    type: oneOf(doc, 'type', ITEM_TYPE),
    audience: oneOf(doc, 'audience', AUDIENCE),
    title: text(doc, 'title'),
    body: text(doc, 'body'),
    contentLocale: maybeOneOf(doc, 'content_locale', LOCALE),
    templateKey: text(doc, 'template_key'),
    templateParams: objectOf(doc, 'template_params'),
    isImportant: doc['is_important'] === true,
    image: image(doc, 'image_key', 'image_thumbhash'),
    publishedAt: iso(doc, 'published_at') ?? iso(doc, 'created_at') ?? '',
    editedAt: iso(doc, 'edited_at'),
    announcement: announcement
      ? compact({
          category: oneOf(announcement, 'category', ANNOUNCEMENT_CATEGORY),
          eventAt: iso(announcement, 'event_at'),
        })
      : undefined,
    daily: daily
      ? compact({ kind: oneOf(daily, 'kind', ['hadith', 'ayah'] as const), note: text(daily, 'note'), library: entry })
      : undefined,
    dua: dua
      ? compact({
          category: oneOf(dua, 'category', DUA_CATEGORY),
          personName: dua['name_private'] === true ? undefined : text(dua, 'person_name'),
          namePrivate: dua['name_private'] !== false,
          janazaAt: iso(dua, 'janaza_at'),
          janazaPlace: text(dua, 'janaza_place'),
          archivedAt: iso(dua, 'archived_at'),
          library: entry,
        })
      : undefined,
    campaign: campaign
      ? compact({
          purpose: oneOf(campaign, 'purpose', CAMPAIGN_PURPOSE),
          targetPaise: numberOf(campaign, 'target_paise') ?? 0,
          receivedPaise: numberOf(campaign, 'received_paise') ?? 0,
          receivedUpdatedAt: iso(campaign, 'received_updated_at'),
          startsOn: need(campaign, 'starts_on'),
          endsOn: text(campaign, 'ends_on'),
          status: oneOf(campaign, 'status', CAMPAIGN_STATUS),
          cover: image(campaign, 'cover_key', 'cover_thumbhash'),
        })
      : undefined,
    video: video
      ? compact({
          youtubeId: need(video, 'youtube_id'),
          startS: numberOf(video, 'start_s'),
          speaker: text(video, 'speaker'),
          thumb: image(video, 'thumb_key', 'thumb_thumbhash') ?? { key: '' },
        })
      : undefined,
  });
};
export type PublicItem = ReturnType<typeof itemOf>;

async function withLibrary(handle: DbHandle, docs: readonly Document[]) {
  const ids = [
    ...new Map(
      docs
        .map(libraryIdOf)
        .filter((id): id is UUID => id !== undefined)
        .map((id) => [idText(id), id]),
    ).values(),
  ];
  const library = await libraryMap(handle, ids);
  return docs.map((doc) => itemOf(doc, library));
}

/** Feed cursors: base64url JSON `[published_at ms, _id hex]` — validated on the way back in. */
const encodeCursor = (doc: Document): string => {
  const at: unknown = doc['published_at'];
  const id: unknown = doc['_id'];
  if (!(at instanceof Date) || !(id instanceof UUID)) throw new Error('feed item without published_at/_id');
  return Buffer.from(JSON.stringify([at.getTime(), id.toHexString(false)])).toString('base64url');
};
function decodeCursor(cursor: string): { at: Date; id: UUID } {
  try {
    const parsed: unknown = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
    if (
      Array.isArray(parsed) &&
      parsed.length === 2 &&
      Number.isSafeInteger(parsed[0]) &&
      typeof parsed[1] === 'string' &&
      /^[0-9a-f]{32}$/.test(parsed[1])
    ) {
      return { at: new Date(Number(parsed[0])), id: UUID.createFromHexString(parsed[1]) };
    }
  } catch {
    // fall through
  }
  throw new StateError('INVALID_CURSOR');
}

export const FEED_PAGE_MAX = 30;

/**
 * `GET /masjids/:id/feed`: published items of one masjid, newest first, keyset-paginated by `(published_at, _id)`.
 *
 * @param input.audiences - `everyone` plus the device's preference (DECISIONS #3: audience filtering is in the query).
 * @returns the page (with verified library content for hadith/ayah and dua items) and the next cursor.
 * @throws StateError INVALID_CURSOR.
 */
export async function listFeed(
  handle: DbHandle,
  masjidId: UUID,
  input: {
    readonly type?: string;
    readonly audiences: readonly PublicAudience[];
    readonly cursor?: string;
    readonly limit?: number;
  },
): Promise<{ items: PublicItem[]; next: string | null }> {
  const limit = Math.min(Math.max(input.limit ?? FEED_PAGE_MAX, 1), FEED_PAGE_MAX);
  const after = input.cursor ? decodeCursor(input.cursor) : undefined;
  const filter = {
    masjid_id: masjidId,
    ...(input.type ? { type: input.type } : {}),
    audience: { $in: [...input.audiences] },
    ...(after
      ? // `$lte` bounds the index scan at the cursor; the `$or` only drops the cursor's own instant up to its id.
        { published_at: { $lte: after.at }, $or: [{ published_at: { $lt: after.at } }, { _id: { $lt: after.id } }] }
      : {}),
  };
  const docs = await (await view(handle, 'v_pub_items')).find(filter, { limit: limit + 1 }); // the view sorts newest first (index-backed — migration 0008)
  const page = docs.slice(0, limit);
  const last = page.at(-1);
  return { items: await withLibrary(handle, page), next: docs.length > limit && last ? encodeCursor(last) : null };
}

/**
 * `GET /items/:publicId`: a published item with its library content, plus its masjid's summary.
 *
 * @returns `null` for unknown, unpublished and removed items, items of hidden masjids, and items whose audience is
 *   not in `audiences`.
 */
export async function getPublicItem(
  handle: DbHandle,
  publicId: string,
  audiences: readonly PublicAudience[],
): Promise<{ item: PublicItem; masjid: PublicMasjidSummary; itemId: UUID; masjidId: UUID } | null> {
  const doc = await (await view(handle, 'v_pub_items')).findOne({ public_id: publicId });
  const audience = doc ? text(doc, 'audience') : undefined;
  if (!doc || !audiences.some((value) => value === audience)) return null;
  const masjidId: unknown = doc['masjid_id'];
  const itemId: unknown = doc['_id'];
  if (!(masjidId instanceof UUID) || !(itemId instanceof UUID)) return null;
  const masjid = await getMasjidSummary(handle, masjidId);
  if (!masjid) return null;
  const [item] = await withLibrary(handle, [doc]);
  return item ? { item, masjid, itemId, masjidId } : null;
}

/**
 * The internal id and content version context of a published dua request (for Ameen).
 *
 * @returns `null` unless `publicId` names a visible, published dua request.
 */
export async function findDuaItemId(handle: DbHandle, publicId: string): Promise<UUID | null> {
  const doc = await (await view(handle, 'v_pub_items')).findOne({ public_id: publicId, type: 'dua_request' });
  const id: unknown = doc?.['_id'];
  return id instanceof UUID ? id : null;
}

/**
 * Live Ameen counts of published dua requests (DECISIONS #91 — never inside the immutable item responses).
 *
 * @returns a map from public id to count; unknown ids are absent, dua requests without any Ameen are 0.
 */
export async function getAmeenCounts(handle: DbHandle, publicIds: readonly string[]): Promise<Map<string, number>> {
  if (publicIds.length === 0) return new Map();
  const items = await (
    await view(handle, 'v_pub_items')
  ).find({ public_id: { $in: [...publicIds] }, type: 'dua_request' });
  const byId = new Map(items.map((doc) => [idOf(doc), need(doc, 'public_id')]));
  const ids = items.map((doc): unknown => doc['_id']).filter((id): id is UUID => id instanceof UUID);
  const counters = ids.length > 0 ? await (await view(handle, 'ameen_counters')).find({ _id: { $in: ids } }) : [];
  const counts = new Map([...byId.values()].map((publicId) => [publicId, 0]));
  for (const counter of counters) {
    const publicId = byId.get(idOf(counter));
    if (publicId !== undefined) counts.set(publicId, numberOf(counter, 'count') ?? 0);
  }
  return counts;
}
