/**
 * iOS Safari in the browser (not the installed app) animates its own edge back-swipe before `popstate`
 * fires; running our pop animation afterwards would play the motion twice (08 §3, §3.2). In that case an
 * in-app-initiated back is still animated by us; anything else is applied instantly.
 * The installed (standalone) app has no native back swipe on iOS, so ours is used there — to be confirmed on
 * the owner's iPhone (PROGRESS F17, DECISIONS #44).
 */
export function isIOSSafariBrowser(
  nav:
    | { readonly userAgent: string; readonly maxTouchPoints: number; readonly standalone?: boolean }
    | undefined = typeof navigator === 'undefined' ? undefined : navigator,
): boolean {
  if (!nav) return false;
  const iOS = /iP(hone|od|ad)/.test(nav.userAgent) || (/Macintosh/.test(nav.userAgent) && nav.maxTouchPoints > 1);
  return iOS && nav.standalone !== true;
}
