import { axeViolations, expect, test } from '@mc/config/playwright';
import { devices, type Page } from '@playwright/test';

import { ADMIN_URL, APP_URL } from '../../playwright.config.ts';
import { followByCode, registerDevice } from '../support/device.ts';
import {
  CSRF,
  HOOKS,
  registerWithInvite,
  resetRateLimits,
  seedSuperAdminInvite,
  virtualAuthenticator,
} from './helpers.ts';

// PHASE_05 T5.8 — needy people end to end: the admin (B19, from the Home tile) adds a person — Save stays off until the
// consent tick — with a private phone and note; a follower sees "Help the needy" on the masjid page, the person with
// "₹0 of ₹3,000", and "Pay with UPI" hands the phone EXACTLY the expected `upi://pay` link to the person (intercepted —
// a test browser has no UPI app), then the QR sheet. Nothing private is on the musalli's screen. The masjid updates
// what was received → the follower sees it one poll later; received ≥ the amount needed → "Fulfilled — hidden from the
// app" and the person, and the row, are gone after the next poll. Fake people and UPI IDs only (10 §5).

const run = Date.now().toString(36); // the stack database outlives a run
const MASJID = `Test Masjid Needy ${run}`;
const VPA = 'testperson9@okexample';
const PRIVATE_NOTE = 'Test private note';
const EXPECTED_LINK = `upi://pay?pa=${VPA}&pn=Test%20Person%20Nine&tn=${encodeURIComponent(MASJID)}&cu=INR`;
const offset = (jamaatOffsetMin: number) => ({
  adhanMode: 'auto',
  adhanAdjustMin: 0,
  jamaatMode: 'offset',
  jamaatOffsetMin,
});
const TIMINGS = {
  prayers: { fajr: offset(20), dhuhr: offset(15), asr: offset(15), maghrib: offset(5), isha: offset(15) },
  jumuah: [{ seq: 1, jamaatTime: '13:30' }],
  notify: false,
};

/** Records the `upi:` links the app opens, and stops the navigation (no UPI app in a test browser). */
async function interceptUpi(page: Page) {
  await page.addInitScript(() => {
    const opened: string[] = [];
    Reflect.set(window, '__upiOpened', opened);
    document.addEventListener(
      'click',
      (event) => {
        const link = event.target instanceof Element ? event.target.closest('a') : null;
        if (link?.href.startsWith('upi:')) {
          opened.push(link.getAttribute('href') ?? '');
          event.preventDefault();
        }
      },
      true,
    );
  });
}
const upiOpened = (page: Page) => page.evaluate(() => Reflect.get(window, '__upiOpened') as string[]);

