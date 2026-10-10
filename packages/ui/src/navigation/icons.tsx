import { IconFrame, type IconProps } from '../icons/Icon.tsx';

/** `regular` = outline; `fill` = active tab / status (06 §5). Drawn on Phosphor's grid and stroke. */
export type IconWeight = 'regular' | 'fill';
export interface WeightedIconProps extends IconProps {
  readonly weight?: IconWeight;
}

const filled = (weight: IconWeight | undefined) => (weight === 'fill' ? 'fill-current' : undefined);

export function HomeIcon({ weight, ...props }: WeightedIconProps) {
  return (
    <IconFrame {...props}>
      <path
        d="M216 216H40V116a8 8 0 0 1 2.6-5.9l80-72.7a8 8 0 0 1 10.8 0l80 72.7a8 8 0 0 1 2.6 5.9ZM104 216v-56h48v56"
        className={filled(weight)}
        fillRule="evenodd"
      />
    </IconFrame>
  );
}

export function MasjidsIcon({ weight, ...props }: WeightedIconProps) {
  return (
    <IconFrame {...props}>
      <path d="M40 208H224" />
      <path d="M80 208v-68h96v68Z" className={filled(weight)} />
      <path d="M84 140c0-36 28-48 44-64 16 16 44 28 44 64Z" className={filled(weight)} />
      <path d="M128 76V56" />
      <path d="M208 208V112" />
      <path d="M196 112l12-24 12 24Z" className={filled(weight)} />
    </IconFrame>
  );
}

export function UpdatesIcon({ weight, ...props }: WeightedIconProps) {
  return (
    <IconFrame {...props}>
      <path
        d="M56 104a72 72 0 0 1 144 0c0 35.8 8.3 56.6 14.9 68a8 8 0 0 1-6.9 12H48a8 8 0 0 1-6.9-12C47.7 160.6 56 139.8 56 104Z"
        className={filled(weight)}
      />
      <path d="M96 200a32 32 0 0 0 64 0" />
    </IconFrame>
  );
}

export function SettingsIcon({ weight, ...props }: WeightedIconProps) {
  return (
    <IconFrame {...props}>
      <path d="M40 80h48M136 80h80M40 176h112M200 176h16" />
      <circle cx="112" cy="80" r="24" className={filled(weight)} />
      <circle cx="176" cy="176" r="24" className={filled(weight)} />
    </IconFrame>
  );
}

export function ScanIcon(props: IconProps) {
  return (
    <IconFrame {...props}>
      <path d="M176 40h32a8 8 0 0 1 8 8v32M216 176v32a8 8 0 0 1-8 8h-32M80 216H48a8 8 0 0 1-8-8v-32M40 80V48a8 8 0 0 1 8-8h32" />
      <path d="M72 128h112" />
    </IconFrame>
  );
}

/** Back chevron; mirrored in RTL by the caller (`rtl:-scale-x-100`). */
export function BackIcon(props: IconProps) {
  return (
    <IconFrame {...props}>
      <path d="M160 208 80 128l80-80" />
    </IconFrame>
  );
}

export function CloseIcon(props: IconProps) {
  return (
    <IconFrame {...props}>
      <path d="M200 56 56 200M56 56l144 144" />
    </IconFrame>
  );
}
