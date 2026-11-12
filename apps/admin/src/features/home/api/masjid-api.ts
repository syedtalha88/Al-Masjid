// Masjid-scoped admin API (03 §4, PHASE_03): responses are parsed with the shared contracts.
import {
  type AdhkarPut,
  adminAdhkarSchema,
  adminBeneficiaryListSchema,
  adminCampaignListSchema,
  adminChandaSchema,
  adminContactListSchema,
  adminItemListSchema,
  type AdminItemStatus,
  adminLibraryListSchema,
  adminMasjidProfileSchema,
  adminMasjidStatsSchema,
  adminPaymentSchema,
  adminRuqyahListSchema,
  adminScheduleSchema,
  adminSpecialDatesSchema,
  adminVideoListSchema,
  type AnnouncementPublish,
  audioUploadedSchema,
  beneficiaryPrivateResultSchema,
  beneficiaryReceivedResultSchema,
  type BeneficiarySave,
  beneficiarySavedSchema,
  type CampaignCreate,
  type CampaignPatchBody,
  type CampaignReceived,
  campaignReceivedResultSchema,
  type ChandaSettings,
  type ChandaWeekSave,
  chandaWeekSavedSchema,
  type ContactSave,
  contactSavedSchema,
  type DailyContentPublish,
  type DuaPublish,
  imageUploadedSchema,
  type ItemEditBody,
  itemEditedSchema,
  itemPublishedSchema,
  librarySuggestionSchema,
  noContentSchema,
  notificationJobListSchema,
  type PaymentRequest,
  paymentRequestedSchema,
  pushQuotaSchema,
  type RamadanSave,
  ramadanSchema,
  type RuqyahSave,
  ruqyahSavedSchema,
  type SpecialDateSave,
  specialDateSavedSchema,
  templateListSchema,
  type TimingsSave,
  timingsSavedSchema,
  type VideoCreate,
  type VideoPatch,
  videoPreviewSchema,
} from '@mc/shared/contracts';

import { ADMIN_API, call } from '../../auth/api/auth-api.ts';

const base = (masjidId: string) => `${ADMIN_API}/masjids/${encodeURIComponent(masjidId)}`;
const withSignal = (signal?: AbortSignal) => (signal ? { signal } : {});

