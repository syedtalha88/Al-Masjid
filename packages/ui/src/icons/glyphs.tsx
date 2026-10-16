import { IconFrame, type IconProps } from './Icon.tsx';

/*
 * UI glyphs drawn by us on Phosphor's 256-unit grid and `regular` stroke (06 §5; the @phosphor-icons packages
 * are unmaintained — DECISIONS #44). Directional glyphs (carets) carry `rtl:-scale-x-100` where they are used.
 */

export function CaretRightIcon(props: IconProps) {
  return (
    <IconFrame {...props}>
      <path d="M96 48l80 80-80 80" />
    </IconFrame>
  );
}

export function CaretLeftIcon(props: IconProps) {
  return (
    <IconFrame {...props}>
      <path d="M160 208l-80-80 80-80" />
    </IconFrame>
  );
}

export function CaretDownIcon(props: IconProps) {
  return (
    <IconFrame {...props}>
      <path d="M208 96l-80 80-80-80" />
    </IconFrame>
  );
}

export function CheckIcon(props: IconProps) {
  return (
    <IconFrame {...props}>
      <path d="M40 144l56 56L224 72" />
    </IconFrame>
  );
}

/** Check in a filled circle (Verified badge, success rows). */
export function CheckCircleIcon(props: IconProps) {
  return (
    <IconFrame {...props}>
      <circle cx="128" cy="128" r="96" className="fill-current" />
      <path d="M88 136l24 24 56-56" className="stroke-surface" />
    </IconFrame>
  );
}

export function XIcon(props: IconProps) {
  return (
    <IconFrame {...props}>
      <path d="M200 56L56 200M200 200L56 56" />
    </IconFrame>
  );
}

export function PlusIcon(props: IconProps) {
  return (
    <IconFrame {...props}>
      <path d="M40 128h176M128 40v176" />
    </IconFrame>
  );
}

export function MinusIcon(props: IconProps) {
  return (
    <IconFrame {...props}>
      <path d="M40 128h176" />
    </IconFrame>
  );
}

export function InfoIcon(props: IconProps) {
  return (
    <IconFrame {...props}>
      <circle cx="128" cy="128" r="96" />
      <path d="M120 120a8 8 0 0 1 8 8v40a8 8 0 0 0 8 8" />
      <circle cx="124" cy="84" r="6" className="fill-current" />
    </IconFrame>
  );
}

export function WarningIcon(props: IconProps) {
  return (
    <IconFrame {...props}>
      <path d="M128 104v40" />
      <path d="M114.2 40l-88 152A16 16 0 0 0 40 216h176a16 16 0 0 0 13.8-24l-88-152a16 16 0 0 0-27.6 0Z" />
      <circle cx="128" cy="180" r="6" className="fill-current" />
    </IconFrame>
  );
}

export function SearchIcon(props: IconProps) {
  return (
    <IconFrame {...props}>
      <circle cx="112" cy="112" r="80" />
      <path d="M168.6 168.6L224 224" />
    </IconFrame>
  );
}

export function CalendarIcon(props: IconProps) {
  return (
    <IconFrame {...props}>
      <rect x="40" y="40" width="176" height="176" rx="8" />
      <path d="M176 24v32M80 24v32M40 88h176" />
    </IconFrame>
  );
}

export function ClockIcon(props: IconProps) {
  return (
    <IconFrame {...props}>
      <circle cx="128" cy="128" r="96" />
      <path d="M128 72v56h56" />
    </IconFrame>
  );
}

export function HeartIcon({ filled, ...props }: IconProps & { readonly filled?: boolean }) {
  return (
    <IconFrame {...props}>
      <path
        d="M128 216S24 160 24 94a54 54 0 0 1 104-20.4A54 54 0 0 1 232 94c0 66-104 122-104 122Z"
        className={filled ? 'fill-current' : undefined}
      />
    </IconFrame>
  );
}

export function BookOpenIcon(props: IconProps) {
  return (
    <IconFrame {...props}>
      <path d="M128 88a32 32 0 0 1 32-32h72v144h-72a32 32 0 0 0-32 32" />
      <path d="M24 200h72a32 32 0 0 1 32 32V88a32 32 0 0 0-32-32H24Z" />
    </IconFrame>
  );
}

