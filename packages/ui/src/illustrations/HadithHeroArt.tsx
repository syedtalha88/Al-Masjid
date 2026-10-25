/**
 * The Today's Hadith / Ayah card header (07 A8 "bundled tasteful image: lantern/book; no people"): a lantern glowing
 * beside an open book under an arched window, drawn by us in token colours (06 §5 — no stock photos in UI chrome;
 * DECISIONS #100). Decorative; scales to its box (2:1, cropped by the card).
 */
export function HadithHeroArt({ className }: { readonly className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 320 160"
      preserveAspectRatio="xMidYMid slice"
      aria-hidden
      focusable={false}
      className={className}
    >
      <rect width="320" height="160" className="fill-primary-900" />
      {/* Arched window with a crescent */}
      <path d="M196 132V60a44 44 0 0 1 88 0v72Z" className="fill-primary-800" />
      <path d="M204 132V62a36 36 0 0 1 72 0v70Z" className="fill-primary-700 opacity-60" />
      <path d="M252 46a12 12 0 1 0 8 20 10 10 0 1 1-8-20Z" className="fill-sun opacity-80" />
      {/* Lantern glow */}
      <circle cx="92" cy="92" r="70" className="fill-sun opacity-10" />
      <circle cx="92" cy="92" r="42" className="fill-sun opacity-15" />
      {/* Table */}
      <rect y="128" width="320" height="32" className="fill-primary-800" />
      <rect y="128" width="320" height="3" className="fill-primary-600 opacity-60" />
      {/* Lantern */}
      <path d="M92 26v10" className="stroke-sun" strokeWidth="2" strokeLinecap="round" />
      <circle cx="92" cy="24" r="4" className="fill-none stroke-sun" strokeWidth="2" />
      <path d="M76 52 92 36l16 16Z" className="fill-facilities" />
      <rect x="74" y="52" width="36" height="6" rx="2" className="fill-facilities" />
      <path d="M78 58h28l-2 52H80Z" className="fill-sun opacity-90" />
      <path d="M86 58v52M98 58v52" className="stroke-facilities" strokeWidth="2" />
      <ellipse cx="92" cy="90" rx="5" ry="9" className="fill-surface" />
      <ellipse cx="92" cy="92" rx="2.5" ry="5" className="fill-sun" />
      <path d="M74 110h36l-4 10H78Z" className="fill-facilities" />
      <rect x="72" y="120" width="40" height="8" rx="2" className="fill-facilities" />
      {/* Open book on a stand */}
      <path d="M176 136 196 118h96l20 18Z" className="fill-primary-600 opacity-70" />
      <path d="M244 118c-18-10-42-12-60-6v14c18-6 42-4 60 6Z" className="fill-surface" />
      <path d="M244 118c18-10 42-12 60-6v14c-18-6-42-4-60 6Z" className="fill-surface-muted" />
      <path d="M244 118v14" className="stroke-mint-200" strokeWidth="1.5" />
      <path
        d="M194 114c14-3 30-2 42 3M194 119c14-3 30-2 42 3M252 117c12-5 28-6 42-3M252 122c12-5 28-6 42-3"
        className="fill-none stroke-mint-200"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  );
}
