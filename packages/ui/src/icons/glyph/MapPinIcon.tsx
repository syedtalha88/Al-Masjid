import { IconFrame, type IconProps } from '../Icon.tsx';

export function MapPinIcon(props: IconProps) {
  return (
    <IconFrame {...props}>
      <circle cx="128" cy="104" r="32" />
      <path d="M208 104c0 72-80 128-80 128s-80-56-80-128a80 80 0 0 1 160 0Z" />
    </IconFrame>
  );
}
