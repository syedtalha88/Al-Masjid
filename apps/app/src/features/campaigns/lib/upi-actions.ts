// A10 browser actions (07 A10, 08 §5.7): Donate Now hands the `upi://pay` link to the phone (the UPI app chooser) and
// falls back to the QR sheet when nothing took it; Save QR puts the QR picture in the gallery (iOS: the share sheet's
// "Save Image"; elsewhere a download). Nothing here talks to our servers.

/** 07 A10: no UPI app took the link if the page is still in front this long after the tap. */
export const UPI_FALLBACK_MS = 1500;

interface UpiEnvironment {
  readonly document: Document;
  readonly window: Window;
}

const browser = (): UpiEnvironment => ({ document, window });

/**
 * Opens `uri` (a `upi://pay?…` link from `@mc/domain/upi`) the way a link tap would: a temporary `<a>` clicked inside
 * the user's tap, so Android shows its UPI app chooser. If the page has not been hidden or lost focus within
 * {@link UPI_FALLBACK_MS} (desktop, a phone without a UPI app), `onNoApp` runs once.
 *
 * @returns a cancel function (the screen unmounted): no `onNoApp` after it.
 */
export function openUpiLink(uri: string, onNoApp: () => void, env: UpiEnvironment = browser()): () => void {
  const { document: doc, window: win } = env;
  let left = false;
  const onVisibility = () => {
    if (doc.visibilityState === 'hidden') left = true;
  };
  const onLeave = () => {
    left = true;
  };
  const stop = () => {
    win.clearTimeout(timer);
    doc.removeEventListener('visibilitychange', onVisibility);
    win.removeEventListener('pagehide', onLeave);
    win.removeEventListener('blur', onLeave);
  };
  doc.addEventListener('visibilitychange', onVisibility);
  win.addEventListener('pagehide', onLeave);
  win.addEventListener('blur', onLeave);
  const timer = win.setTimeout(() => {
    stop();
    if (!left) onNoApp();
  }, UPI_FALLBACK_MS);

  const link = doc.createElement('a');
  link.href = uri;
  link.rel = 'noopener';
  doc.body.append(link);
  link.click();
  link.remove();
  return stop;
}

/**
 * Tells when the person is back from their UPI app: `onReturn` runs once, the first time the page is in front again
 * after having been hidden (07 A23 "after returning from the UPI app"). A page that never leaves never calls it. What
 * happened in the UPI app is unknown to us — the caller can only ask.
 *
 * @returns a cancel function (no UPI app took the link, or the screen went away): no `onReturn` after it.
 */
export function onReturnFromUpi(onReturn: () => void, env: UpiEnvironment = browser()): () => void {
  const { document: doc } = env;
  let left = false;
  const stop = () => {
    doc.removeEventListener('visibilitychange', onVisibility);
  };
  function onVisibility() {
    if (doc.visibilityState === 'hidden') {
      left = true;
    } else if (left) {
      stop();
      onReturn();
    }
  }
  doc.addEventListener('visibilitychange', onVisibility);
  return stop;
}

export type SaveResult = 'saved' | 'shared' | 'cancelled' | 'failed';

interface SaveEnvironment {
  /** Older browsers have `share` without `canShare`, or neither. */
  readonly navigator: Partial<Pick<Navigator, 'share' | 'canShare'>> | undefined;
  readonly document: Document;
}

/**
 * Saves the QR picture: on iOS through the share sheet (Safari has no download to Photos — "Save Image" is there);
 * elsewhere as a PNG download (Android puts it in Downloads, where the UPI apps' "Scan from gallery" finds it).
 *
 * @returns what happened; `cancelled` when the person closed the share sheet.
 */
export async function saveQrImage(
  png: Blob,
  filename: string,
  ios: boolean,
  env: SaveEnvironment = { navigator: typeof navigator === 'undefined' ? undefined : navigator, document },
): Promise<SaveResult> {
  const file = new File([png], filename, { type: 'image/png' });
  const nav = env.navigator;
  if (ios && nav?.share && nav.canShare?.({ files: [file] })) {
    try {
      await nav.share({ files: [file] });
      return 'shared';
    } catch (error) {
      return error instanceof DOMException && error.name === 'AbortError' ? 'cancelled' : 'failed';
    }
  }
  try {
    const url = URL.createObjectURL(file);
    const link = env.document.createElement('a');
    link.href = url;
    link.download = filename;
    link.rel = 'noopener';
    env.document.body.append(link);
    link.click();
    link.remove();
    // Revoked after the browser has started the download.
    setTimeout(() => {
      URL.revokeObjectURL(url);
    }, 0);
    return 'saved';
  } catch {
    return 'failed';
  }
}

/** "upi-qr-<payee>.png" — ASCII only, so every gallery and file system keeps the name. */
export function qrFilename(vpa: string): string {
  const user = vpa.split('@')[0] ?? '';
  const safe = user.replace(/[^a-zA-Z0-9._-]/g, '').slice(0, 40);
  return `upi-qr-${safe === '' ? 'masjid' : safe}.png`;
}
