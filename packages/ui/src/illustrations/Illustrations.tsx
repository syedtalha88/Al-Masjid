import type { ReactNode } from 'react';

export interface IllustrationProps {
  /** Rendered width in px (height follows the 4:3 artwork). Default 160. */
  readonly width?: number;
  readonly className?: string;
}

/**
 * Flat line illustrations in primary/mint (06 §5), authored by us, < 4 KB each. Decorative: the empty state
 * or card around them carries the text, so they are hidden from assistive tech.
 */
function Frame({ width = 160, className, children }: IllustrationProps & { readonly children: ReactNode }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 160 120"
      width={width}
      height={(width * 3) / 4}
      fill="none"
      strokeWidth={3}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`stroke-primary-700 ${className ?? ''}`}
      aria-hidden
      focusable={false}
    >
      <circle cx="80" cy="60" r="54" className="fill-mint-50 stroke-none" />
      {children}
    </svg>
  );
}

/** Masjid: Jumu'ah card, "no masjids yet", onboarding. */
export function MosqueIllustration(props: IllustrationProps) {
  return (
    <Frame {...props}>
      <path d="M18 100h124" />
      <rect x="48" y="64" width="64" height="36" rx="2" className="fill-surface" />
      <path d="M54 64c0-18 14-26 26-34 12 8 26 16 26 34Z" className="fill-mint-100" />
      <path d="M80 30V21" />
      <circle cx="80" cy="17" r="3" className="fill-mint-100" />
      <path d="M72 100V86a8 8 0 0 1 16 0v14" className="fill-mint-100" />
      <path d="M58 82v-6a4 4 0 0 1 8 0v6M94 82v-6a4 4 0 0 1 8 0v6" />
      <path d="M36 100V54M124 100V54" />
      <path d="M31 54h10l-5-12ZM119 54h10l-5-12Z" className="fill-mint-100" />
    </Frame>
  );
}

/** QR poster: "scan the poster at your masjid" empty state. */
export function QrPosterIllustration(props: IllustrationProps) {
  return (
    <Frame {...props}>
      <rect x="50" y="12" width="60" height="92" rx="6" className="fill-surface" />
      <rect x="58" y="20" width="44" height="8" rx="2" className="fill-mint-100 stroke-none" />
      <rect x="60" y="38" width="14" height="14" rx="2" />
      <rect x="86" y="38" width="14" height="14" rx="2" />
      <rect x="60" y="64" width="14" height="14" rx="2" />
      <path d="M65 43h4v4h-4zM91 43h4v4h-4zM65 69h4v4h-4z" className="fill-primary-700" strokeWidth={1} />
      <path
        d="M86 64h4v4h-4zM96 64h4v4h-4zM91 69h4v4h-4zM86 74h4v4h-4zM96 74h4v4h-4z"
        className="fill-primary-700"
        strokeWidth={1}
      />
      <path d="M64 92h32" />
    </Frame>
  );
}

/** Bell: notifications empty / soft-ask. */
export function BellIllustration(props: IllustrationProps) {
  return (
    <Frame {...props}>
      <path d="M58 84V62a22 22 0 0 1 44 0v22l8 8H50Z" className="fill-mint-100" />
      <path d="M72 96a8 8 0 0 0 16 0" />
      <path d="M80 40v-6" />
      <path d="M116 48a24 24 0 0 1 6 16M44 48a24 24 0 0 0-6 16" />
    </Frame>
  );
}
