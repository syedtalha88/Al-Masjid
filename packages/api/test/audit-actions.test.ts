// PHASE_08 T8.10: the audit vocabulary the admin PWA filters by (`AUDIT_ACTION_NAMES`, @mc/shared — shared must not
// depend on the database package) equals the allow-list the database writes (`AUDIT_ACTIONS`, @mc/db).
import { AUDIT_ACTIONS } from '@mc/db';
import { AUDIT_ACTION_NAMES } from '@mc/shared/contracts';
import { describe, expect, it } from 'vitest';

describe('audit actions (T8.10)', () => {
  it('the C11 filter lists exactly the actions the database may write', () => {
    expect([...AUDIT_ACTION_NAMES].sort()).toEqual(Object.keys(AUDIT_ACTIONS).sort());
  });
});
