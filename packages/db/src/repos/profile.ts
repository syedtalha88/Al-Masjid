// Masjid Profile reads (07 B13, PHASE_03 T3.10): the profile an admin sees — names in four scripts, place, photo, the
// Hijri offset and the app's global one it falls back to — and, for the Super Admin dashboard, the admins' open
// "Request change" notes (an entry is open until the Super Admin next edits that masjid).
import { type Document, UUID } from 'mongodb';

import type { DbHandle } from '../client.ts';
import { StateError } from '../effects.ts';
import type { Scope } from '../scope.ts';
import { scoped } from '../scoped.ts';
import { idText } from '../values.ts';
import { requireOwnMasjid } from './admin.ts';
import { compact, idOf, need, numberOf, objectOf, text } from './read.ts';

const DAY_MS = 24 * 60 * 60 * 1000;
/** How far back the dashboard looks for change requests. */
export const CHANGE_REQUEST_DAYS = 90;

export interface MasjidProfileView {
  readonly id: string;
  readonly name: string;
  readonly nameI18n: { readonly hi?: string; readonly ur?: string; readonly te?: string };
  readonly area: string;
  readonly city: string;
  readonly state: string;
  readonly address: string;
  readonly photo?: { readonly key: string; readonly thumbhash?: string | undefined };
  /** The masjid's own adjustment, or `null` when it follows the app's. */
  readonly hijriOffset: number | null;
  readonly globalHijriOffset: number;
}

const names = (doc: Document | undefined) => {
  const out: { hi?: string; ur?: string; te?: string } = {};
  for (const key of ['hi', 'ur', 'te'] as const) {
    const value = doc ? text(doc, key) : undefined;
    if (value !== undefined) out[key] = value;
  }
  return out;
};

/**
 * One of the admin's masjids as B13 shows it.
 *
 * @returns `null` when the masjid does not exist (deleted meanwhile).
 * @throws StateError MASJID_NOT_FOUND (not one of the admin's masjids).
 */
export async function getMasjidProfile(
  handle: DbHandle,
  scope: Scope,
  masjidId: UUID,
): Promise<MasjidProfileView | null> {
  requireOwnMasjid(scope, masjidId);
  const db = await handle.db();
  const doc = await scoped({ scope, db }, 'masjids').findOne({ _id: masjidId });
  if (!doc) return null;
  const settings = await scoped({ scope, db }, 'app_settings').findOne({ _id: 'global' });
  const photo = text(doc, 'photo_key');
  return {
    id: idOf(doc),
    name: need(doc, 'name'),
    nameI18n: names(objectOf(doc, 'name_i18n')),
    area: need(doc, 'area'),
    city: need(doc, 'city'),
    state: need(doc, 'state'),
    address: text(doc, 'address') ?? '',
    ...(photo ? { photo: compact({ key: photo, thumbhash: text(doc, 'photo_thumbhash') }) } : {}),
    hijriOffset: numberOf(doc, 'hijri_offset') ?? null,
    globalHijriOffset: (settings && numberOf(settings, 'global_hijri_offset')) ?? 0,
  };
}

export interface ChangeRequestRow {
  readonly id: string;
  readonly masjidId: string;
  readonly masjidName: string;
  readonly note: string;
  readonly at: string;
}

/**
 * The open "Request change" notes of the last {@link CHANGE_REQUEST_DAYS} days, newest first: a note is closed once the
 * Super Admin edits that masjid after it (`masjid.update` audit entry).
 *
 * @throws StateError FORBIDDEN outside the Super Admin scope.
 */
export async function listChangeRequests(
  handle: DbHandle,
  scope: Scope,
  input: { readonly now: Date },
): Promise<ChangeRequestRow[]> {
  if (scope.kind !== 'super') throw new StateError('FORBIDDEN');
  const db = await handle.db();
  const audit = scoped({ scope, db }, 'audit_log');
  const since = new Date(input.now.getTime() - CHANGE_REQUEST_DAYS * DAY_MS);
  const requests = await audit.find(
    { action: 'masjid.change_request', at: { $gte: since } },
    { sort: { at: -1 }, limit: 50 },
  );
  const masjidOf = (entry: Document): UUID | undefined => {
    const id: unknown = entry['masjid_id'];
    return id instanceof UUID ? id : undefined;
  };
  const masjidIds = [
    ...new Map(
      requests.flatMap((entry) => {
        const id = masjidOf(entry);
        return id ? [[idText(id), id] as const] : [];
      }),
    ).values(),
  ];
  if (masjidIds.length === 0) return [];
  const updates = await audit.find(
    { action: 'masjid.update', masjid_id: { $in: masjidIds }, at: { $gte: since } },
    { sort: { at: -1 } },
  );
  const lastUpdate = new Map<string, Date>();
  for (const entry of updates) {
    const at: unknown = entry['at'];
    const id = masjidOf(entry);
    if (id && at instanceof Date && !lastUpdate.has(idText(id))) lastUpdate.set(idText(id), at);
  }
  const masjids = await scoped({ scope, db }, 'masjids').find({ _id: { $in: masjidIds } });
  const nameOf = new Map(masjids.map((doc) => [idOf(doc), need(doc, 'name')]));
  return requests.flatMap((entry): ChangeRequestRow[] => {
    const at: unknown = entry['at'];
    const id = masjidOf(entry);
    if (!id || !(at instanceof Date)) return [];
    const updated = lastUpdate.get(idText(id));
    if (updated && updated.getTime() > at.getTime()) return [];
    const meta = objectOf(entry, 'meta');
    return [
      {
        id: String(entry['_id']),
        masjidId: idText(id),
        masjidName: nameOf.get(idText(id)) ?? '',
        note: (meta && text(meta, 'note')) ?? '',
        at: at.toISOString(),
      },
    ];
  });
}
