// `/api/super` client (03 §5). Responses are parsed with the shared contracts; ★ calls are wrapped by `useStepUp`.
import {
  adminPhoneSchema,
  auditPageSchema,
  type AuditQuery,
  cdnPurgeSchema,
  changedSchema,
  countSchema,
  dismissedSchema,
  inviteLinkSchema,
  type LIBRARY_KINDS,
  type LIBRARY_STATUSES,
  libraryImportReportSchema,
  moderationQueueSchema,
  moderationResultSchema,
  noContentSchema,
  paymentApprovedSchema,
  problemSchema,
  pushPauseResponseSchema,
  type RemoveItemRequest,
  type REPORT_STATUS_VALUES,
  starterTemplatesAddedSchema,
  type SuperAdminCreate,
  superAdminCreatedSchema,
  superDashboardSchema,
  superLibraryEntryResponseSchema,
  superLibraryListSchema,
  type SuperMasjidCreate,
  superMasjidCreatedSchema,
  superMasjidDetailSchema,
  superMasjidListSchema,
  type SuperMasjidPatch,
  superPaymentListSchema,
  type SuperSettingsPatch,
  superSettingsSchema,
  type SuperTemplateCreate,
  superTemplateListSchema,
  type SuperTemplatePatch,
  superTemplateResponseSchema,
  testAlertResponseSchema,
} from '@mc/shared/contracts';
import {
  grievanceAckSchema,
  grievanceContactSchema,
  grievanceListSchema,
  grievanceResolvedSchema,
} from '@mc/shared/contracts/grievances';
import {
  type LegalOrderCreate,
  legalOrderCreatedSchema,
  legalOrderDocumentSavedSchema,
  legalOrderListSchema,
  type LegalOrderPatch,
  legalOrderUpdatedSchema,
} from '@mc/shared/contracts/legal-orders';
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
export type LibraryStatus = (typeof LIBRARY_STATUSES)[number];
export type LibraryKind = (typeof LIBRARY_KINDS)[number];

