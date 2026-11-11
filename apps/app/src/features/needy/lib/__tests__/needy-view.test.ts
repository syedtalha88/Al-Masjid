import type { Beneficiary } from '@mc/shared/contracts/public';
import { describe, expect, it } from 'vitest';

import { needyLink, needyProgress, peopleToShow } from '../needy-view.ts';

// PHASE_05 T5.8 — A23: the zakat filter keeps the server's order (least-funded first), the progress bar caps while the
// text shows the real numbers, and "Pay with UPI" goes straight to the person with no amount. Fake people only.

const person = (patch: Partial<Beneficiary> = {}): Beneficiary => ({
  publicId: 'AAAAAAAAAAAA',
  displayName: 'Test A.',
  category: 'widow',
  reason: 'Test reason for help',
  reasonLocale: 'en',
  vpa: 'test.person@okbank',
  payeeName: 'Test Person',
  capPaise: 300_000,
  receivedPaise: 120_000,
  fundedPermille: 400,
  zakatEligible: false,
  ...patch,
});

describe('A23 list', () => {
  it('shows everyone, or only the zakat-eligible, in the order the server sent', () => {
    const people = [
      person({ publicId: 'AAAAAAAAAAA1' }),
      person({ publicId: 'AAAAAAAAAAA2', zakatEligible: true }),
      person({ publicId: 'AAAAAAAAAAA3' }),
      person({ publicId: 'AAAAAAAAAAA4', zakatEligible: true }),
    ];
    expect(peopleToShow(people, false).map((p) => p.publicId)).toEqual(people.map((p) => p.publicId));
    expect(peopleToShow(people, true).map((p) => p.publicId)).toEqual(['AAAAAAAAAAA2', 'AAAAAAAAAAA4']);
  });

  it('progress: a capped bar, what is still needed never below zero', () => {
    expect(needyProgress(person())).toEqual({ fraction: 0.4, remainingPaise: 180_000 });
    expect(needyProgress(person({ receivedPaise: 400_000 }))).toEqual({ fraction: 1, remainingPaise: 0 });
    expect(needyProgress(person({ capPaise: 0 }))).toEqual({ fraction: 0, remainingPaise: 0 });
  });
});

describe('A23 pay', () => {
  it('builds a UPI link to the person: their UPI ID and payee name, the masjid as the note, never an amount', () => {
    const link = needyLink(person(), 'Test Masjid Delta');
    expect(link).toBe('upi://pay?pa=test.person@okbank&pn=Test%20Person&tn=Test%20Masjid%20Delta&cu=INR');
    expect(link).not.toContain('am=');
  });

  it('gives no link rather than a wrong one when the details are not usable', () => {
    expect(needyLink(person({ vpa: 'not a upi id' }), 'Test Masjid Delta')).toBeNull();
  });
});
