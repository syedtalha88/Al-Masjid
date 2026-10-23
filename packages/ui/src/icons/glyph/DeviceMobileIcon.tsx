import { IconFrame, type IconProps } from '../Icon.tsx';

/** Mobile phone (devices, sessions). */
export function DeviceMobileIcon(props: IconProps) {
  return (
    <IconFrame {...props}>
      <rect x="64" y="24" width="128" height="208" rx="16" />
      <path d="M64 56h128M64 200h128" />
    </IconFrame>
  );
}
