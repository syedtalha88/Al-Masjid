import { IconFrame, type IconProps } from '../Icon.tsx';

export function WarningIcon(props: IconProps) {
  return (
    <IconFrame {...props}>
      <path d="M128 104v40" />
      <path d="M114.2 40l-88 152A16 16 0 0 0 40 216h176a16 16 0 0 0 13.8-24l-88-152a16 16 0 0 0-27.6 0Z" />
      <circle cx="128" cy="180" r="6" className="fill-current" />
    </IconFrame>
  );
}
