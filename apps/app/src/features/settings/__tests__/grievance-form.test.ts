import { NetworkError, ProblemError } from '@mc/shared/http';
import { describe, expect, it } from 'vitest';

import { grievanceProblem } from '../GrievanceForm.tsx';

// PHASE_08 T8.4: what the grievance form says when sending failed.

const problem = (status: number, code: string) =>
  new ProblemError({ type: 'about:blank', title: code, status, code }, undefined);

describe('grievanceProblem', () => {
  it('offline, the daily limit, and a contact the server cannot take now', () => {
    expect(grievanceProblem(new NetworkError('timeout'))).toBe('offline');
    expect(grievanceProblem(problem(429, 'RATE_LIMITED'))).toBe('limit');
    expect(grievanceProblem(problem(503, 'GRIEVANCE_CONTACT_UNAVAILABLE'))).toBe('contactUnavailable');
  });

  it('anything else is "could not send"', () => {
    expect(grievanceProblem(problem(403, 'TURNSTILE_FAILED'))).toBe('failed');
    expect(grievanceProblem(problem(503, 'SERVICE_UNAVAILABLE'))).toBe('failed');
    expect(grievanceProblem(new Error('turnstile timeout'))).toBe('failed');
  });
});
