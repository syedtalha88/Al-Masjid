import { IconFrame, type IconProps } from '../Icon.tsx';

export function DownloadIcon(props: IconProps) {
  return (
    <IconFrame {...props}>
      <path d="M128 144V32M216 144v64a8 8 0 0 1-8 8H48a8 8 0 0 1-8-8v-64M88 104l40 40 40-40" />
    </IconFrame>
  );
}
