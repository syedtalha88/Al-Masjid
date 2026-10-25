import { OfflineBanner, useOnlineStatus, useUpdateAvailableToast } from '../components/Feedback.tsx';
import { useServiceWorker } from './useServiceWorker.ts';

/**
 * App-wide system surfaces (07 A17): the offline banner and the persistent "update available" toast driven
 * by the service worker. Render once inside `<ToastProvider>`.
 *
 * @param unreachable - the app's own signal that requests get no answer although the browser reports a connection
 *   (01 §5.6 "or requests fail"); the banner shows for either.
 */
export function AppSurfaces({ unreachable = false }: { readonly unreachable?: boolean }) {
  const online = useOnlineStatus();
  const { updateAvailable, applyUpdate } = useServiceWorker();
  useUpdateAvailableToast(updateAvailable, applyUpdate);
  return <OfflineBanner offline={!online || unreachable} />;
}