export const masjidApi = {
  stats: (masjidId: string, signal?: AbortSignal) =>
    call(`${base(masjidId)}/stats`, adminMasjidStatsSchema, withSignal(signal)),
  quota: (masjidId: string, signal?: AbortSignal) =>
    call(`${base(masjidId)}/notifications/quota`, pushQuotaSchema, withSignal(signal)),
  /** The masjid's notifications, newest first (T4.5). */
  notificationJobs: (masjidId: string, cursor: string | undefined, signal?: AbortSignal) =>
    call(
      `${base(masjidId)}/notifications/jobs${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''}`,
      notificationJobListSchema,
      withSignal(signal),
    ),
  schedule: (masjidId: string, signal?: AbortSignal) =>
    call(`${base(masjidId)}/timings`, adminScheduleSchema, withSignal(signal)),
  /** `PUT /timings` at the edited revision (412 `PRECONDITION_FAILED` when someone saved in between). */
  saveTimings: (masjidId: string, rev: number, body: TimingsSave) =>
    call(`${base(masjidId)}/timings`, timingsSavedSchema, {
      method: 'PUT',
      body,
      headers: { 'If-Match': `"${String(rev)}"` },
    }),
  /** B11 (T3.3): special dates from 30 days ago, by date. */
  specialDates: (masjidId: string, signal?: AbortSignal) =>
    call(`${base(masjidId)}/special`, adminSpecialDatesSchema, withSignal(signal)),
  /** Adds a special date, or replaces the one with `id`. */
  saveSpecialDate: (masjidId: string, id: string | null, body: SpecialDateSave) =>
    id === null
      ? call(`${base(masjidId)}/special`, specialDateSavedSchema, { method: 'POST', body })
      : call(`${base(masjidId)}/special/${encodeURIComponent(id)}`, specialDateSavedSchema, { method: 'PATCH', body }),
  deleteSpecialDate: (masjidId: string, id: string) =>
    call(`${base(masjidId)}/special/${encodeURIComponent(id)}`, noContentSchema, { method: 'DELETE' }),
  ramadan: (masjidId: string, signal?: AbortSignal) =>
    call(`${base(masjidId)}/ramadan`, ramadanSchema, withSignal(signal)),
  saveRamadan: (masjidId: string, body: RamadanSave) =>
    call(`${base(masjidId)}/ramadan`, ramadanSchema, { method: 'PUT', body }),
  /** B5 (T3.6): the templates this masjid may pick, in all four languages. */
  templates: (masjidId: string, signal?: AbortSignal) =>
    call(`${base(masjidId)}/templates`, templateListSchema, withSignal(signal)),
  /** A notice photo (multipart `file`); the caller has the ownership tick (it is sent as `rightsConfirmed`). */
  uploadImage: (masjidId: string, file: Blob, purpose: 'announcement' | 'campaign' = 'announcement') => {
    const form = new FormData();
    form.append('file', file);
    return call(`${base(masjidId)}/images?purpose=${purpose}&rightsConfirmed=true`, imageUploadedSchema, {
      method: 'POST',
      form,
    });
  },
  publishAnnouncement: (masjidId: string, body: AnnouncementPublish) =>
    call(`${base(masjidId)}/items/announcement`, itemPublishedSchema, { method: 'POST', body }),
  /** B6 (T3.7): today's hadith / ayah suggestion and whether one of the kind went out today. */
  suggestion: (masjidId: string, kind: 'hadith' | 'ayah', signal?: AbortSignal) =>
    call(`${base(masjidId)}/library/suggestion?kind=${kind}`, librarySuggestionSchema, withSignal(signal)),
  /** Verified library entries of a kind: search words, a topic tag, the next page. */
  library: (masjidId: string, filter: LibraryFilter, signal?: AbortSignal) => {
    const query = new URLSearchParams({ kind: filter.kind });
    if (filter.q) query.set('q', filter.q);
    if (filter.tag) query.set('tag', filter.tag);
    if (filter.category) query.set('category', filter.category);
    if (filter.cursor) query.set('cursor', filter.cursor);
    return call(`${base(masjidId)}/library?${query.toString()}`, adminLibraryListSchema, withSignal(signal));
  },
  publishDaily: (masjidId: string, body: DailyContentPublish) =>
    call(`${base(masjidId)}/items/daily-content`, itemPublishedSchema, { method: 'POST', body }),
  /** B12 (T3.9): the masjid's posts in every status, newest first. */
  items: (
    masjidId: string,
    filter: { type?: string; status?: AdminItemStatus; cursor?: string },
    signal?: AbortSignal,
  ) => {
    const query = new URLSearchParams();
    if (filter.type) query.set('type', filter.type);
    if (filter.status) query.set('status', filter.status);
    if (filter.cursor) query.set('cursor', filter.cursor);
    const search = query.toString();
    return call(`${base(masjidId)}/items${search ? `?${search}` : ''}`, adminItemListSchema, withSignal(signal));
  },
  /** An edit within 24 h at the post's `updatedAt` (412 `PRECONDITION_FAILED` when someone saved in between). */
  editItem: (masjidId: string, itemId: string, updatedAt: string, body: ItemEditBody) =>
    call(`${base(masjidId)}/items/${encodeURIComponent(itemId)}`, itemEditedSchema, {
      method: 'PATCH',
      body,
      headers: { 'If-Match': `"${updatedAt}"` },
    }),
  deleteItem: (masjidId: string, itemId: string) =>
    call(`${base(masjidId)}/items/${encodeURIComponent(itemId)}`, noContentSchema, { method: 'DELETE' }),
  /** B10 (T6.2): the masjid's bayans; a pasted link → preview; publish; edit the texts within 24 h. */
  videos: (masjidId: string, signal?: AbortSignal) =>
    call(`${base(masjidId)}/videos`, adminVideoListSchema, withSignal(signal)),
  previewVideo: (masjidId: string, url: string) =>
    call(`${base(masjidId)}/videos/preview`, videoPreviewSchema, { method: 'POST', body: { url } }),
  publishVideo: (masjidId: string, body: VideoCreate) =>
    call(`${base(masjidId)}/videos`, itemPublishedSchema, { method: 'POST', body }),
  editVideo: (masjidId: string, videoId: string, updatedAt: string, body: VideoPatch) =>
    call(`${base(masjidId)}/videos/${encodeURIComponent(videoId)}`, itemEditedSchema, {
      method: 'PATCH',
      body,
      headers: { 'If-Match': `"${updatedAt}"` },
    }),
  /** B16 (T3.14): "Adhkar after salah" — on/off and the chosen dhikr in order. */
  adhkar: (masjidId: string, signal?: AbortSignal) =>
    call(`${base(masjidId)}/adhkar`, adminAdhkarSchema, withSignal(signal)),
  saveAdhkar: (masjidId: string, body: AdhkarPut) =>
    call(`${base(masjidId)}/adhkar`, adminAdhkarSchema, { method: 'PUT', body }),
  /** B15 (T3.15): the masjid's Ruqyah entries in its order. */
  ruqyah: (masjidId: string, signal?: AbortSignal) =>
    call(`${base(masjidId)}/ruqyah`, adminRuqyahListSchema, withSignal(signal)),
  addRuqyah: (masjidId: string, body: RuqyahSave) =>
    call(`${base(masjidId)}/ruqyah`, ruqyahSavedSchema, { method: 'POST', body }),
  updateRuqyah: (masjidId: string, entryId: string, body: RuqyahSave) =>
    call(`${base(masjidId)}/ruqyah/${encodeURIComponent(entryId)}`, ruqyahSavedSchema, { method: 'PATCH', body }),
  deleteRuqyah: (masjidId: string, entryId: string) =>
    call(`${base(masjidId)}/ruqyah/${encodeURIComponent(entryId)}`, noContentSchema, { method: 'DELETE' }),
  /** Every active entry once, in the new order (409 `RUQYAH_ORDER_INVALID` when the list changed meanwhile). */
  orderRuqyah: (masjidId: string, ids: readonly string[]) =>
    call(`${base(masjidId)}/ruqyah/order`, adminRuqyahListSchema, { method: 'PUT', body: { ids } }),
  /** B17 (T3.16): the masjid's Ilm contacts, brothers' first. */
  contacts: (masjidId: string, signal?: AbortSignal) =>
    call(`${base(masjidId)}/contacts`, adminContactListSchema, withSignal(signal)),
  addContact: (masjidId: string, body: ContactSave) =>
    call(`${base(masjidId)}/contacts`, contactSavedSchema, { method: 'POST', body }),
  updateContact: (masjidId: string, contactId: string, body: ContactSave) =>
    call(`${base(masjidId)}/contacts/${encodeURIComponent(contactId)}`, contactSavedSchema, { method: 'PATCH', body }),
  deleteContact: (masjidId: string, contactId: string) =>
    call(`${base(masjidId)}/contacts/${encodeURIComponent(contactId)}`, noContentSchema, { method: 'DELETE' }),
  /** B8 UPI setup (T5.2): the live details and the change request in progress. */
  payment: (masjidId: string, signal?: AbortSignal) =>
    call(`${base(masjidId)}/payment`, adminPaymentSchema, withSignal(signal)),
  /** Ask to set or change the UPI details — live only after Super Admin approval and the hold (04 R1). */
  requestPayment: (masjidId: string, body: PaymentRequest) =>
    call(`${base(masjidId)}/payment/requests`, paymentRequestedSchema, { method: 'POST', body }),
  /** B8 donation drives (T5.3): active, then completed, then closed. */
  campaigns: (masjidId: string, signal?: AbortSignal) =>
    call(`${base(masjidId)}/campaigns`, adminCampaignListSchema, withSignal(signal)),
  createCampaign: (masjidId: string, body: CampaignCreate) =>
    call(`${base(masjidId)}/campaigns`, itemPublishedSchema, { method: 'POST', body }),
  updateCampaign: (masjidId: string, campaignId: string, body: CampaignPatchBody) =>
    call(`${base(masjidId)}/campaigns/${encodeURIComponent(campaignId)}`, noContentSchema, { method: 'PATCH', body }),
  /** "Update amount" — what the masjid reports received (a history row each time). */
  campaignReceived: (masjidId: string, campaignId: string, body: CampaignReceived) =>
    call(`${base(masjidId)}/campaigns/${encodeURIComponent(campaignId)}/received`, campaignReceivedResultSchema, {
      method: 'POST',
      body,
    }),
  completeCampaign: (masjidId: string, campaignId: string) =>
    call(`${base(masjidId)}/campaigns/${encodeURIComponent(campaignId)}/complete`, noContentSchema, {
      method: 'POST',
      body: {},
    }),
  /** B9 (T5.5): chanda settings and the latest weeks. */
  chanda: (masjidId: string, signal?: AbortSignal) =>
    call(`${base(masjidId)}/chanda`, adminChandaSchema, withSignal(signal)),
  /** Saves one week's total ("YYYY-MM-DD" = the week's first day). */
  saveChandaWeek: (masjidId: string, weekStart: string, body: ChandaWeekSave) =>
    call(`${base(masjidId)}/chanda/${encodeURIComponent(weekStart)}`, chandaWeekSavedSchema, { method: 'PUT', body }),
  chandaSettings: (masjidId: string, body: ChandaSettings) =>
    call(`${base(masjidId)}/chanda/settings`, noContentSchema, { method: 'PATCH', body }),
  /** B19 (T5.8): needy people — active (least-funded first), then fulfilled, then closed; never the private part. */
  beneficiaries: (masjidId: string, signal?: AbortSignal) =>
    call(`${base(masjidId)}/beneficiaries`, adminBeneficiaryListSchema, withSignal(signal)),
  /** Adds a person, or replaces the details of the one with `id` (the consent tick is part of every save). */
  saveBeneficiary: (masjidId: string, id: string | null, body: BeneficiarySave) =>
    id === null
      ? call(`${base(masjidId)}/beneficiaries`, beneficiarySavedSchema, { method: 'POST', body })
      : call(`${base(masjidId)}/beneficiaries/${encodeURIComponent(id)}`, beneficiarySavedSchema, {
          method: 'PATCH',
          body,
        }),
  /** "Update received" — reaching the amount needed fulfils the person and hides them from the app. */
  beneficiaryReceived: (masjidId: string, id: string, receivedPaise: number) =>
    call(`${base(masjidId)}/beneficiaries/${encodeURIComponent(id)}/received`, beneficiaryReceivedResultSchema, {
      method: 'POST',
      body: { receivedPaise },
    }),
  closeBeneficiary: (masjidId: string, id: string) =>
    call(`${base(masjidId)}/beneficiaries/${encodeURIComponent(id)}/close`, noContentSchema, { method: 'POST' }),
  deleteBeneficiary: (masjidId: string, id: string) =>
    call(`${base(masjidId)}/beneficiaries/${encodeURIComponent(id)}`, noContentSchema, { method: 'DELETE' }),
  /** The person's private phone / note — the server records every view in the audit log. */
  beneficiaryPrivate: (masjidId: string, id: string) =>
    call(`${base(masjidId)}/beneficiaries/${encodeURIComponent(id)}/private`, beneficiaryPrivateResultSchema),
  /** B13 (T3.10): the masjid profile. */
  profile: (masjidId: string, signal?: AbortSignal) =>
    call(base(masjidId), adminMasjidProfileSchema, withSignal(signal)),
  /** The Hijri adjustment (−2…+2; `null` = the app's). */
  setHijriOffset: (masjidId: string, hijriOffset: number | null) =>
    call(base(masjidId), adminMasjidProfileSchema, { method: 'PATCH', body: { hijriOffset } }),
  /** A new masjid photo (multipart `file`); the caller has the ownership tick. */
  uploadMasjidPhoto: (masjidId: string, file: Blob) => {
    const form = new FormData();
    form.append('file', file);
    return call(`${base(masjidId)}/photo?rightsConfirmed=true`, adminMasjidProfileSchema, { method: 'POST', form });
  },
  /** B14 (T3.13): a voice note with the length and peaks this browser measured; the caller has the ownership tick. */
  uploadAudio: (masjidId: string, file: Blob, durationS: number, peaks: readonly number[]) => {
    const form = new FormData();
    form.append('file', file);
    const query = new URLSearchParams({
      rightsConfirmed: 'true',
      durationS: durationS.toFixed(3),
      peaks: peaks.join(','),
    });
    return call(`${base(masjidId)}/audio?${query.toString()}`, audioUploadedSchema, { method: 'POST', form });
  },
  /** "Request change": names, area or address — a note for the Super Admin. */
  requestChange: (masjidId: string, note: string) =>
    call(`${base(masjidId)}/change-requests`, noContentSchema, { method: 'POST', body: { note } }),
  /** B7 (T3.8): a dua request. */
  publishDua: (masjidId: string, body: DuaPublish) =>
    call(`${base(masjidId)}/items/dua`, itemPublishedSchema, { method: 'POST', body }),
};

