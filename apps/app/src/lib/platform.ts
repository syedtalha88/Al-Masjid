// Platform detection (01 §3 `lib/platform`): the coarse kind stored on the device record (02 §2 `platform` — no user
// agent string is ever sent), and whether the app runs installed (standalone). Pure functions over a navigator-like
// object so they are testable.

export type PlatformKind = 'android' | 'ios' | 'desktop' | 'other';

interface NavigatorLike {
  readonly userAgent: string;
  readonly maxTouchPoints: number;
  readonly standalone?: boolean;
}

/** android / ios (incl. iPadOS, which reports "Macintosh" with touch) / desktop / other. */
export function platformKind(
  nav: NavigatorLike | undefined = typeof navigator === 'undefined' ? undefined : navigator,
): PlatformKind {
  if (!nav) return 'other';
  if (/Android/i.test(nav.userAgent)) return 'android';
  if (/iP(hone|od|ad)/.test(nav.userAgent) || (/Macintosh/.test(nav.userAgent) && nav.maxTouchPoints > 1)) return 'ios';
  if (/Windows|Macintosh|Linux|CrOS/.test(nav.userAgent)) return 'desktop';
  return 'other';
}

/** True inside the installed app (display-mode standalone; iOS also sets `navigator.standalone`). */
export function isStandalone(
  win:
    { matchMedia?: (query: string) => { matches: boolean }; navigator?: NavigatorLike } | undefined = typeof window ===
  'undefined'
    ? undefined
    : window,
): boolean {
  if (!win) return false;
  return win.matchMedia?.('(display-mode: standalone)').matches === true || win.navigator?.standalone === true;
}

/**
 * The notification prompt can still be offered here (PHASE_04 T4.2): push exists, the browser was never answered, and
 * this is not an iPhone browser tab (iOS offers push only inside the installed app — 00 §4.4).
 */
export function pushPromptPossible(): boolean {
  return (
    typeof window !== 'undefined' &&
    'Notification' in window &&
    'PushManager' in window &&
    Notification.permission === 'default' &&
    (platformKind() !== 'ios' || isStandalone())
  );
}
