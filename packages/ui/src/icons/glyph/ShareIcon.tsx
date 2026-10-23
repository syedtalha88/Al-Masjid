import { IconFrame, type IconProps } from '../Icon.tsx';

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
