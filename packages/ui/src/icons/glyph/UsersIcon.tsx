import { IconFrame, type IconProps } from '../Icon.tsx';

export function UsersIcon(props: IconProps) {
  return (
    <IconFrame {...props}>
      <circle cx="84" cy="108" r="52" />
      <path d="M10.2 200a88 88 0 0 1 147.6 0M172 160a88 88 0 0 1 73.8 40M152.7 59.7A52 52 0 1 1 172 160" />
    </IconFrame>
  );
}
