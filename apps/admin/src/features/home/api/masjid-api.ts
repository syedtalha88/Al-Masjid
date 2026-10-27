// Masjid-scoped admin API (03 §4, PHASE_03): responses are parsed with the shared contracts.
import { adminMasjidStatsSchema, adminScheduleSchema, pushQuotaSchema } from '@mc/shared/contracts';

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
};

/** Query keys per masjid (the Home invalidates them after a publish / timings save). */
export const masjidKeys = {
  all: (masjidId: string) => ['masjid', masjidId] as const,
  stats: (masjidId: string) => ['masjid', masjidId, 'stats'] as const,
  quota: (masjidId: string) => ['masjid', masjidId, 'quota'] as const,
  schedule: (masjidId: string) => ['masjid', masjidId, 'schedule'] as const,
};
