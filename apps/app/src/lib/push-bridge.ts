// The page side of notifications (PHASE_04 T4.2 / T4.3): a tapped notification while the app is open (the worker
// focuses it and says where to go) opens that item; a push that arrives refreshes the versions, so the item is there
// when the person looks; the app badge follows the Updates count; and after start, while idle, the subscription is
// checked (re-subscribing when the browser or the push service replaced it). The push module loads only then.
import type { NavigatorApi } from '@mc/ui/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';

import { queryKeys } from './api/keys.ts';
import { useAppData } from './data.tsx';
import { isStandalone, platformKind } from './platform.ts';
import { pushMessageOf } from './sw-protocol.ts';

const IDLE_CHECK_MS = 4000;

/** Mounted once, inside the navigator (it needs its api). */
export function usePushBridge(api: NavigatorApi, unseen: number): void {
  const queryClient = useQueryClient();
  const { store, api: client } = useAppData();

  // Worker messages: open the tapped item; refresh the masjid versions on any push.
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;
    const onMessage = (event: MessageEvent) => {
      const message = pushMessageOf(event.data);
      if (!message) return;
      void queryClient.invalidateQueries({ queryKey: queryKeys.allVersions() });
      if (message.type !== 'PUSH_OPEN') return;
      if (message.url === '/updates') api.selectTab('updates');
      else api.push(message.url);
    };
    navigator.serviceWorker.addEventListener('message', onMessage);
    return () => {
      navigator.serviceWorker.removeEventListener('message', onMessage);
    };
  }, [api, queryClient]);

  // The app icon's badge = unseen updates (cleared once Updates was opened).
  useEffect(() => {
    if (!('setAppBadge' in navigator)) return;
    const done = unseen > 0 ? navigator.setAppBadge(unseen) : navigator.clearAppBadge();
    done.catch(() => undefined);
  }, [unseen]);

  // The subscription check, once per start, after the first screen settled.
  useEffect(() => {
    if (!store.current().push?.wanted) return;
    const timer = setTimeout(() => {
      void import('./push.ts')
        .then((push) => push.reconcilePush(push.browserPushPlatform(platformKind(), isStandalone()), client, store))
        .catch(() => undefined); // offline / server down: the next start tries again
    }, IDLE_CHECK_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [client, store]);
}
