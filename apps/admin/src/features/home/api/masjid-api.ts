// Masjid-scoped admin API (03 §4, PHASE_03): responses are parsed with the shared contracts.
import {
  adminMasjidStatsSchema,
  adminScheduleSchema,
  adminSpecialDatesSchema,
  type AnnouncementPublish,
  imageUploadedSchema,
  itemPublishedSchema,
  noContentSchema,
  pushQuotaSchema,
  type RamadanSave,
  ramadanSchema,
  type SpecialDateSave,
  specialDateSavedSchema,
  templateListSchema,
  type TimingsSave,
  timingsSavedSchema,
} from '@mc/shared/contracts';

import { ADMIN_API, call } from '../../auth/api/auth-api.ts';

const base = (masjidId: string) => `${ADMIN_API}/masjids/${encodeURIComponent(masjidId)}`;
const withSignal = (signal?: AbortSignal) => (signal ? { signal } : {});

export const masjidApi = {
  stats: (masjidId: string, signal?: AbortSignal) =>
    call(`${base(masjidId)}/stats`, adminMasjidStatsSchema, withSignal(signal)),
  quota: (masjidId: string, signal?: AbortSignal) =>
    call(`${base(masjidId)}/notifications/quota`, pushQuotaSchema, withSignal(signal)),
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
  uploadImage: (masjidId: string, file: Blob) => {
    const form = new FormData();
    form.append('file', file);
    return call(`${base(masjidId)}/images?purpose=announcement&rightsConfirmed=true`, imageUploadedSchema, {
      method: 'POST',
      form,
    });
  },
  publishAnnouncement: (masjidId: string, body: AnnouncementPublish) =>
    call(`${base(masjidId)}/items/announcement`, itemPublishedSchema, { method: 'POST', body }),
};

/** Query keys per masjid (the Home invalidates them after a publish / timings save). */
export const masjidKeys = {
  all: (masjidId: string) => ['masjid', masjidId] as const,
  stats: (masjidId: string) => ['masjid', masjidId, 'stats'] as const,
  quota: (masjidId: string) => ['masjid', masjidId, 'quota'] as const,
  schedule: (masjidId: string) => ['masjid', masjidId, 'schedule'] as const,
  special: (masjidId: string) => ['masjid', masjidId, 'special'] as const,
  ramadan: (masjidId: string) => ['masjid', masjidId, 'ramadan'] as const,
  templates: (masjidId: string) => ['masjid', masjidId, 'templates'] as const,
};
