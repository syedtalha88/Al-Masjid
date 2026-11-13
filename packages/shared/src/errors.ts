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
  UPLOAD_INVALID: 400, // multipart: no file, extra parts or fields (Phase 3)
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
  // Admin read-only mode (PHASE_08 T8.9): the Super Admin's kill switch — masjid admins' writes wait.
  READ_ONLY_MODE: 503,
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
  // Public API (03 §3, Phase 2)
  ITEM_NOT_FOUND: 404,
  TURNSTILE_FAILED: 403,
  // Reports (03 §3, Phase 8): the post or masjid is not public (anymore).
  REPORT_TARGET_NOT_FOUND: 404,
  GRIEVANCE_CONTACT_UNAVAILABLE: 503,
  GRIEVANCE_NOT_FOUND: 404,
  // Legal orders (03 §5, Phase 8 T8.5)
  LEGAL_ORDER_NOT_FOUND: 404,
  LEGAL_TARGET_NOT_FOUND: 404,
  LEGAL_ORDER_LOG_FULL: 409,
  ITEM_ALREADY_REMOVED: 409,
  REPORT_NOT_FOUND: 404,
  // Content Library (03 §5, Phase 3)
  LIBRARY_ENTRY_NOT_FOUND: 404,
  LIBRARY_DUPLICATE: 409,
  // Notice templates (03 §5, Phase 3)
  TEMPLATE_NOT_FOUND: 404,
  TEMPLATE_EXISTS: 409,
  TEMPLATE_REVIEW_REQUIRED: 409,
  // Masjid admin content (03 §4, Phase 3)
  PRECONDITION_FAILED: 412, // If-Match: someone else saved in between
  TIMINGS_INVALID: 400,
  NOTIFY_QUOTA_EXCEEDED: 409,
  ACTIVATION_TIMINGS_REQUIRED: 409,
  SPECIAL_DATE_NOT_FOUND: 404,
  SPECIAL_DATE_INVALID: 400,
  RAMADAN_INVALID: 400,
  IMAGE_INVALID: 422, // not an accepted photo, HEIC, over 40 MP, corrupt (T3.6)
  ANNOUNCEMENT_INVALID: 400, // template params, another masjid's photo, event time out of range (T3.6)
  DUA_INVALID: 400, // janaza time out of range (T3.8)
  EDIT_WINDOW_CLOSED: 409, // a post is editable for 24 h after publishing (00 §4.3, T3.9)
  ITEM_NOT_EDITABLE: 409, // timing updates and later types are not edited in B12 (T3.9)
  AUDIO_INVALID: 422, // not an accepted recording by its first bytes (T3.13)
  AUDIO_TOO_LONG: 422, // over 10 minutes (04 R14, T3.13)
  VOICE_INVALID: 400, // another masjid's recording, or a voice note without a title (T3.13)
  PROFILE_INVALID: 400, // another masjid's photo, Hijri offset outside −2…+2, nothing to change (T3.10)
  ADHKAR_INVALID: 400, // over 30 entries or one listed twice (T3.14)
  RUQYAH_INVALID: 400, // a recording without the ownership tick or title, or another masjid's (T3.15)
  RUQYAH_NOT_FOUND: 404, // unknown or deleted Ruqyah entry (T3.15)
  RUQYAH_LIMIT_REACHED: 409, // 50 active entries (00 §4.10, T3.15)
  RUQYAH_ORDER_INVALID: 409, // the order names a missing, extra or deleted entry — the list changed (T3.15)
  CONTACT_INVALID: 400, // no consent, or a number not in E.164 (T3.16)
  CONTACT_NOT_FOUND: 404, // unknown or deleted Ilm contact (T3.16)
  CONTACT_LIMIT_REACHED: 409, // 10 active contacts (00 §4.12, T3.16)
  PUSH_ENDPOINT_IN_USE: 409, // this browser's subscription belongs to another app id; the app re-subscribes (T4.2)
  PAYMENT_INVALID: 400, // VPA not as the database accepts it, payee name 1–100, note ≤ 300, reason 1–300 (T5.2)
  PAYMENT_UNCHANGED: 409, // the requested details are the live ones (T5.2)
  PAYMENT_OWNER_ONLY: 403, // only a masjid owner may ask to change the UPI details (04 R1, #161)
  PAYMENT_REQUEST_OPEN: 409, // one pending / on-hold request per masjid (04 R1, T5.2)
  PAYMENT_DETAILS_IN_TEXT: 400, // a UPI ID or upi: link in free text (04 R1, #160)
  PAYMENT_NOTICE_UNAVAILABLE: 409, // the "Payment details updated" template is not active (#160)
  PAYMENT_NOT_FOUND: 404, // unknown payment request (T5.2)
  PAYMENT_NOT_PENDING: 409, // approve: already approved, rejected or live (T5.2)
  PAYMENT_REQUESTER_REMOVED: 409, // approve: the requester lost access — the request was closed instead (#161)
  PAYMENT_NOT_OPEN: 409, // reject: already live, rejected or superseded (T5.2)
  VIDEO_INVALID: 400, // bayan texts / audience / thumbnail not as required (T6.2)
  INVALID_VIDEO_LINK: 422, // not a link to one YouTube video (04 §6, T6.1)
  VIDEO_UNAVAILABLE: 422, // private, deleted or embedding turned off (oEmbed, T6.1)
  VIDEO_LOOKUP_FAILED: 503, // YouTube could not be asked — try again (T6.1)
  ITEM_LOCKED: 409, // the "Payment details updated" notice cannot be edited or deleted (04 R1, T5.2)
  CAMPAIGN_INVALID: 400, // title 1–120, description ≤ 1,500, target ≥ ₹1,000, dates, another masjid's cover (T5.3)
  CAMPAIGN_NO_PAYMENT: 409, // no active UPI details yet (00 §4.3, T5.3)
  CAMPAIGN_LIMIT_REACHED: 409, // 3 active campaigns (00 §4.3, T5.3)
  CAMPAIGN_NOT_FOUND: 404, // unknown or deleted campaign (T5.3)
  CAMPAIGN_NOT_ACTIVE: 409, // edit / complete: already completed or closed (T5.3)
  CAMPAIGN_CLOSED: 409, // "Update amount" after the end date (T5.3)
  CAMPAIGN_TARGET_LOWER: 409, // the target only goes up (00 §4.3, T5.3)
  CHANDA_INVALID: 400, // not a week start of the masjid, a future week, amount, note ≤ 200, week start 1–7 (T5.5)
  CHANDA_HIDDEN: 409, // "Notify followers" while chanda is not shown (T5.5)
  BENEFICIARY_INVALID: 400, // an invalid UPI ID, a name / reason / payee out of range, a cap outside ₹1 … ₹1 crore (T5.8)
  BENEFICIARY_NOT_FOUND: 404, // unknown person, or closed / deleted (T5.8)
  BENEFICIARY_LIMIT_REACHED: 409, // 100 active people (00 §4.14, T5.8)
} as const satisfies Readonly<Record<string, number>>;

export type ApiErrorCode = keyof typeof API_ERRORS;

/** All codes in declaration order. */
export const API_ERROR_CODES = Object.keys(API_ERRORS) as ApiErrorCode[]; // keys of the literal above

/** The HTTP status a code is sent with. */
export const statusOf = (code: ApiErrorCode): number => API_ERRORS[code];