export function MegaphoneIcon(props: IconProps) {
  return (
    <IconFrame {...props}>
      <path d="M160 80v120a8 8 0 0 1-8 8h-8a8 8 0 0 1-8-8v-40H64a32 32 0 0 1 0-64h96l64-40v168l-64-40" />
      <path d="M96 160v48a8 8 0 0 0 8 8h16" />
    </IconFrame>
  );
}

/** Two raised hands (dua requests). */
export function HandsPrayingIcon(props: IconProps) {
  return (
    <IconFrame {...props}>
      <path d="M120 216V112l-28-60a12 12 0 0 0-22 9l14 51-34 54v50" />
      <path d="M136 216V112l28-60a12 12 0 0 1 22 9l-14 51 34 54v50" />
    </IconFrame>
  );
}

export function ShareIcon(props: IconProps) {
  return (
    <IconFrame {...props}>
      <circle cx="64" cy="128" r="32" />
      <circle cx="176" cy="200" r="32" />
      <circle cx="176" cy="56" r="32" />
      <path d="M149.1 73.3l-58.2 37.4M90.9 145.3l58.2 37.4" />
    </IconFrame>
  );
}

export function BellIcon(props: IconProps) {
  return (
    <IconFrame {...props}>
      <path d="M96 192a32 32 0 0 0 64 0" />
      <path d="M56 104a72 72 0 0 1 144 0c0 35.8 8.3 56.6 14.9 68a8 8 0 0 1-6.9 12H48a8 8 0 0 1-6.9-12C47.7 160.6 56 139.8 56 104Z" />
    </IconFrame>
  );
}

export function MapPinIcon(props: IconProps) {
  return (
    <IconFrame {...props}>
      <circle cx="128" cy="104" r="32" />
      <path d="M208 104c0 72-80 128-80 128s-80-56-80-128a80 80 0 0 1 160 0Z" />
    </IconFrame>
  );
}

export function DotsIcon(props: IconProps) {
  return (
    <IconFrame {...props}>
      <circle cx="64" cy="128" r="12" className="fill-current stroke-none" />
      <circle cx="128" cy="128" r="12" className="fill-current stroke-none" />
      <circle cx="192" cy="128" r="12" className="fill-current stroke-none" />
    </IconFrame>
  );
}

export function WifiOffIcon(props: IconProps) {
  return (
    <IconFrame {...props}>
      <path d="M48 40l160 176" />
      <path d="M25 98.6A151.6 151.6 0 0 1 72.4 72M231 98.6a151.4 151.4 0 0 0-95.8-42.4" />
      <path d="M59 132.7a104.2 104.2 0 0 1 44.6-24.4M197 132.7a103.6 103.6 0 0 0-22.4-16.6" />
      <path d="M92.9 166.6a56 56 0 0 1 59.8-11.8" />
      <circle cx="128" cy="200" r="8" className="fill-current" />
    </IconFrame>
  );
}

export function RefreshIcon(props: IconProps) {
  return (
    <IconFrame {...props}>
      <path d="M176 104h48V56" />
      <path d="M188.4 192a88 88 0 1 1 1.8-126.2L224 104" />
    </IconFrame>
  );
}

/** iOS "Share" (box with up arrow) — used in the Add to Home Screen guide. */
export function ShareIosIcon(props: IconProps) {
  return (
    <IconFrame {...props}>
      <path d="M176 104h24a8 8 0 0 1 8 8v96a8 8 0 0 1-8 8H56a8 8 0 0 1-8-8v-96a8 8 0 0 1 8-8h24" />
      <path d="M88 64l40-40 40 40M128 24v112" />
    </IconFrame>
  );
}

export function PlusSquareIcon(props: IconProps) {
  return (
    <IconFrame {...props}>
      <rect x="40" y="40" width="176" height="176" rx="16" />
      <path d="M88 128h80M128 88v80" />
    </IconFrame>
  );
}

export function DownloadIcon(props: IconProps) {
  return (
    <IconFrame {...props}>
      <path d="M128 144V32M216 144v64a8 8 0 0 1-8 8H48a8 8 0 0 1-8-8v-64M88 104l40 40 40-40" />
    </IconFrame>
  );
}

export function BackspaceIcon(props: IconProps) {
  return (
    <IconFrame {...props}>
      <path d="M61.7 204.1L16 128l45.7-76.1A8 8 0 0 1 68.5 48H216a8 8 0 0 1 8 8v144a8 8 0 0 1-8 8H68.5a8 8 0 0 1-6.8-3.9Z" />
      <path d="M160 104l-48 48M160 152l-48-48" />
    </IconFrame>
  );
}

