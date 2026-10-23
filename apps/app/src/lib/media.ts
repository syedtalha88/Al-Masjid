// Image URLs on the media origin (01 §5.4, DECISIONS #40): `media.<domain>/i/<480|960|1440>/<avif|webp>/<key>` — the
// only sizes and formats Cloudinary's strict transformations allow. Keys come from the API; each path segment is
// encoded so a key can never change the path.

export type MediaWidth = 480 | 960 | 1440;

/** The media origin (`VITE_PUBLIC_MEDIA_ORIGIN`, validated at build); `null` when not configured (some tests). */
function mediaOrigin(): string | null {
  const value: unknown = import.meta.env['VITE_PUBLIC_MEDIA_ORIGIN'];
  return typeof value === 'string' && value.length > 0 ? value : null;
}

/**
 * URL of a stored image at one of the allowed widths (WebP: decoded by every supported browser).
 *
 * @returns the URL, or `null` without a media origin (callers then show the ThumbHash only).
 */
export function mediaUrl(key: string, width: MediaWidth, origin: string | null = mediaOrigin()): string | null {
  if (origin === null) return null;
  // Dot segments are encoded too: URL parsing would otherwise resolve `..` out of `/i/<w>/webp/`.
  const path = key
    .split('/')
    .map((segment) => (/^\.+$/.test(segment) ? segment.replace(/\./g, '%2E') : encodeURIComponent(segment)))
    .join('/');
  return `${origin.replace(/\/$/, '')}/i/${String(width)}/webp/${path}`;
}
