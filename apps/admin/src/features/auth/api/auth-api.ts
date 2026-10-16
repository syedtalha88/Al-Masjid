// api-admin client for the auth endpoints (03 §4). Same-origin requests (cookie session); every state-changing call
// carries `X-MC-CSRF: 1` — the browser adds the `Origin` the server checks (03 §1). Responses are parsed with the
// shared contracts, so a server/client mismatch fails loudly instead of rendering wrong data.
import {
  type AdminMe,
  adminMeSchema,
  type AdminPasskeyList,
  adminPasskeyListSchema,
  type AdminSessionList,
  adminSessionListSchema,
  creationOptionsSchema,
  type InviteInfo,
  inviteInfoSchema,
  type InviteLink,
  inviteLinkSchema,
  noContentSchema,
  requestOptionsSchema,
} from '@mc/shared/contracts';
import { type HttpMethod, requestJson, type RequestJsonOptions } from '@mc/shared/http';

export const ADMIN_API = '/api/admin';

const noContent = noContentSchema;

/** One api-admin request (exported for the Super Admin client, which uses `/api/super`). */
export function call<T>(
  path: string,
  schema: RequestJsonOptions<T>['schema'],
  options: { method?: HttpMethod; body?: unknown; signal?: AbortSignal } = {},
): Promise<T> {
  const method = options.method ?? 'GET';
  return requestJson(path, {
    schema,
    method,
    ...(options.body === undefined ? {} : { body: options.body }),
    ...(options.signal ? { signal: options.signal } : {}),
    ...(method === 'GET' ? {} : { headers: { 'X-MC-CSRF': '1' } }),
  });
}

export const authApi = {
  me: (signal?: AbortSignal): Promise<AdminMe> => call(`${ADMIN_API}/auth/me`, adminMeSchema, signal ? { signal } : {}),
  invite: (token: string, signal?: AbortSignal): Promise<InviteInfo> =>
    call(`${ADMIN_API}/auth/invite/${encodeURIComponent(token)}`, inviteInfoSchema, signal ? { signal } : {}),
  acceptUndertaking: (version: string): Promise<undefined> =>
    call(`${ADMIN_API}/auth/undertaking`, noContent, { method: 'POST', body: { version } }),
  logout: (): Promise<undefined> => call(`${ADMIN_API}/auth/logout`, noContent, { method: 'POST' }),
  logoutAll: (): Promise<undefined> => call(`${ADMIN_API}/auth/sessions`, noContent, { method: 'DELETE' }),
  sessions: (signal?: AbortSignal): Promise<AdminSessionList> =>
    call(`${ADMIN_API}/auth/sessions`, adminSessionListSchema, signal ? { signal } : {}),
  revokeSession: (id: string): Promise<undefined> =>
    call(`${ADMIN_API}/auth/sessions/${encodeURIComponent(id)}`, noContent, { method: 'DELETE' }),
  passkeys: (signal?: AbortSignal): Promise<AdminPasskeyList> =>
    call(`${ADMIN_API}/auth/passkeys`, adminPasskeyListSchema, signal ? { signal } : {}),
  renamePasskey: (id: string, label: string): Promise<undefined> =>
    call(`${ADMIN_API}/auth/passkeys/${encodeURIComponent(id)}`, noContent, { method: 'PATCH', body: { label } }),
  addDeviceLink: (): Promise<InviteLink> =>
    call(`${ADMIN_API}/auth/passkeys/invite`, inviteLinkSchema, { method: 'POST' }),
  registerOptions: (inviteToken: string) =>
    call(`${ADMIN_API}/auth/register/options`, creationOptionsSchema, { method: 'POST', body: { inviteToken } }),
  registerVerify: (inviteToken: string, response: Record<string, unknown>, label: string): Promise<undefined> =>
    call(`${ADMIN_API}/auth/register/verify`, noContent, { method: 'POST', body: { inviteToken, response, label } }),
  loginOptions: () => call(`${ADMIN_API}/auth/login/options`, requestOptionsSchema, { method: 'POST' }),
  loginVerify: (response: Record<string, unknown>): Promise<undefined> =>
    call(`${ADMIN_API}/auth/login/verify`, noContent, { method: 'POST', body: { response } }),
  stepUpOptions: () => call(`${ADMIN_API}/auth/step-up/options`, requestOptionsSchema, { method: 'POST' }),
  stepUpVerify: (response: Record<string, unknown>): Promise<undefined> =>
    call(`${ADMIN_API}/auth/step-up/verify`, noContent, { method: 'POST', body: { response } }),
};