export interface LibraryFilter {
  readonly kind: 'hadith' | 'ayah' | 'dua' | 'dhikr';
  readonly q?: string | undefined;
  readonly tag?: string | undefined;
  /** Duas only: illness, inteqal or other (07 B7). */
  readonly category?: 'illness' | 'inteqal' | 'other' | undefined;
  readonly cursor?: string | undefined;
}

/** Query keys per masjid (the Home invalidates them after a publish / timings save). */
export const masjidKeys = {
  all: (masjidId: string) => ['masjid', masjidId] as const,
  stats: (masjidId: string) => ['masjid', masjidId, 'stats'] as const,
  quota: (masjidId: string) => ['masjid', masjidId, 'quota'] as const,
  notifications: (masjidId: string) => ['masjid', masjidId, 'notifications'] as const,
  schedule: (masjidId: string) => ['masjid', masjidId, 'schedule'] as const,
  special: (masjidId: string) => ['masjid', masjidId, 'special'] as const,
  ramadan: (masjidId: string) => ['masjid', masjidId, 'ramadan'] as const,
  templates: (masjidId: string) => ['masjid', masjidId, 'templates'] as const,
  items: (masjidId: string, type: string) => ['masjid', masjidId, 'items', type] as const,
  profile: (masjidId: string) => ['masjid', masjidId, 'profile'] as const,
  adhkar: (masjidId: string) => ['masjid', masjidId, 'adhkar'] as const,
  ruqyah: (masjidId: string) => ['masjid', masjidId, 'ruqyah'] as const,
  contacts: (masjidId: string) => ['masjid', masjidId, 'contacts'] as const,
  payment: (masjidId: string) => ['masjid', masjidId, 'payment'] as const,
  campaigns: (masjidId: string) => ['masjid', masjidId, 'campaigns'] as const,
  videos: (masjidId: string) => ['masjid', masjidId, 'videos'] as const,
  chanda: (masjidId: string) => ['masjid', masjidId, 'chanda'] as const,
  beneficiaries: (masjidId: string) => ['masjid', masjidId, 'beneficiaries'] as const,
  suggestion: (masjidId: string, kind: 'hadith' | 'ayah') => ['masjid', masjidId, 'suggestion', kind] as const,
  library: (masjidId: string, kind: string, q: string, tag: string, category: string) =>
    ['masjid', masjidId, 'library', kind, q, tag, category] as const,
};
