// 02 §2 "Payments" — needy people (DECISIONS #104, PHASE_05 T5.8): `beneficiaries` and their append-only
// `beneficiary_amount_history`. A person the masjid has verified as in need, listed with their own UPI details and
// their agreement (`consent_confirmed`, 05 §1). `private_enc` (phone / note, AES-256-GCM like `phone_enc`) is for the
// masjid's own admins only and is in no view. Money is integer paise (`long`).
import { absent } from './content.ts';
import { type BsonSchema, documentSchema, f, MAX_PAISE, opt } from './dsl.ts';
import { BENEFICIARY_CATEGORY, BENEFICIARY_STATUS, LOCALE } from './enums.ts';
import { ENCRYPTED_PATTERN } from './masjids.ts';
import { VPA_PATTERN } from './platform.ts';
import type { CollectionSpec } from './types.ts';

/** Most active needy people per masjid (00 §4.14). */
export const BENEFICIARIES_ACTIVE_MAX = 100;
/** 02 §2: what a person needs — ₹1 … ₹1 crore, in paise. */
export const BENEFICIARY_CAP_MIN_PAISE = 100;
export const BENEFICIARY_CAP_MAX_PAISE = 1_000_000_000;
/** 02 §6: a fulfilled, closed or deleted person's data is purged this many days later. */
export const BENEFICIARY_PURGE_DAYS = 90;

const PUBLIC_ID_PATTERN = '^[A-Za-z0-9_-]{12}$';

const statusIs = (...values: (typeof BENEFICIARY_STATUS)[number][]): BsonSchema => ({
  properties: { status: { enum: values } },
});

const beneficiariesBase = documentSchema(
  {
    _id: f.uuid(),
    public_id: f.string(12, { pattern: PUBLIC_ID_PATTERN }),
    masjid_id: f.uuid(),
    // First name or initials only (the admin screen says so — 00 §4.14).
    display_name: f.string(40, { minLength: 1 }),
    category: f.enum(BENEFICIARY_CATEGORY),
    reason: f.string(300, { minLength: 1 }),
    reason_locale: f.enum(LOCALE),
    vpa: f.string(100, { pattern: VPA_PATTERN }),
    payee_name: f.string(100, { minLength: 1 }),
    cap_paise: f.long(BENEFICIARY_CAP_MIN_PAISE, BENEFICIARY_CAP_MAX_PAISE),
    received_paise: f.long(0, MAX_PAISE),
    received_updated_at: opt(f.instant()),
    // min(1000, received × 1000 ÷ cap) — kept by the data layer for "least-funded first".
    funded_permille: f.int(0, 1000),
    zakat_eligible: f.bool(),
    // "The person — or a guardian for a child — agreed to be listed" (05 §1): never stored without it.
    consent_confirmed: f.confirmed(),
    private_enc: opt(f.string(1200, { pattern: ENCRYPTED_PATTERN })),
    status: f.enum(BENEFICIARY_STATUS),
    fulfilled_at: opt(f.instant()),
    closed_at: opt(f.instant()),
    purge_after: opt(f.instant()),
    masjid_visible: f.bool(),
    created_by: f.uuid(),
    created_at: f.instant(),
    updated_at: f.instant(),
  },
  {
    oneOf: [
      // Listed: no end dates, no purge clock.
      { ...statusIs('active'), ...absent('fulfilled_at', 'closed_at', 'purge_after') },
      // Cap reached: hidden, the 90-day clock runs.
      { ...statusIs('fulfilled'), required: ['fulfilled_at', 'purge_after'], ...absent('closed_at') },
      // Taken off the list by the masjid (closed or deleted).
      { ...statusIs('closed', 'deleted'), required: ['closed_at', 'purge_after'] },
    ],
  },
);

const beneficiaries = {
  jsonSchema: beneficiariesBase.jsonSchema,
  zod: beneficiariesBase.zod.superRefine((doc, ctx) => {
    const ended = doc.status === 'closed' || doc.status === 'deleted';
    const issue = (path: string, message: string) => {
      ctx.addIssue({ code: 'custom', path: [path], message });
    };
    if ((doc.purge_after !== undefined) !== (doc.status !== 'active')) {
      issue('purge_after', 'purge_after is set exactly when the person is no longer listed');
    }
    if (ended !== (doc.closed_at !== undefined)) issue('closed_at', 'closed_at is set exactly when closed or deleted');
    if (doc.status === 'fulfilled' && doc.fulfilled_at === undefined) {
      issue('fulfilled_at', 'a fulfilled person has fulfilled_at');
    }
    if (doc.status === 'active' && doc.fulfilled_at !== undefined) {
      issue('fulfilled_at', 'an active person has no fulfilled_at');
    }
  }),
};

const beneficiaryAmountHistory = documentSchema({
  _id: f.uuid(),
  beneficiary_id: f.uuid(),
  masjid_id: f.uuid(),
  received_paise: f.long(0, MAX_PAISE),
  updated_by: f.uuid(),
  created_at: f.instant(),
});

export const BENEFICIARY_COLLECTIONS: readonly CollectionSpec[] = [
  {
    name: 'beneficiaries',
    ...beneficiaries,
    indexes: [
      { name: 'public_id_unique', key: { public_id: 1 }, unique: true },
      // The public list (least-funded first, then oldest) and the admin's list by status.
      { name: 'masjid_status_funded', key: { masjid_id: 1, status: 1, funded_permille: 1, created_at: 1 } },
      { name: 'purge_after', key: { purge_after: 1 }, partialFilterExpression: { purge_after: { $type: 'date' } } },
    ],
  },
  {
    name: 'beneficiary_amount_history',
    ...beneficiaryAmountHistory,
    indexes: [{ name: 'beneficiary_created', key: { beneficiary_id: 1, created_at: -1 } }],
  },
];
