import { expect, test } from '@mc/config/playwright';
import type { APIRequestContext, Page } from '@playwright/test';
import { devices } from '@playwright/test';

import { ADMIN_URL, APP_URL } from '../../playwright.config.ts';
import { followByCode, registerDevice } from '../support/device.ts';
import {
  CSRF,
  HOOKS,
  label,
  registerWithInvite,
  resetRateLimits,
  seedSuperAdminInvite,
  virtualAuthenticator,
} from './helpers.ts';

// PHASE_05 T5.2 — 10 §6 journey 9 part 2, the UPI change-lock (04 R1): the masjid admin asks for UPI details (B8), the
// Super Admin approves them in C4 (★ step-up), they go live only once the 24 h hold has passed; a follower's QR sheet
// shows them. Then a CHANGE: request → approve → at +23 h followers still see the old UPI ID → at +24 h the new one,
// with the "Payment details updated" notice and "Payment details changed on …" in the QR sheet. The hold runs on
// api-admin's settable clock: `POST /api/admin/test/payment-activate` is one run of the worker's `payment-activate` job
// as of that clock (the runtime-test stack pins the real 1440-minute hold, so the worker's own schedule never fires
// in between). Fake UPI IDs only (10 §5: the `okexample` handle).

const run = Date.now().toString(36); // the stack database outlives a run
const FIRST = { vpa: `first.${run}@okexample`, payee: 'Test Masjid Pay Committee' };
const SECOND = { vpa: `second.${run}@okexample`, payee: 'Test Masjid New Committee' };
const HOUR = 60 * 60 * 1000;
const offset = (jamaatOffsetMin: number) => ({
  adhanMode: 'auto',
  adhanAdjustMin: 0,
  jamaatMode: 'offset',
  jamaatOffsetMin,
});
/** A masjid goes public only with its timings (C2 activate). */
const TIMINGS = {
  prayers: { fajr: offset(20), dhuhr: offset(15), asr: offset(15), maghrib: offset(5), isha: offset(15) },
  jumuah: [{ seq: 1, jamaatTime: '13:30' }],
  notify: false,
};
const todayIst = () => new Date(Date.now() + 5.5 * HOUR).toISOString().slice(0, 10);

async function setAdminClock(request: APIRequestContext, body: { set: string } | { reset: true }) {
  const response = await request.put(`${ADMIN_URL}/api/admin/test/clock`, { headers: CSRF, data: body });
  expect(response.status()).toBe(200);
}

/** One `payment-activate` run as of `at` (api-admin's clock), then the clock goes back to real time. */
async function activateAt(request: APIRequestContext, at: Date) {
  await setAdminClock(request, { set: at.toISOString() });
  try {
    const response = await request.post(`${ADMIN_URL}/api/admin/test/payment-activate`, { headers: CSRF });
    expect(response.status()).toBe(200);
  } finally {
    await setAdminClock(request, { reset: true });
  }
}

/** B8: the admin types the UPI details and sends them for approval. */
async function requestUpi(admin: Page, details: { vpa: string; payee: string }, note: string) {
  await admin.goto(`${ADMIN_URL}/payment`);
  const form = admin.locator('[data-payment-form]');
  await expect(form.getByText('For safety, changes take 24 hours after approval.', { exact: false })).toBeVisible();
  await form.getByRole('textbox', { name: 'UPI ID' }).fill(details.vpa);
  await form.getByRole('textbox', { name: /^Payee name/ }).fill(details.payee);
  await form.getByRole('textbox', { name: /^Note for the Super Admin/ }).fill(note);
  await admin.getByRole('button', { name: 'Send for approval' }).click();
  await expect(admin.locator('p', { hasText: 'Sent. The Super Admin will check it.' })).toBeVisible();
}

/** C4: the Super Admin checks the committee and the name, approves (★ step-up when not fresh). */
async function approveUpi(superAdmin: Page, vpa: string) {
  await superAdmin.goto(`${ADMIN_URL}/super/payments`);
  const row = superAdmin.locator('[data-payment-row]').filter({ hasText: vpa });
  await expect(row).toBeVisible();
  await expect(row.getByText('Waiting for review')).toBeVisible();
  await row.getByRole('checkbox', { name: 'I phoned the committee and they confirmed this change' }).check();
  await row.getByRole('checkbox', { name: 'The payee name matches the masjid or committee account' }).check();
  await row.getByRole('button', { name: /^Approve/ }).click();
  const stepUp = superAdmin
    .getByRole('dialog', { name: label('en', 'super', 'stepUp.title') })
    .getByRole('button', { name: label('en', 'super', 'stepUp.confirm') });
  const approved = superAdmin.locator('p', { hasText: /^Approved — goes live / });
  await expect(stepUp.or(approved)).toBeVisible();
  if (await stepUp.isVisible()) await stepUp.click();
  await expect(approved).toBeVisible();
}

interface AdminPayment {
  active: { vpa: string; payeeName: string; effectiveAt: string } | null;
  request: { status: string; vpa: string; effectiveAt?: string } | null;
}
async function adminPayment(admin: Page, masjidId: string): Promise<AdminPayment> {
  const response = await admin.request.get(`${ADMIN_URL}/api/admin/masjids/${masjidId}/payment`);
  expect(response.status()).toBe(200);
  return (await response.json()) as AdminPayment;
}

