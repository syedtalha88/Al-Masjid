// `/api/super` client (03 §5). Responses are parsed with the shared contracts; ★ calls are wrapped by `useStepUp`.
import {
  adminPhoneSchema,
  auditPageSchema,
  type AuditQuery,
  changedSchema,
  countSchema,
  inviteLinkSchema,
  noContentSchema,
  problemSchema,
  type SuperAdminCreate,
  superAdminCreatedSchema,
  superDashboardSchema,
  type SuperMasjidCreate,
  superMasjidCreatedSchema,
  superMasjidDetailSchema,
  superMasjidListSchema,
  type SuperMasjidPatch,
  type SuperSettingsPatch,
  superSettingsSchema,
} from '@mc/shared/contracts';
import { ProblemError, ResponseError } from '@mc/shared/http';

import { call } from '../../auth/api/auth-api.ts';

export const SUPER_API = '/api/super';

const query = (params: Readonly<Record<string, string | undefined>>): string => {
  const entries = Object.entries(params).filter((entry): entry is [string, string] => Boolean(entry[1]));
  return entries.length > 0 ? `?${new URLSearchParams(entries).toString()}` : '';
};
const id = (value: string) => encodeURIComponent(value);

export type MasjidStatusFilter = 'pending' | 'active' | 'suspended' | 'deleted';
export type Transition = 'activate' | 'suspend' | 'unsuspend' | 'delete';

export const superApi = {
  dashboard: (signal?: AbortSignal) => call(`${SUPER_API}/dashboard`, superDashboardSchema, signal ? { signal } : {}),
  masjids: (params: { q?: string; status?: MasjidStatusFilter; cursor?: string }, signal?: AbortSignal) =>
    call(`${SUPER_API}/masjids${query(params)}`, superMasjidListSchema, signal ? { signal } : {}),
  createMasjid: (body: SuperMasjidCreate) =>
    call(`${SUPER_API}/masjids`, superMasjidCreatedSchema, { method: 'POST', body }),
  masjid: (masjidId: string, signal?: AbortSignal) =>
    call(`${SUPER_API}/masjids/${id(masjidId)}`, superMasjidDetailSchema, signal ? { signal } : {}),
  updateMasjid: (masjidId: string, body: SuperMasjidPatch) =>
    call(`${SUPER_API}/masjids/${id(masjidId)}`, changedSchema, { method: 'PATCH', body }),
  setQuota: (masjidId: string, pushDailyQuota: number) =>
    call(`${SUPER_API}/masjids/${id(masjidId)}/quotas`, changedSchema, { method: 'PATCH', body: { pushDailyQuota } }),
  transition: (masjidId: string, transition: Transition, reason?: string) =>
    transition === 'delete'
      ? call(`${SUPER_API}/masjids/${id(masjidId)}`, noContentSchema, {
          method: 'DELETE',
          body: reason ? { reason } : {},
        })
      : call(`${SUPER_API}/masjids/${id(masjidId)}/${transition}`, noContentSchema, {
          method: 'POST',
          ...(transition === 'activate' ? {} : { body: { reason } }),
        }),
  createAdmin: (body: SuperAdminCreate) =>
    call(`${SUPER_API}/admins`, superAdminCreatedSchema, { method: 'POST', body }),
  newInvite: (adminId: string, purpose: 'register' | 'add_device' | 'recovery') =>
    call(`${SUPER_API}/admins/${id(adminId)}/invites`, inviteLinkSchema, { method: 'POST', body: { purpose } }),
  revokeSessions: (adminId: string) =>
    call(`${SUPER_API}/admins/${id(adminId)}/revoke-sessions`, countSchema, { method: 'POST' }),
  revokePasskeys: (adminId: string) =>
    call(`${SUPER_API}/admins/${id(adminId)}/revoke-passkeys`, countSchema, { method: 'POST' }),
  removeAdmin: (adminId: string, masjidId: string) =>
    call(`${SUPER_API}/admins/${id(adminId)}/masjids/${id(masjidId)}`, noContentSchema, { method: 'DELETE' }),
  adminPhone: (adminId: string) => call(`${SUPER_API}/admins/${id(adminId)}/phone`, adminPhoneSchema),
  settings: (signal?: AbortSignal) => call(`${SUPER_API}/settings`, superSettingsSchema, signal ? { signal } : {}),
  updateSettings: (body: SuperSettingsPatch) => call(`${SUPER_API}/settings`, changedSchema, { method: 'PATCH', body }),
  audit: (params: AuditQuery, signal?: AbortSignal) =>
    call(`${SUPER_API}/audit${query(params)}`, auditPageSchema, signal ? { signal } : {}),
  /** CSV export (★): fetched with the session cookie and handed to the browser as a download. */
  async auditCsv(params: Omit<AuditQuery, 'cursor'>): Promise<Blob> {
    const response = await fetch(`${SUPER_API}/audit/export.csv${query(params)}`, {
      headers: { Accept: 'text/csv, application/problem+json' },
    });
    const requestId = response.headers.get('x-request-id') ?? undefined;
    if (!response.ok) {
      // A problem+json answer (STEP_UP_REQUIRED, …) becomes the same typed error the JSON client throws.
      const problem = problemSchema.safeParse(await response.json().catch(() => null));
      if (problem.success) throw new ProblemError(problem.data, requestId);
      throw new ResponseError(response.status, 'unexpected-status', requestId);
    }
    return response.blob();
  },
};
