import { expect, test } from '@mc/config/playwright';
import { devices } from '@playwright/test';

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

// PHASE_03 T3.13 — B14 + A18: an admin attaches a voice note to a notice ("Choose audio file", after the ownership tick
// — the browser measures it, the server stores it), publishes, and a musalli plays it from the notice's detail screen
// (the media site's /a/m4a/<key> route, through the app's worker). Needs the runtime-test stack. Fake texts only.

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
const TITLE = 'Test voice notice';

/** Two seconds of a 440 Hz tone as a 16-bit mono WAV (8 kHz) — any browser decodes and plays it. */
function toneWav(seconds = 2, rate = 8000): Buffer {
  const samples = seconds * rate;
  const data = Buffer.alloc(samples * 2);
  for (let index = 0; index < samples; index += 1) {
    data.writeInt16LE(Math.round(Math.sin((2 * Math.PI * 440 * index) / rate) * 12_000), index * 2);
  }
  const header = Buffer.alloc(44);
  header.write('RIFF', 0, 'latin1');
  header.writeUInt32LE(36 + data.length, 4);
  header.write('WAVE', 8, 'latin1');
  header.write('fmt ', 12, 'latin1');
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(1, 22); // mono
  header.writeUInt32LE(rate, 24);
  header.writeUInt32LE(rate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36, 'latin1');
  header.writeUInt32LE(data.length, 40);
  return Buffer.concat([header, data]);
}

test.describe('B14 voice notes (T3.13)', () => {
  test.skip(!HOOKS, 'needs the runtime-test stack: E2E_TEST_HOOKS=1 and `pnpm stack:up:test`');

  test('a notice with a voice note → the musalli plays it', async ({ page, browser, browserName }) => {
    test.skip(browserName !== 'chromium', 'the virtual authenticator is a Chromium DevTools feature');
    test.setTimeout(180_000);
    await resetRateLimits(page.request);

    await virtualAuthenticator(page);
    const token = await seedSuperAdminInvite(page.request, 'Test Owner', 'en');
    await registerWithInvite(page, `${ADMIN_URL}/invite#${token}`, 'Test Owner', 'en');
    const created = await page.request.post(`${ADMIN_URL}/api/super/masjids`, {
      headers: CSRF,
      data: {
        name: `Test Masjid Voice ${Date.now().toString(36)}`, // the stack database outlives a run
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
      data: { displayName: 'Test Imam', uiLocale: 'en', masjidId, role: 'owner' },
    });
    const { inviteUrl } = (await invited.json()) as { inviteUrl: string };

    const phone = await browser.newContext({ ...devices['Pixel 7'], ignoreHTTPSErrors: true });
    try {
      const admin = await phone.newPage();
      await virtualAuthenticator(admin);
      await registerWithInvite(admin, inviteUrl, 'Test Imam', 'en');
      await admin.getByRole('checkbox', { name: 'I have read and I agree' }).check();
      await admin.getByRole('button', { name: 'Continue' }).click();
      const tile = admin.getByRole('button', { name: 'Notice', exact: true });
      await expect(tile).toBeVisible();
      const timings = await admin.request.put(`${ADMIN_URL}/api/admin/masjids/${masjidId}/timings`, {
        headers: { ...CSRF, 'If-Match': '"0"' },
        data: TIMINGS,
      });
      expect(timings.status()).toBe(200);
      expect(
        (await page.request.post(`${ADMIN_URL}/api/super/masjids/${masjidId}/activate`, { headers: CSRF })).status(),
      ).toBe(204);
      const top = admin.locator('section[data-screen]:not([inert])');

      // Own text + a voice note from a file (the picker opens only after the ownership tick).
      await tile.click();
      await admin.getByRole('button', { name: 'Write your own' }).click();
      const title = top.getByRole('textbox', { name: 'Title' });
      await title.click();
      await title.fill(TITLE);
      await top.getByRole('textbox', { name: 'Message' }).fill('Test body');
      const voice = top.locator('[data-voice-field]');
      const chooseFile = voice.getByRole('button', { name: 'Choose audio file' });
      await expect(chooseFile).toBeDisabled();
      await voice.getByText('This masjid recorded this or may share it').click();
      const chooser = admin.waitForEvent('filechooser');
      await chooseFile.click();
      await (await chooser).setFiles({ name: 'voice.wav', mimeType: 'audio/wav', buffer: toneWav() });
      await expect(voice.getByRole('button', { name: 'Remove voice note' })).toBeVisible();
      await expect(voice.locator('[data-voice-note]')).toBeVisible();
      await admin.getByRole('button', { name: 'Next: Preview' }).click();
      await admin.getByRole('switch', { name: 'Notify followers' }).click();
      await admin.getByRole('button', { name: 'Publish', exact: true }).click();
      await expect(admin.getByRole('heading', { name: 'Published' })).toBeVisible();
    } finally {
      await phone.close();
    }

    // The musalli opens the notice and plays the voice note.
    const musalli = await page.context().newPage();
    await musalli.goto(APP_URL);
    await registerDevice(musalli);
    await followByCode(musalli, APP_URL, [followCode]);
    await musalli.goto(`${APP_URL}/masjid/${masjidId}/announcements`);
    // The list card cannot hold a player: it says there is one (F54).
    await expect(musalli.getByRole('button', { name: TITLE })).toContainText('Voice message · 0:02');
    await musalli.getByRole('button', { name: TITLE }).click();
    const note = musalli.locator('[data-voice-note]');
    await expect(note).toBeVisible();
    await expect(note).toHaveAttribute('aria-label', /^Voice message, 2 seconds$/);
    await note.getByRole('button', { name: 'Play', exact: true }).click();
    await expect(note.getByRole('button', { name: /^(Pause|Play)$/ })).toBeVisible();
    await expect(note.getByText('Available when online')).toHaveCount(0);
  });
});