export function CopyIcon(props: IconProps) {
  return (
    <IconFrame {...props}>
      <path d="M168 168h48V40H88v48" />
      <rect x="40" y="88" width="128" height="128" rx="8" />
    </IconFrame>
  );
}

/** Play button in a circle (bayan videos). */
export function PlayCircleIcon(props: IconProps) {
  return (
    <IconFrame {...props}>
      <circle cx="128" cy="128" r="96" />
      <path d="M108 88v80l64-40Z" />
    </IconFrame>
  );
}

/** Bar chart (chanda). */
export function ChartBarIcon(props: IconProps) {
  return (
    <IconFrame {...props}>
      <path d="M32 216h192" />
      <path d="M56 216v-72h40v72" />
      <path d="M108 216V96h40v120" />
      <path d="M160 216V48h40v168" />
    </IconFrame>
  );
}

/** Crescent moon (special dates & Ramadan). */
export function CrescentIcon(props: IconProps) {
  return (
    <IconFrame {...props}>
      <path d="M200 160A88 88 0 0 1 96 56a88 88 0 1 0 104 104Z" />
    </IconFrame>
  );
}

/** Bulleted list (my posts). */
export function ListBulletsIcon(props: IconProps) {
  return (
    <IconFrame {...props}>
      <path d="M96 64h120M96 128h120M96 192h120" />
      <circle cx="52" cy="64" r="4" className="fill-current" />
      <circle cx="52" cy="128" r="4" className="fill-current" />
      <circle cx="52" cy="192" r="4" className="fill-current" />
    </IconFrame>
  );
}

/** Gear (masjid profile, settings). */
export function GearIcon(props: IconProps) {
  return (
    <IconFrame {...props}>
      <circle cx="128" cy="128" r="36" />
      <path d="M128 24v28M128 204v28M24 128h28M204 128h28M54.5 54.5l19.8 19.8M181.7 181.7l19.8 19.8M54.5 201.5l19.8-19.8M181.7 74.3l19.8-19.8" />
      <circle cx="128" cy="128" r="72" />
    </IconFrame>
  );
}

/** Fingerprint (passkeys / screen lock). */
export function FingerprintIcon(props: IconProps) {
  return (
    <IconFrame {...props}>
      <path d="M72 216a136 136 0 0 0 16-64 40 40 0 0 1 80 0 168 168 0 0 1-8 48" />
      <path d="M128 152a216 216 0 0 1-24 96" />
      <path d="M40 176a144 144 0 0 0 0-24 88 88 0 0 1 168-37" />
      <path d="M216 152a259 259 0 0 1-4 40" />
      <path d="M60 64a120 120 0 0 1 140 0" />
    </IconFrame>
  );
}

/** Sign out (door with arrow). */
export function SignOutIcon(props: IconProps) {
  return (
    <IconFrame {...props}>
      <path d="M112 40H48v176h64" />
      <path d="M112 128h112M184 88l40 40-40 40" />
    </IconFrame>
  );
}

/** Mobile phone (devices, sessions). */
export function DeviceMobileIcon(props: IconProps) {
  return (
    <IconFrame {...props}>
      <rect x="64" y="24" width="128" height="208" rx="16" />
      <path d="M64 56h128M64 200h128" />
    </IconFrame>
  );
}

/** Globe (language). */
export function GlobeIcon(props: IconProps) {
  return (
    <IconFrame {...props}>
      <circle cx="128" cy="128" r="96" />
      <path d="M32 128h192" />
      <path d="M128 32c-26 26-40 60-40 96s14 70 40 96c26-26 40-60 40-96s-14-70-40-96Z" />
    </IconFrame>
  );
}

/** Shield with check (undertaking, verified actions). */
export function ShieldCheckIcon(props: IconProps) {
  return (
    <IconFrame {...props}>
      <path d="M40 112V56a8 8 0 0 1 8-8h160a8 8 0 0 1 8 8v56c0 84-88 112-88 112S40 196 40 112Z" />
      <path d="M88 136l24 24 56-56" />
    </IconFrame>
  );
}

/** Person in a circle (my account). */
export function UserCircleIcon(props: IconProps) {
  return (
    <IconFrame {...props}>
      <circle cx="128" cy="128" r="96" />
      <circle cx="128" cy="112" r="36" />
      <path d="M63.8 199.4a72 72 0 0 1 128.4 0" />
    </IconFrame>
  );
}
