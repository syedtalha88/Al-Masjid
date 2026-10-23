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
