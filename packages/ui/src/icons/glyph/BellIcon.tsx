import { IconFrame, type IconProps } from '../Icon.tsx';

export function BellIcon(props: IconProps) {
  return (
    <IconFrame {...props}>
      <path d="M96 192a32 32 0 0 0 64 0" />
      <path d="M56 104a72 72 0 0 1 144 0c0 35.8 8.3 56.6 14.9 68a8 8 0 0 1-6.9 12H48a8 8 0 0 1-6.9-12C47.7 160.6 56 139.8 56 104Z" />
    </IconFrame>
  );
}
