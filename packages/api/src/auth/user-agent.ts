/**
 * A coarse "Browser on OS" label for the admin's session list (02 §2 `ua_summary`: browser + OS only — never versions,
 * device models or the raw header, which can fingerprint).
 *
 * @returns e.g. `Chrome on Android`; `Browser on Unknown` when nothing is recognised.
 */
export function uaSummary(userAgent: string | undefined): string {
  const ua = userAgent ?? '';
  const os = /Android/i.test(ua)
    ? 'Android'
    : /iPhone|iPad|iPod/i.test(ua)
      ? 'iOS'
      : /Windows/i.test(ua)
        ? 'Windows'
        : /Mac OS X|Macintosh/i.test(ua)
          ? 'macOS'
          : /CrOS/i.test(ua)
            ? 'ChromeOS'
            : /Linux/i.test(ua)
              ? 'Linux'
              : 'Unknown';
  const browser = /SamsungBrowser/i.test(ua)
    ? 'Samsung Internet'
    : /Edg\//i.test(ua)
      ? 'Edge'
      : /OPR\/|Opera/i.test(ua)
        ? 'Opera'
        : /Firefox|FxiOS/i.test(ua)
          ? 'Firefox'
          : /Chrome|CriOS/i.test(ua)
            ? 'Chrome'
            : /Safari/i.test(ua)
              ? 'Safari'
              : 'Browser';
  return `${browser} on ${os}`;
}
