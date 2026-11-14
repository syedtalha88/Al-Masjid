// PHASE_08 T8.10 (05 §1, 02 §2 audit_log): the audit vocabulary is reviewable and carries no secrets or personal data.
// Every action's meta keys are an allow-list (`writeAudit` drops anything else); this pins that no allowed key can hold
// a phone, e-mail, contact, address, token, key, password, push subscription, IP, UPI id or free-text name of a person —
// so the Super Admin's CSV export (C11 ★) cannot leak them either.
import { describe, expect, it } from 'vitest';

import { AUDIT_ACTIONS } from '../src/effects.ts';

/** Names a key must never have (whole words of a snake_case key). */
const FORBIDDEN =
  /(^|_)(phone|mobile|email|e_mail|contact|address|token|secret|password|passcode|key|otp|cookie|session|ip|vpa|upi_id|payee|endpoint|p256dh|auth|description|details|display_name|person|beneficiary_name)(_|$)/;

describe('audit allow-list (T8.10)', () => {
  it('actions are noun.verb in snake_case; meta keys are snake_case', () => {
    for (const [action, keys] of Object.entries(AUDIT_ACTIONS)) {
      expect(action).toMatch(/^[a-z_]+\.[a-z_]+$/);
      for (const key of keys) expect(key, action).toMatch(/^[a-z][a-z0-9_]*$/);
    }
  });

  it('no meta key can carry a secret or personal data', () => {
    const offending = Object.entries(AUDIT_ACTIONS).flatMap(([action, keys]) =>
      keys.filter((key) => FORBIDDEN.test(key)).map((key) => `${action}.${key}`),
    );
    expect(offending).toEqual([]);
  });

  it('the pattern catches what it must', () => {
    for (const key of ['phone', 'admin_phone', 'email', 'contact', 'push_endpoint', 'api_key', 'ip', 'session_token']) {
      expect(FORBIDDEN.test(key), key).toBe(true);
    }
    for (const key of ['fields', 'credential_hash', 'role', 'reason', 'counts', 'upi_changed']) {
      expect(FORBIDDEN.test(key), key).toBe(false);
    }
  });
});
