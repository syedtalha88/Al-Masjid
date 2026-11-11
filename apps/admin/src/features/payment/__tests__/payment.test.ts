import { formatters } from '@mc/i18n/format';
import { describe, expect, it } from 'vitest';

import { draftFromScan, draftIssues, emptyDraft, liveAtText, requestBody, stepsDone } from '../lib/payment.ts';

// PHASE_05 T5.2 — B8: the request body is exactly what the Super Admin approves (VPA normalized, payee name cleaned);
// a scan fills the draft only from a real `upi://pay` QR (04 §6). Fake VPAs only.

describe('B8 draft', () => {
  it('needs a valid UPI ID and a payee name', () => {
    expect(draftIssues(emptyDraft())).toEqual(['vpa', 'payee']);
    expect(draftIssues({ vpa: 'not a vpa', payee: 'X', note: '' })).toEqual(['vpa']);
    expect(draftIssues({ vpa: 'masjid@okbank', payee: ' \n ', note: '' })).toEqual(['payee']);
    expect(draftIssues({ vpa: 'masjid@okbank', payee: 'x'.repeat(101), note: '' })).toEqual(['payee']);
    expect(requestBody(emptyDraft())).toBeNull();
  });

  it('sends the normalized VPA, the cleaned name and a note only when there is one', () => {
    expect(requestBody({ vpa: ' Masjid.Test@OKBank ', payee: 'Test  Masjid\nCommittee', note: '  ' })).toEqual({
      vpa: 'Masjid.Test@okbank',
      payeeName: 'Test Masjid Committee',
    });
    expect(requestBody({ vpa: 'masjid@okbank', payee: 'X', note: ' New account ' })).toEqual({
      vpa: 'masjid@okbank',
      payeeName: 'X',
      note: 'New account',
    });
  });
});

describe('B8 scan', () => {
  const typed = { vpa: '', payee: 'Typed Name', note: 'n' };

  it('fills VPA and payee from a UPI QR, keeps the typed name when the QR has none', () => {
    expect(draftFromScan('upi://pay?pa=Masjid@OKBANK&pn=Test%20Committee&am=500', typed)).toEqual({
      vpa: 'Masjid@okbank',
      payee: 'Test Committee',
      note: 'n',
    });
    expect(draftFromScan('upi://pay?pa=masjid@okbank', typed)?.payee).toBe('Typed Name');
  });

  it('ignores anything that is not a UPI payment QR', () => {
    for (const text of [
      'https://app.example/m/TESTA001',
      'TESTA001',
      'upi://mandate?pa=a.b@okbank',
      'upi://pay?pn=X',
    ]) {
      expect(draftFromScan(text, typed), text).toBeNull();
    }
  });
});

describe('B8 status', () => {
  it('counts the steps of the timeline', () => {
    const row = { id: 'x', vpa: 'a.b@okbank', payeeName: 'X', requestedAt: '2026-11-10T06:30:00.000Z' };
    expect(stepsDone(null)).toBe(0);
    expect(stepsDone({ ...row, status: 'pending' })).toBe(1);
    expect(stepsDone({ ...row, status: 'approved_on_hold' })).toBe(2);
    expect(stepsDone({ ...row, status: 'rejected' })).toBe(1);
  });

  it('shows when the details go live in IST', () => {
    // Intl puts a narrow no-break space before the day period.
    const text = liveAtText('2026-11-11T11:00:00.000Z', formatters('en'));
    expect(text.replace(/[\u2066-\u2069]/gu, '').replace(/\s/gu, ' ')).toBe('Wed, 11 Nov, 4:30 PM');
  });

  it('keeps the time left to right inside Urdu text ("4:30 PM", never "PM 4:30")', () => {
    const text = liveAtText('2026-11-11T11:00:00.000Z', formatters('ur'));
    expect(text).toMatch(/\u2066[^\u2069]*4:30[^\u2069]*\u2069$/u);
  });
});