test.describe('journey 9 part 2 — UPI change-lock (T5.2)', () => {
  test.skip(!HOOKS, 'needs the runtime-test stack: E2E_TEST_HOOKS=1 and `pnpm stack:up:test`');

  test('request → approve → live only after 24 h; a change shows followers the new UPI ID and a notice', async ({
    page,
    browser,
    browserName,
  }) => {
    test.skip(browserName !== 'chromium', 'the virtual authenticator is a Chromium DevTools feature');
    test.setTimeout(300_000);
    await resetRateLimits(page.request);

    // The Super Admin creates the masjid and its admin.
    await virtualAuthenticator(page);
    const token = await seedSuperAdminInvite(page.request, 'Test Owner', 'en');
    await registerWithInvite(page, `${ADMIN_URL}/invite#${token}`, 'Test Owner', 'en');
    const created = await page.request.post(`${ADMIN_URL}/api/super/masjids`, {
      headers: CSRF,
      data: {
        name: `Test Masjid Pay ${run}`,
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
      data: { displayName: 'Test Mutawalli', uiLocale: 'en', masjidId, role: 'owner' },
    });
    const { inviteUrl } = (await invited.json()) as { inviteUrl: string };

    const phone = await browser.newContext({ ...devices['Pixel 7'], ignoreHTTPSErrors: true });
    try {
      const admin = await phone.newPage();
      await virtualAuthenticator(admin);
      await registerWithInvite(admin, inviteUrl, 'Test Mutawalli', 'en');
      await admin.getByRole('checkbox', { name: 'I have read and I agree' }).check();
      await admin.getByRole('button', { name: 'Continue' }).click();
      await expect(admin.getByRole('button', { name: 'Donation Drive', exact: true })).toBeVisible();
      const timings = await admin.request.put(`${ADMIN_URL}/api/admin/masjids/${masjidId}/timings`, {
        headers: { ...CSRF, 'If-Match': '"0"' },
        data: TIMINGS,
      });
      expect(timings.status()).toBe(200);
      expect(
        (await page.request.post(`${ADMIN_URL}/api/super/masjids/${masjidId}/activate`, { headers: CSRF })).status(),
      ).toBe(204);

      // 1. First UPI details: requested, approved, live once the hold has passed.
      await requestUpi(admin, FIRST, 'Test: first setup');
      await admin.goto(`${ADMIN_URL}/payment`);
      await expect(admin.locator('[data-payment-waiting]')).toBeVisible(); // one open request at a time
      await approveUpi(page, FIRST.vpa);
      const first = await adminPayment(admin, masjidId);
      expect(first.active).toBeNull();
      expect(first.request).toMatchObject({ status: 'approved_on_hold', vpa: FIRST.vpa });
      const firstLive = new Date(first.request?.effectiveAt ?? '');
      expect(firstLive.getTime() - Date.now()).toBeGreaterThan(23 * HOUR); // the real 24 h hold
      await activateAt(page.request, new Date(firstLive.getTime() + 60_000));
      expect((await adminPayment(admin, masjidId)).active).toMatchObject({ vpa: FIRST.vpa, payeeName: FIRST.payee });

      // A donation drive, and a follower who opens its QR sheet.
      const drive = await admin.request.post(`${ADMIN_URL}/api/admin/masjids/${masjidId}/campaigns`, {
        headers: CSRF,
        data: {
          title: 'Test change-lock drive',
          purpose: 'repair',
          targetPaise: 10_000_000,
          startsOn: todayIst(),
          notify: false,
        },
      });
      expect(drive.status()).toBe(201);
      const { publicId } = ((await drive.json()) as { item: { publicId: string } }).item;
      const musalli = await page.context().newPage();
      await musalli.goto(APP_URL);
      await registerDevice(musalli);
      await followByCode(musalli, APP_URL, [followCode]);
      const openQr = async () => {
        await musalli.goto(`${APP_URL}/items/${publicId}`);
        await musalli
          .locator('section[data-screen]:not([inert])')
          .getByRole('button', { name: 'Show UPI QR Code' })
          .click();
        return musalli.getByRole('dialog', { name: 'Pay with UPI' });
      };
      let sheet = await openQr();
      await expect(sheet.locator('[data-vpa]')).toHaveText(FIRST.vpa);

      // 2. A change: requested and approved — followers still see the first details.
      await requestUpi(admin, SECOND, 'Test: new committee account');
      await approveUpi(page, SECOND.vpa);
      const second = await adminPayment(admin, masjidId);
      expect(second.request).toMatchObject({ status: 'approved_on_hold', vpa: SECOND.vpa });
      expect(second.active).toMatchObject({ vpa: FIRST.vpa });
      const secondLive = new Date(second.request?.effectiveAt ?? '');

      // +23 h: still the first details everywhere.
      await activateAt(page.request, new Date(secondLive.getTime() - HOUR));
      expect((await adminPayment(admin, masjidId)).active).toMatchObject({ vpa: FIRST.vpa });
      sheet = await openQr();
      await expect(sheet.locator('[data-vpa]')).toHaveText(FIRST.vpa);

      // +24 h: the new details are live; followers see them, told by the QR sheet and a locked notice.
      await activateAt(page.request, new Date(secondLive.getTime() + 60_000));
      expect((await adminPayment(admin, masjidId)).active).toMatchObject({
        vpa: SECOND.vpa,
        payeeName: SECOND.payee,
      });
      await expect(async () => {
        sheet = await openQr();
        await expect(sheet.locator('[data-vpa]')).toHaveText(SECOND.vpa, { timeout: 2000 });
      }).toPass({ timeout: 30_000 });
      await expect(sheet.getByText('Test Masjid New Committee', { exact: true })).toBeVisible();
      await expect(sheet.getByText(/^Payment details changed on /)).toBeVisible();
      await musalli.goto(`${APP_URL}/masjid/${masjidId}/announcements`);
      await expect(musalli.locator('section[data-screen]:not([inert])')).toContainText('Payment details updated');
    } finally {
      await setAdminClock(page.request, { reset: true });
      await phone.close();
    }
  });
});
