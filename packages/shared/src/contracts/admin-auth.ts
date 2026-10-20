import { z } from 'zod';

import { safeText } from './text.ts';

// api-admin auth contracts (03 §4) — the server validates its responses with these, the admin PWA parses them.

const LOCALE = z.enum(['en', 'hi', 'ur', 'te']);

/** `GET /auth/invite/:token`. */
export const inviteInfoSchema = z
  .object({
    adminDisplayName: z.string(),
    masjidNames: z.array(z.string()),
    purpose: z.enum(['register', 'add_device', 'recovery']),
    uiLocale: LOCALE,
  })
  .meta({ id: 'InviteInfo' });
export type InviteInfo = z.infer<typeof inviteInfoSchema>;

/** `GET /auth/me`. */
export const adminMeSchema = z
  .object({
    admin: z.object({
      id: z.string(),
      displayName: z.string(),
      role: z.enum(['super_admin', 'masjid_admin']),
      uiLocale: LOCALE,
    }),
    masjids: z.array(z.object({ id: z.string(), name: z.string(), role: z.enum(['owner', 'editor']) })),
    undertakingRequired: z.boolean(),
    /** The version the admin accepted last (B13 shows it). */
    undertakingVersion: z.string().optional(),
  })
  .meta({ id: 'AdminMe' });
export type AdminMe = z.infer<typeof adminMeSchema>;

/** `GET /auth/sessions`. */
export const adminSessionListSchema = z
  .object({
    sessions: z.array(
      z.object({
        id: z.string(),
        current: z.boolean(),
        createdAt: z.iso.datetime(),
        lastSeenAt: z.iso.datetime(),
        device: z.string().optional(),
      }),
    ),
  })
  .meta({ id: 'AdminSessionList' });
export type AdminSessionList = z.infer<typeof adminSessionListSchema>;

/** `GET /auth/passkeys`. */
export const adminPasskeyListSchema = z
  .object({
    passkeys: z.array(
      z.object({
        id: z.string(),
        label: z.string(),
        deviceType: z.string(),
        backedUp: z.boolean(),
        createdAt: z.iso.datetime(),
        lastUsedAt: z.iso.datetime().optional(),
      }),
    ),
  })
  .meta({ id: 'AdminPasskeyList' });
export type AdminPasskeyList = z.infer<typeof adminPasskeyListSchema>;

/** `POST /auth/passkeys/invite` (and the Super Admin's invite responses). */
export const inviteLinkSchema = z
  .object({ inviteUrl: z.url(), expiresAt: z.iso.datetime() })
  .meta({ id: 'InviteLink' });
export type InviteLink = z.infer<typeof inviteLinkSchema>;

/** `POST /auth/undertaking` body. */
export const undertakingAcceptSchema = z.object({ version: z.string().min(1).max(20) });

/** `PATCH /auth/passkeys/:id` body. */
export const passkeyLabelSchema = z.object({ label: safeText(60, { min: 1 }) });

/** 204 responses: no body. */
export const noContentSchema = z.undefined();

// --- passkey ceremonies (03 §4) ------------------------------------------------------------------------------------
// Options follow WebAuthn L3 `PublicKeyCredential{Creation,Request}OptionsJSON`; only the fields the client converts
// are pinned here, the rest passes through to the browser unchanged.

const base64url = z.string().regex(/^[A-Za-z0-9_-]*$/);
const descriptorSchema = z.object({
  id: base64url,
  type: z.literal('public-key'),
  transports: z.array(z.string()).optional(),
});

/** `POST /auth/register/options` response. */
export const creationOptionsSchema = z
  .object({
    rp: z.object({ id: z.string().optional(), name: z.string() }),
    user: z.object({ id: base64url, name: z.string(), displayName: z.string() }),
    challenge: base64url,
    pubKeyCredParams: z.array(z.object({ type: z.literal('public-key'), alg: z.number() })),
    timeout: z.number().optional(),
    excludeCredentials: z.array(descriptorSchema).optional(),
    authenticatorSelection: z
      .object({
        residentKey: z.enum(['discouraged', 'preferred', 'required']).optional(),
        userVerification: z.enum(['discouraged', 'preferred', 'required']).optional(),
        authenticatorAttachment: z.enum(['platform', 'cross-platform']).optional(),
        requireResidentKey: z.boolean().optional(),
      })
      .optional(),
    attestation: z.enum(['none', 'indirect', 'direct', 'enterprise']).optional(),
  })
  .meta({ id: 'PasskeyCreationOptions' });

/** `POST /auth/login/options` and `/auth/step-up/options` response. */
export const requestOptionsSchema = z
  .object({
    challenge: base64url,
    timeout: z.number().optional(),
    rpId: z.string().optional(),
    allowCredentials: z.array(descriptorSchema).optional(),
    userVerification: z.enum(['discouraged', 'preferred', 'required']).optional(),
  })
  .meta({ id: 'PasskeyRequestOptions' });

// Not strict on purpose (review L10): browsers add members (authenticatorData, publicKey, …) a client may forward.
// Credentials as JSON (WebAuthn L3 `RegistrationResponseJSON` / `AuthenticationResponseJSON`). Only what the server
// verifies is kept (the verifiers read id, rawId, type and response); other members, e.g. clientExtensionResults,
// are dropped. Bounds: credential ids ≤ 1023 bytes (WebAuthn §5.1), generous limits for the rest.
const b64 = (maxChars: number) =>
  z
    .string()
    .min(1)
    .max(maxChars)
    .regex(/^[A-Za-z0-9_-]+$/);
const credentialId = b64(1364);

export const registrationResponseSchema = z.object({
  id: credentialId,
  rawId: credentialId,
  type: z.literal('public-key'),
  response: z.object({
    clientDataJSON: b64(4096),
    attestationObject: b64(32_768),
    transports: z.array(z.string().max(20)).max(10).optional(), // 02 §2 webauthn_credentials.transports items ≤ 20
  }),
});
export type RegistrationResponse = z.infer<typeof registrationResponseSchema>;

export const authenticationResponseSchema = z.object({
  id: credentialId,
  rawId: credentialId,
  type: z.literal('public-key'),
  response: z.object({
    clientDataJSON: b64(4096),
    authenticatorData: b64(4096),
    signature: b64(1024),
    userHandle: b64(88).optional(),
  }),
});
export type AuthenticationResponse = z.infer<typeof authenticationResponseSchema>;

export const registerOptionsRequestSchema = z.object({ inviteToken: z.string().regex(/^[A-Za-z0-9_-]{43}$/) });
export const registerVerifyRequestSchema = registerOptionsRequestSchema.extend({
  response: registrationResponseSchema,
  label: safeText(60, { min: 1 }),
});
export const assertionVerifyRequestSchema = z.object({ response: authenticationResponseSchema });
export type CreationOptionsJSON = z.infer<typeof creationOptionsSchema>;
export type RequestOptionsJSON = z.infer<typeof requestOptionsSchema>;
