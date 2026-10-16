// Stable API error codes (03 header, PHASE_01 T1.6): the `code` of every problem+json response. The PWAs map each one
// to the `errors.<CODE>` i18n key (packages/i18n/locales/*/errors.json — a test keeps the two in step). Adding a code
// here means adding its message in all four locales.

/** Every code the API may send, with the HTTP status it is sent with. */
export const API_ERRORS = {
  // Framework (Phase 0)
  NOT_FOUND: 404,
  METHOD_NOT_ALLOWED: 405,
  VALIDATION_FAILED: 400,
  UNSAFE_INPUT: 400,
  INVALID_JSON: 400,
  PAYLOAD_TOO_LARGE: 413,
  UNSUPPORTED_MEDIA_TYPE: 415,
  CORS_NOT_ALLOWED: 403,
  INTERNAL_ERROR: 500,
  // Rate limits and availability (03 §2, 01 §10)
  RATE_LIMITED: 429,
  SERVICE_UNAVAILABLE: 503,
  // Auth (03 §1)
  DEVICE_AUTH_REQUIRED: 401,
  SESSION_REQUIRED: 401,
  ORIGIN_REJECTED: 403,
  FORBIDDEN: 403,
  STEP_UP_REQUIRED: 403,
  PASSKEY_FAILED: 401,
  INVITE_INVALID: 404, // 03 §4: uniform 404 for unknown, used, superseded and expired invites
  UNDERTAKING_REQUIRED: 403,
  UNDERTAKING_VERSION_MISMATCH: 409,
  // State rules (02 §3/§5)
  MASJID_NOT_FOUND: 404,
  FOLLOW_LIMIT_REACHED: 409,
  ADMIN_LIMIT_REACHED: 409,
  ALREADY_MEMBER: 409,
  NOT_MEMBER: 404,
  INVALID_TRANSITION: 409,
  ACTIVATION_REQUIREMENTS: 409,
  ADMIN_NOT_FOUND: 404,
  NOTHING_TO_UPDATE: 400,
  INVALID_CURSOR: 400,
} as const satisfies Readonly<Record<string, number>>;

export type ApiErrorCode = keyof typeof API_ERRORS;

/** All codes in declaration order. */
export const API_ERROR_CODES = Object.keys(API_ERRORS) as ApiErrorCode[]; // keys of the literal above

/** The HTTP status a code is sent with. */
export const statusOf = (code: ApiErrorCode): number => API_ERRORS[code];
