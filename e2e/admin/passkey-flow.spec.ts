import { expect, test } from '@mc/config/playwright';
import type { CDPSession, Page } from '@playwright/test';

import { ADMIN_URL } from '../../playwright.config.ts';

// PHASE_01 T1.8 acceptance, in the real admin app through Caddy: invite → register → logout → login → step-up →
// logout, with Chromium's virtual authenticator (CTAP2, internal, resident keys, user verification true). Needs the
// runtime-test stack (`pnpm stack:up:test`, E2E_TEST_HOOKS=1) for the Super Admin invite seed hook. The API-level
// failure cases (replay, wrong origin / RP ID, uv=false, counter regression, …) are in packages/api tests.

const HOOKS = process.env['E2E_TEST_HOOKS'] === '1';
const CSRF = { Origin: new URL(ADMIN_URL).origin, 'X-MC-CSRF': '1' };

/** A platform passkey on this page's browser: discoverable, user-verifying, approves every prompt. */
async function virtualAuthenticator(page: Page): Promise<{ cdp: CDPSession; authenticatorId: string }> {
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

const me = (page: Page) => page.request.get(`${ADMIN_URL}/api/admin/auth/me`);

test.describe('admin passkeys (T1.8)', () => {
  test.skip(!HOOKS, 'needs the runtime-test stack: E2E_TEST_HOOKS=1 and `pnpm stack:up:test`');

  test('invite → register → logout → login → step-up → logout', async ({ page, browserName }) => {
    test.skip(browserName !== 'chromium', 'the virtual authenticator is a Chromium DevTools feature');
    const { cdp, authenticatorId } = await virtualAuthenticator(page);
    const credentials = async () =>
      (await cdp.send('WebAuthn.getCredentials', { authenticatorId })).credentials.map((c) => ({
        resident: c.isResidentCredential,
        rpId: c.rpId,
        signCount: c.signCount,
      }));

    // An invite, as the bootstrap command would print it.
    const seeded = await page.request.post(`${ADMIN_URL}/api/admin/test/super-admin-invite`, {
      data: { displayName: 'E2E Owner' },
      headers: CSRF,
    });
    expect(seeded.status()).toBe(201);
    const token = new URL(((await seeded.json()) as { inviteUrl: string }).inviteUrl).hash.slice(1);

    // Register.
    await page.goto(`${ADMIN_URL}/invite#${token}`);
    await expect(page.getByRole('heading', { name: /E2E Owner/ })).toBeVisible();
    await page.getByRole('button', { name: 'Create my login' }).click();
    await expect(page.getByText('Your login is ready').first()).toBeVisible();
    const [created] = await credentials();
    expect(created).toMatchObject({ resident: true, rpId: new URL(ADMIN_URL).hostname });

    // The session cookie (04 §4): __Host- prefix, Secure, HttpOnly, SameSite=Strict, Path=/, host-only (no Domain).
    const session = (await page.context().cookies(ADMIN_URL)).find((c) => c.name === '__Host-mc_sess');
    expect(session).toMatchObject({
      secure: true,
      httpOnly: true,
      sameSite: 'Strict',
      path: '/',
      domain: new URL(ADMIN_URL).hostname,
    });
    expect((await me(page)).status()).toBe(200);

    // Log out (B13).
    await page.goto(`${ADMIN_URL}/account`);
    await page.getByRole('button', { name: 'Log out', exact: true }).last().click();
    await expect(page.getByRole('button', { name: 'Log in' })).toBeVisible();
    expect((await me(page)).status()).toBe(401);

    // Log in with the discoverable passkey (no username).
    await page.getByRole('button', { name: 'Log in' }).click();
    await expect(page.getByRole('button', { name: 'Log in' })).toBeHidden();
    expect((await me(page)).status()).toBe(200);
    const afterLogin = (await credentials())[0]?.signCount ?? 0;

    // Step-up: a ★ action (audit CSV) asks "Confirm it's you" once, then runs.
    await page.goto(`${ADMIN_URL}/super/audit`);
    const download = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Download CSV' }).click();
    const dialog = page.getByRole('dialog', { name: 'Confirm it’s you' });
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: 'Confirm' }).click();
    expect((await download).suggestedFilename()).toMatch(/\.csv$/);
    await expect(dialog).toBeHidden();
    expect((await credentials())[0]?.signCount ?? 0).toBeGreaterThan(afterLogin); // a real assertion was made

    // Log out again.
    await page.goto(`${ADMIN_URL}/account`);
    await page.getByRole('button', { name: 'Log out', exact: true }).last().click();
    await expect(page.getByRole('button', { name: 'Log in' })).toBeVisible();
    expect((await me(page)).status()).toBe(401);
  });
});
