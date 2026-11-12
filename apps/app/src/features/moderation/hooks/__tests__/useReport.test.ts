import { NetworkError, ProblemError } from '@mc/shared/http';
import { describe, expect, it } from 'vitest';

import { reportProblem } from '../useReport.ts';

// PHASE_08 T8.1: what the report sheet says when sending fails.

const problem = (status: number, code: string) =>
  new ProblemError({ type: 'about:blank', title: code, status, code }, undefined);

describe('reportProblem', () => {
  it('maps no connection, the daily limit and a target that is gone', () => {
    expect(reportProblem(new NetworkError('failed'))).toBe('offline');
    expect(reportProblem(new NetworkError('timeout'))).toBe('offline');
    expect(reportProblem(problem(429, 'RATE_LIMITED'))).toBe('limit');
    expect(reportProblem(problem(404, 'REPORT_TARGET_NOT_FOUND'))).toBe('gone');
  });

  it('anything else is "could not send"', () => {
    expect(reportProblem(problem(403, 'TURNSTILE_FAILED'))).toBe('failed');
    expect(reportProblem(problem(500, 'INTERNAL'))).toBe('failed');
    expect(reportProblem(new Error('turnstile timeout'))).toBe('failed');
  });
});
