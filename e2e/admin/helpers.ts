// Shared by the admin auth e2e specs (PHASE_01 T1.8 / T1.11): Chromium's virtual passkey authenticator and the
// runtime-test seed hooks (E2E_TEST_HOOKS=1, `pnpm stack:up:test`).
import { expect } from '@mc/config/playwright';
import type { APIRequestContext, CDPSession, Page } from '@playwright/test';

import { ADMIN_URL } from '../../playwright.config.ts';

export const HOOKS = process.env['E2E_TEST_HOOKS'] === '1';
/** api-admin refuses unsafe requests without its Origin + CSRF header (03 §1). */
export const CSRF = { Origin: new URL(ADMIN_URL).origin, 'X-MC-CSRF': '1' };

/** A platform passkey on this page's browser: discoverable, user-verifying, approves every prompt. */
export async function virtualAuthenticator(page: Page): Promise<{ cdp: CDPSession; authenticatorId: string }> {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('WebAuthn.enable');
  const { authenticatorId } = await cdp.send('WebAuthn.addVirtualAuthenticator', {
    options: {
      protocol: 'ctap2',
      transport: 'internal',
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
      automaticPresenceSimulation: true,
    },
  });
  return { cdp, authenticatorId };
}

/**
 * The 03 §2 login limits (10 / 10 min / IP) count per IP, and every spec here comes from the same one: each starts
 * from zero. Two of these specs running AT THE SAME TIME still share one budget — CI runs one worker; locally run
 * them with `--workers=1`.
 */
export async function resetRateLimits(request: APIRequestContext): Promise<void> {
  const response = await request.delete(`${ADMIN_URL}/api/admin/test/rate-limits`, { headers: CSRF });
  expect(response.status()).toBe(200);
}

/** A new Super Admin invite, as `deploy.sh --bootstrap-super-admin` would print it; returns the token. */
export async function seedSuperAdminInvite(request: APIRequestContext, displayName: string): Promise<string> {
  const seeded = await request.post(`${ADMIN_URL}/api/admin/test/super-admin-invite`, {
    data: { displayName },
    headers: CSRF,
  });
  expect(seeded.status()).toBe(201);
  return new URL(((await seeded.json()) as { inviteUrl: string }).inviteUrl).hash.slice(1);
}

/** Opens an invite link and creates the passkey (07 B1). */
export async function registerWithInvite(page: Page, inviteUrl: string, displayName: string): Promise<void> {
  await page.goto(inviteUrl);
  await expect(page.getByRole('heading', { name: new RegExp(displayName) })).toBeVisible();
  await page.getByRole('button', { name: 'Create my login' }).click();
  await expect(page.getByText('Your login is ready').first()).toBeVisible();
}

export const me = (page: Page) => page.request.get(`${ADMIN_URL}/api/admin/auth/me`);
