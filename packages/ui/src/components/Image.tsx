import { thumbHashFromBase64, thumbHashToRgba } from '@mc/domain/thumbhash';
import { useLayoutEffect, useRef, useState } from 'react';

export type ImageRatio = '16/10' | '16/9' | '3/4' | '1/1';

const RATIO: Readonly<Record<ImageRatio, string>> = {
  '16/10': 'aspect-[16/10]',
  '16/9': 'aspect-video',
  '3/4': 'aspect-[3/4]',
  '1/1': 'aspect-square',
};

export interface ImageProps {
  readonly src: string;
  /** Required: describe the photo, or `''` when it is decorative (the card text says it all). */
  readonly alt: string;
  /** Base64 ThumbHash stored with the image key (06 §5) — drawn until the photo loads. */
  readonly thumbhash?: string;
  /** Reserved box (no layout shift): masjid hero 16:10, campaign 16:9, list thumbs 3:4. */
  readonly ratio?: ImageRatio;
  /** Radius class (default `rounded-lg`, 20 px). */
  readonly rounded?: string;
  /** Above the fold: load eagerly with high priority. */
  readonly priority?: boolean;
  readonly className?: string;
}

/** Paints a ThumbHash onto a small canvas (scaled up by CSS); invalid hashes leave the muted background. */
function paint(canvas: HTMLCanvasElement, base64: string) {
  try {
    const { w, h, rgba } = thumbHashToRgba(thumbHashFromBase64(base64));
    canvas.width = w;
    canvas.height = h;
    const context = canvas.getContext('2d');
    if (!context) return;
    const pixels = context.createImageData(w, h);
    pixels.data.set(rgba);
    context.putImageData(pixels, 0, 0);
  } catch {
    // A malformed hash only costs the placeholder; the photo still loads.
  }
}

/**
 * Image with a ThumbHash placeholder (06 §5, 08 §5.4): the box is reserved by aspect ratio, the blurred
 * placeholder shows at once, and the photo fades in over 250 ms when decoded (opacity only, no scale pop).
 * If the photo fails, the placeholder (or muted surface) stays. Lazy by default.
 */
export function Image({
  src,
  alt,
  thumbhash,
  ratio = '16/10',
  rounded = 'rounded-lg',
  priority = false,
  className,
}: ImageProps) {
  const canvas = useRef<HTMLCanvasElement>(null);
  // Per src, so a new photo fades in again.
  const [loadedSrc, setLoadedSrc] = useState<string | null>(null);
  const [failedSrc, setFailedSrc] = useState<string | null>(null);

  useLayoutEffect(() => {
    if (canvas.current && thumbhash) paint(canvas.current, thumbhash);
  }, [thumbhash]);

  return (
    <div className={`relative overflow-hidden bg-surface-muted ${RATIO[ratio]} ${rounded} ${className ?? ''}`}>
      {thumbhash ? <canvas ref={canvas} aria-hidden className="absolute inset-0 size-full" /> : null}
      {failedSrc === src ? null : (
        <img
          src={src}
          alt={alt}
          loading={priority ? 'eager' : 'lazy'}
          fetchPriority={priority ? 'high' : 'auto'}
          decoding="async"
          onLoad={() => {
            setLoadedSrc(src);
          }}
          onError={() => {
            setFailedSrc(src);
          }}
          className={`absolute inset-0 size-full object-cover transition-image ${loadedSrc === src ? 'opacity-100' : 'opacity-0'}`}
        />
      )}
    </div>
  );
}
