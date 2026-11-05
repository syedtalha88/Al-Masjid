// B17 Ilm contacts (07 B17, PHASE_03 T3.16): the editor's draft, the save body and the consent rule. Pure functions; the
// server checks the same rules (consent ticked, E.164, ≤ 10 contacts).
import {
  type AdminContact,
  CONTACT_NAME_MAX,
  CONTACT_ROLE_MAX,
  CONTACT_TOPICS_MAX,
  type ContactSave,
  E164,
} from '@mc/shared/contracts';

import { phoneValue } from '../../notice/lib/notice.ts';

export type ContactAudience = AdminContact['audience'];

export interface ContactDraft {
  readonly name: string;
  readonly role: string;
  readonly topics: string;
  /** As typed ("98765 43210", "+91 98765 43210"); saved as E.164. */
  readonly phone: string;
  readonly audience: ContactAudience | null;
  /** "This person agreed to be listed". */
  readonly consent: boolean;
}

/** A new contact: +91 prefilled (07 B17), nothing else chosen. */
export const emptyDraft = (): ContactDraft => ({
  name: '',
  role: '',
  topics: '',
  phone: '+91 ',
  audience: null,
  consent: false,
});

/** "+919876543210" → "+91 98765 43210" (an Indian mobile number reads in two groups); any other number as stored. */
export function displayPhone(e164: string): string {
  const match = /^\+91(\d{5})(\d{5})$/.exec(e164);
  return match ? `+91 ${match[1] ?? ''} ${match[2] ?? ''}` : e164;
}

/** A saved contact as a draft — its consent was given when it was saved. */
export const draftOf = (contact: AdminContact): ContactDraft => ({
  name: contact.name,
  role: contact.role ?? '',
  topics: contact.topics ?? '',
  phone: displayPhone(contact.whatsapp),
  audience: contact.audience,
  consent: true,
});

/**
 * The draft after an edit. A saved contact's tick is cleared when its name or number changes — the person agreed to be
 * listed with those, so the admin confirms again.
 */
export function applyChange(
  saved: ContactDraft | null,
  draft: ContactDraft,
  patch: Partial<ContactDraft>,
): ContactDraft {
  const next = { ...draft, ...patch };
  if (saved === null || 'consent' in patch) return next;
  const changed = next.name.trim() !== saved.name.trim() || phoneValue(next.phone) !== phoneValue(saved.phone);
  return changed && ('name' in patch || 'phone' in patch) ? { ...next, consent: false } : next;
}

export type ContactIssue = 'name' | 'role' | 'topics' | 'phone' | 'audience' | 'consent';

const tooLong = (value: string, max: number) => value.trim().length > max;

/** What still keeps the draft from being saved (empty = ready). */
export function draftIssues(draft: ContactDraft): ContactIssue[] {
  const issues: ContactIssue[] = [];
  if (draft.name.trim() === '' || tooLong(draft.name, CONTACT_NAME_MAX)) issues.push('name');
  if (tooLong(draft.role, CONTACT_ROLE_MAX)) issues.push('role');
  if (tooLong(draft.topics, CONTACT_TOPICS_MAX)) issues.push('topics');
  if (!E164.test(phoneValue(draft.phone.trim()))) issues.push('phone');
  if (!draft.audience) issues.push('audience');
  if (!draft.consent) issues.push('consent');
  return issues;
}

const optional = (value: string) => {
  const trimmed = value.trim();
  return trimmed === '' ? undefined : trimmed;
};

/** The `POST` / `PATCH /contacts` body, or `null` while an issue remains. */
export function draftBody(draft: ContactDraft): ContactSave | null {
  if (draftIssues(draft).length > 0 || !draft.audience) return null;
  const role = optional(draft.role);
  const topics = optional(draft.topics);
  return {
    name: draft.name.trim(),
    ...(role === undefined ? {} : { role }),
    ...(topics === undefined ? {} : { topics }),
    whatsapp: phoneValue(draft.phone.trim()),
    audience: draft.audience,
    consentConfirmed: true,
  };
}

/** Has anything changed since the draft was opened? */
export const draftDirty = (saved: ContactDraft, draft: ContactDraft): boolean =>
  JSON.stringify(draftBody(saved)) !== JSON.stringify(draftBody(draft)) || saved.consent !== draft.consent;
