import { IconFrame, type IconProps } from '../Icon.tsx';

export function QrCodeIcon(props: IconProps) {
  return (
    <IconFrame {...props}>
      <rect x="48" y="48" width="64" height="64" rx="8" />
      <rect x="48" y="144" width="64" height="64" rx="8" />
      <rect x="144" y="48" width="64" height="64" rx="8" />
      <path d="M144 144v32M144 208h32v-64M176 160h32M208 192v16" />
    </IconFrame>
  );
}
