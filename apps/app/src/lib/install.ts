// "Install app" (07 A1 page 6, A15): Android Chromium fires `beforeinstallprompt` once, early — often before the
// onboarding page that offers installation is shown. It is captured at start (main.tsx) and kept here.
import { useSyncExternalStore } from 'react';

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  readonly userChoice: Promise<{ readonly outcome: 'accepted' | 'dismissed' }>;
}

const isInstallPrompt = (event: Event): event is BeforeInstallPromptEvent =>
  'prompt' in event && typeof event.prompt === 'function' && 'userChoice' in event;

let deferred: BeforeInstallPromptEvent | null = null;
const listeners = new Set<() => void>();
const notify = () => {
  for (const listener of listeners) listener();
};

/** Starts listening (call once, before the first render). */
export function captureInstallPrompt(target: Window = window): void {
  target.addEventListener('beforeinstallprompt', (event) => {
    if (!isInstallPrompt(event)) return;
    event.preventDefault();
    deferred = event;
    notify();
  });
  target.addEventListener('appinstalled', () => {
    deferred = null;
    notify();
  });
}

/** Shows the browser's install dialog. @returns whether the user accepted. */
export async function promptInstall(): Promise<boolean> {
  const event = deferred;
  if (!event) return false;
  await event.prompt();
  const { outcome } = await event.userChoice;
  deferred = null;
  notify();
  return outcome === 'accepted';
}

/** True while the browser offers installation (Android / desktop Chromium, app not installed). */
export function useCanInstall(): boolean {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    () => deferred !== null,
    () => false,
  );
}
