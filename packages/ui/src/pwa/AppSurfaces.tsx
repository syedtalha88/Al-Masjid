import { OfflineBanner, useOnlineStatus, useUpdateAvailableToast } from '../components/Feedback.tsx';
import { useServiceWorker } from './useServiceWorker.ts';

/**
 * App-wide system surfaces (07 A17): the offline banner and the persistent "update available" toast driven
 * by the service worker. Render once inside `<ToastProvider>`.
 */
export function AppSurfaces() {
  const online = useOnlineStatus();
  const { updateAvailable, applyUpdate } = useServiceWorker();
  useUpdateAvailableToast(updateAvailable, applyUpdate);
  return <OfflineBanner offline={!online} />;
}
