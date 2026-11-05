// B17 editor rules (PHASE_03 T3.16): the save body (E.164, +91 for a 10-digit mobile, optional role / topics), what is
// still missing (the consent tick above all), and the tick cleared when a saved contact's name or number changes.
import type { AdminContact } from '@mc/shared/contracts';
import { describe, expect, it } from 'vitest';

import { applyChange, displayPhone, draftBody, draftDirty, draftIssues, draftOf, emptyDraft } from '../lib/contacts.ts';

const SAVED: AdminContact = {
  id: '00000000-0000-4000-8000-0000000000c1',
  name: 'Test Contact',
  role: 'Sample role',
  whatsapp: '+919876500001',
  audience: 'sisters',
};

describe('B17 contact draft', () => {
  it('a new contact starts with +91 and needs a name, a number, an audience and the tick', () => {
    const draft = emptyDraft();
    expect(draft.phone).toBe('+91 ');
    expect(draftIssues(draft)).toEqual(['name', 'phone', 'audience', 'consent']);
    expect(draftBody(draft)).toBeNull();
    const ready = { ...draft, name: ' Test Contact ', phone: '98765 00001', audience: 'brothers' as const };
    expect(draftIssues(ready)).toEqual(['consent']);
    expect(draftBody(ready)).toBeNull();
    expect(draftBody({ ...ready, consent: true })).toEqual({
      name: 'Test Contact',
      whatsapp: '+919876500001',
      audience: 'brothers',
      consentConfirmed: true,
    });
  });

  it('accepts a number typed with +91 and spaces or dashes; refuses one that is not E.164', () => {
    const base = { ...emptyDraft(), name: 'Test', audience: 'sisters' as const, consent: true };
    expect(draftBody({ ...base, phone: '+91 98765-00001' })?.whatsapp).toBe('+919876500001');
    expect(draftBody({ ...base, phone: '+44 20 0000 0000' })?.whatsapp).toBe('+442000000000');
    for (const phone of ['+91 ', '12345', '098765 00001', '+91 98765 0000x']) {
      expect(draftIssues({ ...base, phone })).toEqual(['phone']);
    }
  });

  it('keeps role and topics only when filled, and refuses them over their limits', () => {
    const base = { ...emptyDraft(), name: 'Test', phone: '9876500001', audience: 'sisters' as const, consent: true };
    expect(draftBody({ ...base, role: '  ', topics: ' Sample topics ' })).toMatchObject({ topics: 'Sample topics' });
    expect(draftBody({ ...base, role: '  ' })).not.toHaveProperty('role');
    expect(draftIssues({ ...base, role: 'x'.repeat(61), topics: 'x'.repeat(121) })).toEqual(['role', 'topics']);
  });

  it('a saved contact opens ticked, with its number in two groups', () => {
    const draft = draftOf(SAVED);
    expect(draft).toMatchObject({ phone: '+91 98765 00001', consent: true, topics: '' });
    expect(displayPhone('+442000000000')).toBe('+442000000000');
    expect(draftDirty(draft, draft)).toBe(false);
    expect(draftDirty(draft, { ...draft, audience: 'brothers' })).toBe(true);
  });

  it('a new name or number clears the tick; other edits, or typing it back, keep it', () => {
    const saved = draftOf(SAVED);
    expect(applyChange(saved, saved, { role: 'Another role' }).consent).toBe(true);
    expect(applyChange(saved, saved, { audience: 'brothers' }).consent).toBe(true);
    expect(applyChange(saved, saved, { phone: '9876500001' }).consent).toBe(true); // the same number, typed differently
    const renamed = applyChange(saved, saved, { name: 'Test Contact Two' });
    expect(renamed.consent).toBe(false);
    expect(applyChange(saved, saved, { phone: '+91 98765 00002' }).consent).toBe(false);
    expect(applyChange(saved, renamed, { consent: true }).consent).toBe(true);
    // A new contact keeps the tick whatever is typed after it.
    const fresh = { ...emptyDraft(), consent: true };
    expect(applyChange(null, fresh, { name: 'Test' }).consent).toBe(true);
  });
});
