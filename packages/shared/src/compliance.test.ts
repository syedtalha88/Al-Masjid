import { describe, expect, it } from 'vitest';

import { REPORT_REASONS, reportSla, SLA_MS, slaProgress, URGENT_REPORT_REASONS } from './compliance.ts';

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

describe('slaProgress', () => {
  const start = new Date('2026-11-13T00:00:00Z');
  const due = new Date('2026-11-13T10:00:00Z'); // 10 hours
  const at = (hours: number) => new Date(start.getTime() + hours * 3_600_000);

  it('the highest threshold reached (50 / 80 / 100 % of the time used)', () => {
    expect(slaProgress(start, due, at(4.9)).level).toBe(0);
    expect(slaProgress(start, due, at(5)).level).toBe(50);
    expect(slaProgress(start, due, at(7.99)).level).toBe(50);
    expect(slaProgress(start, due, at(8)).level).toBe(80);
    expect(slaProgress(start, due, at(10)).level).toBe(100);
    expect(slaProgress(start, due, at(30)).level).toBe(100);
  });

  it('red when under 20 % of the time is left (C1), overdue past the due time', () => {
    expect(slaProgress(start, due, at(7.9))).toMatchObject({ red: false, overdue: false });
    expect(slaProgress(start, due, at(8.1))).toMatchObject({ red: true, overdue: false });
    expect(slaProgress(start, due, at(10.5))).toMatchObject({ red: true, overdue: true });
  });

  it('a due time at or before the start is simply due', () => {
    expect(slaProgress(due, due, due)).toMatchObject({ level: 100, red: true });
  });
});
