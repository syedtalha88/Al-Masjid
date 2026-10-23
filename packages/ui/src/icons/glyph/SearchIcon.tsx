import { IconFrame, type IconProps } from '../Icon.tsx';

export function SearchIcon(props: IconProps) {
  return (
    <IconFrame {...props}>
      <circle cx="112" cy="112" r="80" />
      <path d="M168.6 168.6L224 224" />
    </IconFrame>
  );
}
