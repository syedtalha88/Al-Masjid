// Links that open the installed app (PHASE_02 T2.13, 01 §5.6): on Android the WebAPK captures links to this origin
// (a follow link `/m/<code>` tapped in WhatsApp), and the manifest's `launch_handler: focus-existing` brings an
// already-open app to the front — without navigating. The Launch Handler API hands the link to the page instead
// (`window.launchQueue`, Chromium); this module turns it into a navigator action. Shortcuts (Updates, Qibla) arrive
// the same way.
import type { NavConfig, NavigatorApi } from '@mc/ui/navigation';
import { useEffect } from 'react';

export type LaunchAction =
  | { readonly kind: 'tab'; readonly tab: string }
  | { readonly kind: 'modal'; readonly href: string }
  | { readonly kind: 'push'; readonly href: string };

/**
 * What a launch URL should do in the open app: a tab root switches tab, a modal path presents the modal, anything
 * else is pushed onto the active tab.
 *
 * @returns `null` for another origin, or the URL the document itself was opened with (a cold start already shows it).
 */
export function launchAction(
  target: string,
  context: { readonly origin: string; readonly initialUrl: string | undefined; readonly config: NavConfig },
): LaunchAction | null {
  let url: URL;
  try {
    url = new URL(target);
  } catch {
    return null;
  }
  if (url.origin !== context.origin || url.href === context.initialUrl) return null;
  const tab = context.config.tabs.find((entry) => entry.path === url.pathname);
  if (tab) return { kind: 'tab', tab: tab.id };
  const href = `${url.pathname}${url.search}${url.hash}`;
  if (context.config.modalPaths.includes(url.pathname)) return { kind: 'modal', href };
  return { kind: 'push', href };
}

/** The Launch Handler API (Chromium) — not in TypeScript's DOM library. */
interface LaunchQueue {
  setConsumer(consumer: (params: { readonly targetURL?: string }) => void): void;
}
const launchQueueOf = (win: Window): LaunchQueue | undefined => {
  const queue: unknown = Reflect.get(win, 'launchQueue');
  return typeof queue === 'object' &&
    queue !== null &&
    'setConsumer' in queue &&
    typeof queue.setConsumer === 'function'
    ? (queue as LaunchQueue) // checked just above: an object with a `setConsumer` function
    : undefined;
};

/** The URL this document was loaded with (before the router changed it). */
const documentUrl = (): string | undefined => {
  const entry = performance.getEntriesByType('navigation')[0];
  return entry?.name;
};

/** The first launch is the one that loaded the document (it repeats the document's URL); later ones are new links. */
let firstLaunch = true;

/** Sends links that launch the already-open app to the navigator (no-op where the API is missing). */
export function useLaunchLinks(api: NavigatorApi, config: NavConfig): void {
  useEffect(() => {
    // Only the latest consumer receives launches; the navigator api changes identity with the active tab.
    launchQueueOf(window)?.setConsumer(({ targetURL }) => {
      if (!targetURL) return;
      const initialUrl = firstLaunch ? documentUrl() : undefined;
      firstLaunch = false;
      const action = launchAction(targetURL, { origin: location.origin, initialUrl, config });
      if (action?.kind === 'tab') api.selectTab(action.tab);
      else if (action?.kind === 'modal') api.presentModal(action.href);
      else if (action) api.push(action.href);
    });
  }, [api, config]);
}
