import type { Page } from '@playwright/test';

/** The device document the musalli app keeps in IndexedDB (`mc-device` / `kv` / `device`). */
export async function storedDevice(page: Page): Promise<Record<string, unknown> | undefined> {
  return page.evaluate(
    () =>
      new Promise<Record<string, unknown> | undefined>((resolve) => {
        const open = indexedDB.open('mc-device');
        open.onsuccess = () => {
          const get = open.result.transaction('kv').objectStore('kv').get('device');
          get.onsuccess = () => {
            resolve(get.result as Record<string, unknown> | undefined);
          };
        };
      }),
  );
}

/** Masjid ids followed on this device (pending unfollows excluded). */
export async function followedIds(page: Page): Promise<string[]> {
  const follows = (await storedDevice(page))?.['follows'];
  if (!Array.isArray(follows)) return [];
  return follows
    .filter((follow: { sync?: string }) => follow.sync !== 'unfollow')
    .map((follow: { masjidId: string }) => follow.masjidId);
}

/**
 * Follows seeded masjids on this device by follow code (resolved through the public API), then reloads — the app reads
 * the device document on start. The follows stay queued (`sync: 'follow'`) when the device is not registered.
 */
export async function followByCode(page: Page, appUrl: string, codes: readonly string[]): Promise<string[]> {
  const ids: string[] = [];
  for (const code of codes) {
    const response = await page.request.get(`${appUrl}/api/v1/masjids/resolve/${code}`);
    const body = (await response.json()) as { masjid: { id: string } };
    ids.push(body.masjid.id);
  }
  await page.evaluate(
    (masjidIds) =>
      new Promise<void>((resolve, reject) => {
        const open = indexedDB.open('mc-device');
        open.onsuccess = () => {
          const store = open.result.transaction('kv', 'readwrite').objectStore('kv');
          const get = store.get('device');
          get.onsuccess = () => {
            const device = get.result as { follows: unknown[] };
            device.follows = masjidIds.map((masjidId, index) => ({
              masjidId,
              followedAt: new Date(Date.UTC(2026, 0, 1, 0, index)).toISOString(),
              muted: false,
              sync: 'follow',
            }));
            const put = store.put(device, 'device');
            put.onsuccess = () => {
              resolve();
            };
            put.onerror = () => {
              reject(new Error('could not store follows'));
            };
          };
        };
      }),
    ids,
  );
  await page.reload();
  return ids;
}

/**
 * Registers this device through the app's own origin (Cloudflare's test Turnstile key locally — DECISIONS #93) and
 * stores the credentials in the device document, so follow changes reach the server. Call before `followByCode`.
 */
export async function registerDevice(page: Page): Promise<string> {
  return page.evaluate(async () => {
    const response = await fetch('/api/v1/devices', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        locale: 'en',
        audiencePref: 'brothers',
        platform: 'android',
        privacyVersion: 'draft-1',
        turnstileToken: 'XXXX.DUMMY.TOKEN.XXXX',
      }),
    });
    const credentials = (await response.json()) as { deviceId: string; secret: string };
    await new Promise<void>((resolve, reject) => {
      const open = indexedDB.open('mc-device');
      open.onsuccess = () => {
        const store = open.result.transaction('kv', 'readwrite').objectStore('kv');
        const get = store.get('device');
        get.onsuccess = () => {
          const device = get.result as Record<string, unknown>;
          const put = store.put(
            { ...device, credentials, privacyVersion: 'draft-1', registrationPending: false },
            'device',
          );
          put.onsuccess = () => {
            resolve();
          };
          put.onerror = () => {
            reject(new Error('could not store credentials'));
          };
        };
      };
    });
    return credentials.deviceId;
  });
}
