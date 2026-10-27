// Read-only views (02 §4.2): the public API's user can read ONLY these. Every pipeline starts with `$match` (indexes
// usable) and removes private fields; DB-privilege tests prove the source collections stay unreadable for mc_public.
import type { ViewName } from '../collections.ts';
import { VIEW_SOURCES } from '../collections.ts';

export interface ViewSpec {
  readonly name: ViewName;
  readonly viewOn: (typeof VIEW_SOURCES)[ViewName];
  readonly pipeline: readonly Readonly<Record<string, unknown>>[];
}

const notDeleted = { deleted_at: { $exists: false } };
const keep = (...fields: string[]) => Object.fromEntries(fields.map((name) => [name, 1]));

const PIPELINES: Readonly<Record<ViewName, readonly Readonly<Record<string, unknown>>[]>> = {
  v_pub_masjids: [
    { $match: { status: 'active', ...notDeleted } },
    {
      $project: keep(
        'follow_code',
        'name',
        'name_i18n',
        'area',
        'city',
        'state',
        'address',
        'lat',
        'lng',
        'photo_key',
        'photo_thumbhash',
        'verified_at',
        'calc_method',
        'asr_madhab',
        'hijri_offset',
        'show_chanda',
        'chanda_week_start',
        'ramadan_start',
        'ramadan_end',
        'sehri_precaution_min',
        'iftar_precaution_min',
        'content_version',
      ),
    },
  ],
  v_pub_masjid_status: [
    { $match: { status: { $in: ['active', 'suspended'] }, ...notDeleted } },
    { $project: keep('status', 'content_version') },
  ],
  v_pub_timings: [{ $match: { masjid_visible: true } }, { $project: keep('prayers', 'jumuah') }],
  // The order lives IN the view (migration 0008): a caller's sort would run after the projection and could not use the
  // index (every matching document examined), while a view `$sort` before it takes the caller's `$match` and `$limit`
  // with it into the index scan (PHASE_02 T2.2 explain tests: 31 examined for a 31-item page of 100k).
  v_pub_special_timings: [
    { $match: { masjid_visible: true, ...notDeleted } },
    { $sort: { date: 1, _id: 1 } },
    { $project: keep('masjid_id', 'type', 'date', 'label', 'times', 'note') },
  ],
  v_pub_items: [
    { $match: { status: 'published', masjid_visible: true } },
    // Newest first = the feed indexes' order (see v_pub_special_timings).
    { $sort: { published_at: -1, _id: -1 } },
    {
      $unset: ['created_by', 'notify', 'rights_confirmed', 'deleted_at', 'removed_at', 'removed_reason', 'purge_after'],
    },
    // Private dua names never leave the database (02 §4.2): drop dua.person_name when name_private is true.
    {
      $set: {
        dua: {
          $cond: {
            if: { $eq: ['$dua.name_private', true] },
            then: { $unsetField: { field: 'person_name', input: '$dua' } },
            else: '$dua',
          },
        },
      },
    },
  ],
  v_pub_chanda_weeks: [
    { $match: { visible: true, masjid_visible: true } },
    { $project: keep('masjid_id', 'week_start', 'amount_paise', 'note') },
  ],
  v_pub_payment_profiles: [
    { $match: { status: 'active', masjid_visible: true } },
    { $project: { _id: 0, ...keep('masjid_id', 'vpa', 'payee_name', 'effective_at') } },
  ],
  v_pub_library: [
    { $match: { status: 'verified' } },
    {
      $project: keep(
        'kind',
        'arabic',
        'transliteration',
        'translation',
        'reference',
        'source_name',
        'source_license',
        'tags',
        'dua_category',
        'repeat',
        'occasions',
      ),
    },
  ],
  v_pub_templates: [
    { $match: { status: 'active' } },
    { $project: keep('category', 'icon', 'is_important_default', 'title', 'body', 'params', 'system') },
  ],
  v_pub_settings: [
    { $match: { _id: 'global' } },
    {
      $project: keep(
        'global_hijri_offset',
        'maintenance_banner',
        'incident_banner',
        'undertaking_version',
        'privacy_version',
        'terms_version',
        'grievance_officer',
        'min_client_version',
      ),
    },
  ],
  v_admin_follow_audience: [{ $project: { _id: 0, ...keep('masjid_id', 'muted', 'push_active', 'audience_pref') } }],
};

/** Every view with its source collection and pipeline, in a stable order. */
export const VIEWS: readonly ViewSpec[] = (Object.keys(PIPELINES) as ViewName[]).map((name) => ({
  name,
  viewOn: VIEW_SOURCES[name],
  pipeline: PIPELINES[name],
}));
