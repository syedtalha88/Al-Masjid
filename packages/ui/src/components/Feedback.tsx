import { useTranslation } from '@mc/i18n/react';
import { useEffect, useLayoutEffect, useRef, useSyncExternalStore } from 'react';

import { WifiOffIcon } from '../icons/glyphs.tsx';
import { useMotionPrefs } from '../motion/MotionProvider.tsx';
import { animateChannel, initLayer } from '../navigation/driver.ts';
import { useToast } from './Toast.tsx';

const subscribeOnline = (callback: () => void) => {
  window.addEventListener('online', callback);
  window.addEventListener('offline', callback);
  return () => {
    window.removeEventListener('online', callback);
    window.removeEventListener('offline', callback);
  };
};

/** `navigator.onLine`, live. Assumes online where the API is missing. */
export function useOnlineStatus(): boolean {
  return useSyncExternalStore(
    subscribeOnline,
    () => navigator.onLine,
    () => true,
  );
}

/**
 * Offline banner (06 §6, 08 §5.10): slides down from under the status bar while the device is offline (transform
 * only; reduced motion fades) and is announced once. Content stays usable from the cache underneath.
 */
export function OfflineBanner({ offline }: { readonly offline: boolean }) {
  const { t } = useTranslation();
  const { reduced } = useMotionPrefs();
  const node = useRef<HTMLDivElement>(null);
  const first = useRef(true);

  useLayoutEffect(() => {
    const start = first.current;
    first.current = false;
    if (start) {
      initLayer(node.current, offline ? { y: 0, opacity: 1 } : reduced ? { opacity: 0 } : { y: -110 });
      return;
    }
    if (reduced) void animateChannel(node.current, 'opacity', offline ? 1 : 0, 'fade');
    else void animateChannel(node.current, 'y', offline ? 0 : -110, 'smooth');
  }, [offline, reduced]);

  return (
    <div ref={node} aria-hidden={!offline} className="pointer-events-none fixed inset-x-0 top-0 z-40 pt-safe">
      <div className="mx-auto flex max-w-content items-center justify-center gap-2 bg-text px-screen py-2 type-footnote text-surface">
        <WifiOffIcon size={18} />
        <span role="status">{offline ? t('ui.offline') : ''}</span>
      </div>
    </div>
  );
}

/**
 * Shows the persistent "update available" toast (06 §6, 01 §5.6) once `available` turns true; its action
 * applies the update. Must be inside `<ToastProvider>`.
 */
export function useUpdateAvailableToast(available: boolean, onRefresh: () => void): void {
  const { t } = useTranslation();
  const toast = useToast();
  const refresh = useRef(onRefresh);
  useLayoutEffect(() => {
    refresh.current = onRefresh;
  });
  useEffect(() => {
    if (!available) return;
    const id = toast.show({
      message: t('ui.updateAvailable'),
      duration: null,
      action: {
        label: t('ui.refresh'),
        onPress: () => {
          refresh.current();
        },
      },
    });
    return () => {
      toast.dismiss(id);
    };
  }, [available, t, toast]);
}

/** Component form of {@link useUpdateAvailableToast} (renders nothing). */
export function UpdateAvailableToast({
  available,
  onRefresh,
}: {
  readonly available: boolean;
  readonly onRefresh: () => void;
}) {
  useUpdateAvailableToast(available, onRefresh);
  return null;
}
