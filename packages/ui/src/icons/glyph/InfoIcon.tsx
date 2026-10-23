import { IconFrame, type IconProps } from '../Icon.tsx';

export function InfoIcon(props: IconProps) {
  return (
    <IconFrame {...props}>
      <circle cx="128" cy="128" r="96" />
      <path d="M120 120a8 8 0 0 1 8 8v40a8 8 0 0 0 8 8" />
      <circle cx="124" cy="84" r="6" className="fill-current" />
    </IconFrame>
  );
}