/** The import file as one multipart part named `file` (DECISIONS #107). */
const fileForm = (file: Blob, name: string) => {
  const form = new FormData();
  form.append('file', file, name);
  return form;
};

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
  /** ★ The push kill switch (T4.7). */
  setPushPaused: (paused: boolean) =>
    call(`${SUPER_API}/settings/push-pause`, pushPauseResponseSchema, { method: 'POST', body: { paused } }),
  /** C4 (T5.2): open UPI change requests, oldest first. */
  // --- Legal orders (07 C7, PHASE_08 T8.5) ---
  legalOrders: (signal?: AbortSignal) =>
    call(`${SUPER_API}/legal-orders`, legalOrderListSchema, signal ? { signal } : {}),
  /** ★ Records an order; due = received + 3 hours. */
  createLegalOrder: (body: LegalOrderCreate) =>
    call(`${SUPER_API}/legal-orders`, legalOrderCreatedSchema, { method: 'POST', body }),
  /** ★ Status move, action taken and / or a note for the log. */
  updateLegalOrder: (orderId: string, body: LegalOrderPatch) =>
    call(`${SUPER_API}/legal-orders/${id(orderId)}`, legalOrderUpdatedSchema, { method: 'PATCH', body }),
  /** ★ The order's document (encrypted on the server before it is stored). */
  uploadLegalDocument: (orderId: string, file: Blob, name: string) =>
    call(`${SUPER_API}/legal-orders/${id(orderId)}/document`, legalOrderDocumentSavedSchema, {
      method: 'POST',
      form: fileForm(file, name),
    }),
  /** ★ The decrypted document, as a download (fetched with the session cookie; no storage URL reaches the browser). */
  async legalDocument(orderId: string): Promise<{ readonly blob: Blob; readonly filename: string }> {
    const response = await fetch(`${SUPER_API}/legal-orders/${id(orderId)}/document`, {
      headers: { Accept: 'application/pdf, image/jpeg, image/png, application/problem+json' },
    });
    const requestId = response.headers.get('x-request-id') ?? undefined;
    if (!response.ok) {
      const problem = problemSchema.safeParse(await response.json().catch(() => null));
      if (problem.success) throw new ProblemError(problem.data, requestId);
      throw new ResponseError(response.status, 'unexpected-status', requestId);
    }
    const named = /filename="([A-Za-z0-9._-]+)"/u.exec(response.headers.get('content-disposition') ?? '')?.[1];
    return { blob: await response.blob(), filename: named ?? 'legal-order' };
  },
  // --- Grievances (07 C6, PHASE_08 T8.4) ---
  grievances: (signal?: AbortSignal) => call(`${SUPER_API}/grievances`, grievanceListSchema, signal ? { signal } : {}),
  ackGrievance: (grievanceId: string) =>
    call(`${SUPER_API}/grievances/${id(grievanceId)}/ack`, grievanceAckSchema, { method: 'POST', body: {} }),
  resolveGrievance: (grievanceId: string, status: 'resolved' | 'rejected', resolution: string) =>
    call(`${SUPER_API}/grievances/${id(grievanceId)}/resolve`, grievanceResolvedSchema, {
      method: 'POST',
      body: { status, resolution },
    }),
  /** ★ */
  grievanceContact: (grievanceId: string) =>
    call(`${SUPER_API}/grievances/${id(grievanceId)}/contact`, grievanceContactSchema),
  // --- Moderation (07 C5, PHASE_08 T8.2) ---
  reports: (status: (typeof REPORT_STATUS_VALUES)[number], signal?: AbortSignal) =>
    call(`${SUPER_API}/reports${query({ status })}`, moderationQueueSchema, signal ? { signal } : {}),
  /** ★ */
  removeItem: (itemId: string, body: RemoveItemRequest) =>
    call(`${SUPER_API}/items/${id(itemId)}/remove`, moderationResultSchema, { method: 'POST', body }),
  /** ★ */
  restoreItem: (itemId: string) =>
    call(`${SUPER_API}/items/${id(itemId)}/restore`, moderationResultSchema, { method: 'POST', body: {} }),
  purgeAgain: (publicId: string, masjidId: string, itemId: string, removed: boolean) =>
    call(
      `${SUPER_API}/items/${id(publicId)}/purge${query({ masjid: masjidId, item: itemId, removed: String(removed) })}`,
      cdnPurgeSchema,
      {
        method: 'POST',
        body: {},
      },
    ),
  dismissReport: (reportId: string, note?: string) =>
    call(`${SUPER_API}/reports/${id(reportId)}/dismiss`, dismissedSchema, {
      method: 'POST',
      body: note ? { note } : {},
    }),
  payments: (signal?: AbortSignal) =>
    call(`${SUPER_API}/payments/pending`, superPaymentListSchema, signal ? { signal } : {}),
  /** ★ Approve a UPI change — live after the hold. */
  approvePayment: (profileId: string) =>
    call(`${SUPER_API}/payments/${id(profileId)}/approve`, paymentApprovedSchema, { method: 'POST', body: {} }),
  /** Turn a UPI change down — while pending, or during the hold. */
  rejectPayment: (profileId: string, reason: string) =>
    call(`${SUPER_API}/payments/${id(profileId)}/reject`, noContentSchema, { method: 'POST', body: { reason } }),
  /** A test alert to the signed-in Super Admin's phones (404 in production — T4.6). */
  testAlert: () => call(`${SUPER_API}/alerts/test`, testAlertResponseSchema, { method: 'POST' }),
  audit: (params: AuditQuery, signal?: AbortSignal) =>
    call(`${SUPER_API}/audit${query(params)}`, auditPageSchema, signal ? { signal } : {}),
  library: (
    params: { status?: LibraryStatus; kind?: LibraryKind; q?: string; cursor?: string },
    signal?: AbortSignal,
  ) => call(`${SUPER_API}/library${query(params)}`, superLibraryListSchema, signal ? { signal } : {}),
  libraryEntry: (entryId: string, signal?: AbortSignal) =>
    call(`${SUPER_API}/library/${id(entryId)}`, superLibraryEntryResponseSchema, signal ? { signal } : {}),
  /** Checks a library file; nothing is written. */
  libraryDryRun: (file: Blob, name: string) =>
    call(`${SUPER_API}/library/import/dry-run`, libraryImportReportSchema, {
      method: 'POST',
      form: fileForm(file, name),
    }),
  /** ★ Imports a library file as draft — all entries or none. */
  libraryImport: (file: Blob, name: string) =>
    call(`${SUPER_API}/library/import`, libraryImportReportSchema, { method: 'POST', form: fileForm(file, name) }),
  verifyLibraryEntry: (entryId: string, verifiedBy: string) =>
    call(`${SUPER_API}/library/${id(entryId)}/verify`, superLibraryEntryResponseSchema, {
      method: 'POST',
      body: { verifiedBy },
    }),
  retireLibraryEntry: (entryId: string) =>
    call(`${SUPER_API}/library/${id(entryId)}/retire`, superLibraryEntryResponseSchema, { method: 'POST' }),
  templates: (signal?: AbortSignal) =>
    call(`${SUPER_API}/templates`, superTemplateListSchema, signal ? { signal } : {}),
  template: (key: string, signal?: AbortSignal) =>
    call(`${SUPER_API}/templates/${id(key)}`, superTemplateResponseSchema, signal ? { signal } : {}),
  createTemplate: (body: SuperTemplateCreate) =>
    call(`${SUPER_API}/templates`, superTemplateResponseSchema, { method: 'POST', body }),
  updateTemplate: (key: string, body: SuperTemplatePatch) =>
    call(`${SUPER_API}/templates/${id(key)}`, superTemplateResponseSchema, { method: 'PATCH', body }),
  addStarterTemplates: () => call(`${SUPER_API}/templates/starters`, starterTemplatesAddedSchema, { method: 'POST' }),
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
