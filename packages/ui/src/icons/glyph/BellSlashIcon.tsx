import { IconFrame, type IconProps } from '../Icon.tsx';

/** Bell with a slash (a muted masjid — 07 A5 Notifications action). */
export function BellSlashIcon(props: IconProps) {
  return (
    <IconFrame {...props}>
      <path d="M48 40l160 176" />
      <path d="M96 192a32 32 0 0 0 64 0" />
      <path d="M190.7 184H48a8 8 0 0 1-6.9-12C47.7 160.6 56 139.8 56 104a71.6 71.6 0 0 1 12.2-40.2M99 37.8A72 72 0 0 1 200 104c0 25 4 42.5 9 54" />
    </IconFrame>
  );
}