test.describe('needy people (T5.8)', () => {
  test.skip(!HOOKS, 'needs the runtime-test stack: E2E_TEST_HOOKS=1 and `pnpm stack:up:test`');

  test('admin adds a person → musalli sees and pays them directly → received = needed → gone after the next poll', async ({
    page,
    browser,
    browserName,
    capture,
  }) => {
    test.skip(browserName !== 'chromium', 'the virtual authenticator is a Chromium DevTools feature');
    test.setTimeout(240_000);
    await resetRateLimits(page.request);

    await virtualAuthenticator(page);
    const token = await seedSuperAdminInvite(page.request, 'Test Owner', 'en');
    await registerWithInvite(page, `${ADMIN_URL}/invite#${token}`, 'Test Owner', 'en');
    const created = await page.request.post(`${ADMIN_URL}/api/super/masjids`, {
      headers: CSRF,
      data: {
        name: MASJID,
        area: 'Test Area',
        city: 'Hyderabad',
        state: 'Telangana',
        address: 'Test address 1',
        lat: 17.385,
        lng: 78.4867,
      },
    });
    expect(created.status()).toBe(201);
    const { id: masjidId, followCode } = (await created.json()) as { id: string; followCode: string };
    const invited = await page.request.post(`${ADMIN_URL}/api/super/admins`, {
      headers: CSRF,
      data: { displayName: 'Test Committee', uiLocale: 'en', masjidId, role: 'owner' },
    });
    const { inviteUrl } = (await invited.json()) as { inviteUrl: string };

    const phone = await browser.newContext({ ...devices['Pixel 7'], ignoreHTTPSErrors: true });
    try {
      const admin = await phone.newPage();
      await virtualAuthenticator(admin);
      await registerWithInvite(admin, inviteUrl, 'Test Committee', 'en');
      await admin.getByRole('checkbox', { name: 'I have read and I agree' }).check();
      await admin.getByRole('button', { name: 'Continue' }).click();
      const tile = admin.getByRole('button', { name: 'Help the Needy', exact: true });
      await expect(tile).toBeVisible();
      expect(
        (
          await admin.request.put(`${ADMIN_URL}/api/admin/masjids/${masjidId}/timings`, {
            headers: { ...CSRF, 'If-Match': '"0"' },
            data: TIMINGS,
          })
        ).status(),
      ).toBe(200);
      expect(
        (await page.request.post(`${ADMIN_URL}/api/super/masjids/${masjidId}/activate`, { headers: CSRF })).status(),
      ).toBe(204);

      // B19: nobody yet → Add person. Save is off until everything, and the consent tick, is there.
      await tile.click();
      await expect(admin).toHaveURL(`${ADMIN_URL}/needy`);
      const b19 = admin.locator('[data-needy]');
      await expect(b19.getByText('No one listed yet')).toBeVisible();
      await b19.getByRole('button', { name: 'Add person' }).click();
      const editor = admin.locator('[data-needy-editor]');
      await expect(editor.getByText('First name or initials only')).toBeVisible();
      await editor.getByRole('textbox', { name: /^Name shown in the app/ }).fill('Test N.');
      await editor.getByText('Widow', { exact: true }).click(); // radio cards are tapped by their text
      await editor.getByRole('textbox', { name: /^Why they need help/ }).fill('Test reason for help');
      await editor.getByRole('textbox', { name: /^UPI ID/ }).fill(VPA);
      await editor.getByRole('textbox', { name: /^Payee name/ }).fill('Test Person Nine');
      const cap = editor.getByRole('group', { name: 'Amount needed' });
      for (const key of ['3', '0', '0', '0']) await cap.getByRole('button', { name: key, exact: true }).click();
      await expect(cap.locator('output')).toHaveText('₹3,000');
      await editor.getByRole('switch', { name: /^Zakat can be given to this person/ }).click();
      await expect(editor.getByText('Only admins of this masjid see this.', { exact: false })).toBeVisible();
      await editor.getByRole('textbox', { name: /^Phone number/ }).fill('+91 00000 00005');
      await editor.getByRole('textbox', { name: /^Private note/ }).fill(PRIVATE_NOTE);
      const save = admin.getByRole('button', { name: 'Save', exact: true });
      await expect(save).toBeDisabled();
      await expect(editor.locator('[data-needy-missing]')).toContainText('the tick that they agreed');
      await editor.getByRole('checkbox', { name: /agreed to be listed with these details/ }).check();
      expect(await axeViolations(admin)).toEqual([]);
      await capture('b19-needy-editor', { target: editor });
      await expect(save).toBeEnabled();
      await save.click();
      await expect(admin.locator('p', { hasText: /^Person saved$/ })).toBeVisible();
      const cards = b19.locator('[data-person]');
      await expect(cards).toHaveCount(1);
      await expect(cards.first()).toContainText('Test N.');
      await expect(cards.first()).toContainText('₹0 of ₹3,000');
      // The list never carries the private part.
      expect(await b19.textContent()).not.toContain(PRIVATE_NOTE);
      expect(await axeViolations(admin)).toEqual([]);
      await capture('b19-needy', { target: b19 });

      // Edit: the private details come only on request (an audited view).
      await cards.first().getByRole('button', { name: 'Edit details' }).click();
      await expect(editor.getByRole('textbox', { name: /^Private note/ })).toHaveCount(0);
      await editor.getByRole('button', { name: 'Show private details' }).click();
      await expect(editor.getByRole('textbox', { name: /^Private note/ })).toHaveValue(PRIVATE_NOTE);
      await admin.goBack();
      await expect(cards).toHaveCount(1);

      // A follower: the row, the person, nothing private; Pay with UPI goes straight to the person.
      const musalli = await page.context().newPage();
      await interceptUpi(musalli);
      await musalli.clock.install();
      await musalli.goto(APP_URL);
      await registerDevice(musalli);
      await followByCode(musalli, APP_URL, [followCode]);
      const top = musalli.locator('section[data-screen]:not([inert])');
      await musalli.goto(`${APP_URL}/masjid/${masjidId}`);
      await expect(top.getByRole('heading', { level: 1, name: MASJID })).toBeVisible({ timeout: 15_000 });
      await top.getByRole('button', { name: /Help the needy/ }).click();
      const list = musalli.locator('[data-needy-list]');
      await expect(list.locator('[data-needy-intro]')).toHaveText(
        `Verified by ${MASJID}. Payments go directly to the person.`,
      );
      const person = list.locator('[data-person]');
      await expect(person).toHaveCount(1);
      await expect(person).toContainText('Test N.');
      await expect(person).toContainText('Widow');
      await expect(person).toContainText('Zakat-eligible');
      await expect(person).toContainText('₹0 of ₹3,000');
      await expect(list.locator('[data-disclaimer]')).toContainText('does not receive or handle any money');
      expect(await list.textContent()).not.toMatch(/0000000005|Test private note/);
      await list.getByRole('radio', { name: 'Zakat-eligible' }).click();
      await expect(person).toHaveCount(1);
      expect(await axeViolations(musalli)).toEqual([]);
      await capture('a23-needy', { target: top });

      await person.click();
      const sheet = musalli.getByRole('dialog', { name: 'Help Test N.' });
      await expect(sheet).toBeVisible();
      await expect(sheet.getByText('Test Person Nine', { exact: true })).toBeVisible();
      await expect(sheet.locator('[data-vpa]')).toHaveText(VPA);
      await expect(sheet.getByText('Amount received is reported by the masjid.')).toBeVisible();
      await expect(sheet.getByText('Still needed: ₹3,000')).toBeVisible();
      await musalli.waitForTimeout(600); // the sheet settles before axe reads colours
      expect(await axeViolations(musalli)).toEqual([]);
      await capture('a23-needy-sheet', { target: sheet });
      await sheet.getByRole('button', { name: 'Pay with UPI' }).click();
      expect(await upiOpened(musalli)).toEqual([EXPECTED_LINK]);
      // Nothing took the link: the QR sheet opens by itself, for the person.
      const qr = musalli.getByRole('dialog', { name: 'Pay with UPI' });
      await expect(qr).toBeVisible({ timeout: 5000 });
      await expect(qr.getByRole('img', { name: 'UPI QR code for Test Person Nine' })).toBeVisible();
      await expect(qr.locator('[data-vpa]')).toHaveText(VPA);
      await musalli.keyboard.press('Escape');
      await expect(qr).toBeHidden();

      // The masjid reports ₹1,200: the follower sees it one poll (60 s) later.
      const received = admin.getByRole('dialog', { name: 'Received so far' });
      await cards.first().getByRole('button', { name: 'Update received' }).click();
      const pad = received.getByRole('group', { name: 'Received so far' });
      for (const key of ['1', '2', '0', '0']) await pad.getByRole('button', { name: key, exact: true }).click();
      await expect(received.getByText('40%').first()).toBeVisible();
      await received.getByRole('button', { name: 'Save', exact: true }).click();
      await expect(admin.locator('p', { hasText: /^Amount saved$/ })).toBeVisible();
      await expect(cards.first()).toContainText('₹1,200 of ₹3,000');
      await musalli.clock.fastForward('01:05');
      await expect(person).toContainText('₹1,200 of ₹3,000');

      // Received ≥ needed: fulfilled, under its own chip for the admin, gone for the follower after the next poll.
      await cards.first().getByRole('button', { name: 'Update received' }).click();
      await pad.getByRole('button', { name: '0', exact: true }).click(); // ₹12,000
      await expect(received.locator('[data-will-fulfil]')).toHaveText('Fulfilled — hidden from the app');
      await received.getByRole('button', { name: 'Save', exact: true }).click();
      await expect(admin.locator('p', { hasText: /^Fulfilled — hidden from the app$/ }).first()).toBeVisible();
      await expect(cards).toHaveCount(0);
      await b19.getByRole('radio', { name: 'Fulfilled' }).click();
      await expect(cards).toHaveCount(1);
      await expect(cards.first()).toHaveAttribute('data-person-status', 'fulfilled');
      await expect(cards.first().getByRole('button', { name: 'Edit details' })).toHaveCount(0);

      await musalli.clock.fastForward('01:05');
      await expect(list.getByText('No one is listed right now')).toBeVisible();
      await expect(person).toHaveCount(0);
      await musalli.goto(`${APP_URL}/masjid/${masjidId}`);
      await expect(top.getByRole('heading', { level: 1, name: MASJID })).toBeVisible({ timeout: 15_000 });
      await musalli.waitForLoadState('networkidle');
      await expect(top.getByRole('button', { name: /Help the needy/ })).toHaveCount(0);

      // Remove (a mistake, or the person asked): confirmed, and the person leaves every chip.
      await cards.first().getByRole('button', { name: 'Remove', exact: true }).click();
      const confirm = admin.getByRole('alertdialog', { name: 'Remove this person?' });
      await confirm.getByRole('button', { name: 'Remove', exact: true }).click();
      await expect(admin.locator('p', { hasText: /^Removed$/ })).toBeVisible();
      await expect(cards).toHaveCount(0);
    } finally {
      await phone.close();
    }
  });
});
