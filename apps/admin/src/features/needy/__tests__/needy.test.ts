import type { AdminBeneficiary } from '@mc/shared/contracts';
import { describe, expect, it } from 'vitest';

import {
  draftFromScan,
  draftOf,
  emptyDraft,
  needyActions,
  needyBody,
  needyIssues,
  needyPercent,
  peopleWithStatus,
  withPrivate,
} from '../lib/needy.ts';

// PHASE_05 T5.8 — B19: what blocks Save (the consent tick on every save), the body (integer paise, the private part
// sent only when the admin saw or typed it), a scanned UPI QR, and what each person's card offers. Fake people only.

const ready = {
  ...emptyDraft(),
  name: 'Test A.',
  category: 'widow' as const,
  reason: 'Test reason for help',
  vpa: 'Test.Person@OkBank',
  payee: 'Test Person',
  capPaise: 300_000,
  consent: true,
};

const person = (patch: Partial<AdminBeneficiary> = {}): AdminBeneficiary => ({
  id: 'p1',
  publicId: 'pub1',
  displayName: 'Test A.',
  category: 'widow',
  reason: 'Test reason for help',
  reasonLocale: 'hi',
  vpa: 'test.person@okbank',
  payeeName: 'Test Person',
  capPaise: 300_000,
  receivedPaise: 120_000,
  fundedPermille: 400,
  zakatEligible: true,
  status: 'active',
  hasPrivate: true,
  createdAt: '2026-11-01T00:00:00.000Z',
  ...patch,
});

describe('B19 add / edit', () => {
  it('needs a name, a category, a reason, a valid UPI ID, the payee name, the amount needed and the consent tick', () => {
    expect(needyIssues(emptyDraft())).toEqual(['name', 'category', 'reason', 'vpa', 'payee', 'cap', 'consent']);
    expect(needyIssues(ready)).toEqual([]);
    expect(needyIssues({ ...ready, vpa: 'not a upi id' })).toEqual(['vpa']);
    expect(needyIssues({ ...ready, capPaise: 99 })).toEqual(['cap']);
    expect(needyIssues({ ...ready, capPaise: 1_000_000_001 })).toEqual(['cap']);
    expect(needyIssues({ ...ready, consent: false })).toEqual(['consent']);
    expect(needyBody({ ...ready, consent: false }, 'en')).toBeNull();
  });

  it('an optional phone must be a real number when one is typed; the prefilled +91 alone is no number', () => {
    expect(needyIssues({ ...ready, phone: '+91 ' })).toEqual([]);
    expect(needyIssues({ ...ready, phone: '12345' })).toEqual(['phone']);
    expect(needyIssues({ ...ready, phone: '98765 43210' })).toEqual([]);
  });

  it('builds the body: UPI ID normalized, paise integers, the reason in the language it was typed in', () => {
    expect(needyBody(ready, 'ur')).toEqual({
      displayName: 'Test A.',
      category: 'widow',
      reason: 'Test reason for help',
      reasonLocale: 'ur',
      vpa: 'Test.Person@okbank',
      payeeName: 'Test Person',
      capPaise: 300_000,
      zakatEligible: false,
      consentConfirmed: true,
    });
  });

  it('a new person sends the private part only when something was typed', () => {
    expect(needyBody({ ...ready, phone: '98765 43210', note: ' Test note ' }, 'en')?.private).toEqual({
      phone: '+919876543210',
      note: 'Test note',
    });
    expect(needyBody(ready, 'en')).not.toHaveProperty('private');
  });

  it('a saved person: consent is ticked again, the private part is kept unless the admin opened it', () => {
    const saved = draftOf(person());
    expect(saved.consent).toBe(false);
    expect(saved.privateLoaded).toBe(false);
    expect(saved.capPaise).toBe(300_000);
    const ticked = { ...saved, consent: true };
    // Not opened: nothing about the private part is sent (the server keeps it).
    expect(needyBody(ticked, 'en')).not.toHaveProperty('private');
    // The reason was not retyped: it stays in its own language.
    expect(needyBody(ticked, 'en')?.reasonLocale).toBe('hi');
    expect(needyBody({ ...ticked, reason: 'Test new reason' }, 'te')?.reasonLocale).toBe('te');
    // Opened and emptied: removed.
    const opened = withPrivate(ticked, { phone: '+919876543210' });
    expect(opened.privateLoaded).toBe(true);
    expect(needyBody(opened, 'en')?.private).toEqual({ phone: '+919876543210' });
    expect(needyBody({ ...opened, phone: '' }, 'en')?.private).toBeNull();
    // A person without a private part can get one without opening anything.
    expect(draftOf(person({ hasPrivate: false })).privateLoaded).toBe(true);
  });

  it('a scanned UPI QR fills the UPI ID and the payee name; anything else is refused', () => {
    const filled = draftFromScan('upi://pay?pa=test.person@okbank&pn=Test%20Person&am=500', emptyDraft());
    expect(filled).toMatchObject({ vpa: 'test.person@okbank', payee: 'Test Person' });
    expect(draftFromScan('https://example.test/', emptyDraft())).toBeNull();
    // Details the person agreed to changed: the tick is asked again.
    expect(draftFromScan('upi://pay?pa=test.person@okbank', ready)).toMatchObject({
      payee: 'Test Person',
      consent: false,
    });
  });
});

describe('B19 list', () => {
  it('shows the real percentage and filters by status', () => {
    expect(needyPercent(120_000, 300_000)).toBe(40);
    expect(needyPercent(0, 0)).toBe(0);
    const people = [person(), person({ id: 'p2', status: 'fulfilled' }), person({ id: 'p3', status: 'closed' })];
    expect(peopleWithStatus(people, 'active').map((p) => p.id)).toEqual(['p1']);
    expect(peopleWithStatus(people, 'closed').map((p) => p.id)).toEqual(['p3']);
  });

  it('active: everything; fulfilled: the amount can be corrected, closed or removed; closed: nothing', () => {
    expect(needyActions(person())).toEqual({ updateReceived: true, edit: true, end: true });
    expect(needyActions(person({ status: 'fulfilled' }))).toEqual({ updateReceived: true, edit: false, end: true });
    expect(needyActions(person({ status: 'closed' }))).toEqual({ updateReceived: false, edit: false, end: false });
  });
});
