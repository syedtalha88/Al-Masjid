import { APP_URL } from '../playwright.config.ts';
import { writeScanFeed } from './support/scan-feed.ts';

/** Before any project starts: the fake camera video of the `scan` project (generated, never committed). */
export default async function globalSetup(): Promise<void> {
  await writeScanFeed(APP_URL);
}
