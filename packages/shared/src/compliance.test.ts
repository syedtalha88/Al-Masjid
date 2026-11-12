import { describe, expect, it } from 'vitest';

import { REPORT_REASONS, reportSla, SLA_MS, URGENT_REPORT_REASONS } from './compliance.ts';

// 05 §3 timelines (PHASE_08 T8.1 / T8.3).

const AT = new Date('2026-11-13T06:00:00Z');

describe('reportSla', () => {
  it('routes "personal or private information" to the urgent queue: due in 2 hours', () => {
    expect(reportSla('private_info', AT)).toEqual({ urgent: true, slaDueAt: new Date('2026-11-13T08:00:00Z') });
  });

  it('gives every other reason 36 hours', () => {
    for (const reason of REPORT_REASONS.filter((r) => !URGENT_REPORT_REASONS.includes(r))) {
      expect(reportSla(reason, AT)).toEqual({ urgent: false, slaDueAt: new Date('2026-11-14T18:00:00Z') });
    }
  });

  it('keeps the 05 §3 defaults', () => {
    expect(SLA_MS).toEqual({
      urgentReport: 7_200_000,
      report: 129_600_000,
      legalOrder: 10_800_000,
      grievanceAck: 86_400_000,
      grievanceResolve: 259_200_000,
    });
  });
});
