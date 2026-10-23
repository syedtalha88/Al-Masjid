import { IconFrame, type IconProps } from '../Icon.tsx';

export function ClockIcon(props: IconProps) {
  return (
    <IconFrame {...props}>
      <circle cx="128" cy="128" r="96" />
      <path d="M128 72v56h56" />
    </IconFrame>
  );
}
